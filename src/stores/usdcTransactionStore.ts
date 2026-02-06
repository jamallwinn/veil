import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { usdcTransactionOrchestratorService } from '@services/orchestrator/usdcOrchestrator';
import type { UsdcOrchestratorPhase } from '@services/orchestrator/usdcTypes';

// USDC Transaction Phases
export type UsdcTransactionPhase =
  | 'IDLE'
  | 'INITIATE'
  | 'BRIDGE_TO_EVM'  // Bridge first (XRPL → EVM)
  | 'APPROVAL'       // ERC-20 approval (after bridging to EVM)
  | 'DEPOSIT'
  | 'WAIT'
  | 'PROVE'
  | 'WITHDRAW'
  | 'BRIDGE_TO_XRPL'
  | 'COMPLETE'
  | 'FAILED';

export type UserStage = 'securing' | 'privacy' | 'delivery' | 'complete';

// Map technical phases to user-facing stages
export const phaseToStage: Record<UsdcTransactionPhase, UserStage | null> = {
  IDLE: null,
  INITIATE: 'securing',
  BRIDGE_TO_EVM: 'securing', // Bridge first (XRPL → EVM)
  APPROVAL: 'securing',      // ERC-20 approval (after bridging)
  DEPOSIT: 'securing',
  WAIT: 'privacy',
  PROVE: 'privacy',
  WITHDRAW: 'delivery',
  BRIDGE_TO_XRPL: 'delivery',
  COMPLETE: 'complete',
  FAILED: null,
};

// USDC Fee structure
export interface UsdcFeeBreakdown {
  bridge: number;       // Axelar bridge fee (in USDC)
  bridgeGas: number;    // Axelar ITS gas fee deducted from transfer (in USDC)
  privacy: number;      // Privacy pool fee (0.5%)
  evmGas: number;       // EVM gas costs (in XRP)
  approval: number;     // ERC-20 approval gas (in XRP)
  xrpBridgeGas: number; // XRP bridged for EVM gas
  total: number;        // Total USDC fees
  totalXrpGas: number;  // Total XRP needed for gas
}

export interface UsdcTransactionData {
  id: string;
  amount: string;
  recipient: string;
  fees: UsdcFeeBreakdown;
  phase: UsdcTransactionPhase;
  startedAt: number;
  completedAt?: number;
  error?: string;
  txHashes: {
    approval?: string;
    xrplBridge?: string;
    deposit?: string;
    withdraw?: string;
    evmBridge?: string;
  };
  depositData?: {
    commitment: string;
    nullifier: string;
    secret: string;
    leafIndex: number;
  };
}

interface UsdcTransactionState {
  currentTransaction: UsdcTransactionData | null;
  currentPhase: UsdcTransactionPhase;
  progress: number;
  statusMessage: string;
  error: string | null;
  history: UsdcTransactionData[];
}

interface UsdcTransactionActions {
  initTransaction: (params: { amount: string; recipient: string; fees: UsdcFeeBreakdown }) => void;
  startTransaction: (params: { amount: string; recipient: string; senderXRPL: string }) => Promise<void>;
  setPhase: (phase: UsdcTransactionPhase) => void;
  setProgress: (progress: number) => void;
  setStatusMessage: (message: string) => void;
  setTxHash: (key: keyof UsdcTransactionData['txHashes'], hash: string) => void;
  setDepositData: (data: UsdcTransactionData['depositData']) => void;
  setError: (error: string) => void;
  completeTransaction: () => void;
  clearTransaction: () => void;
  simulateProgress: () => void;
}

type UsdcTransactionStore = UsdcTransactionState & UsdcTransactionActions;

const initialState: UsdcTransactionState = {
  currentTransaction: null,
  currentPhase: 'IDLE',
  progress: 0,
  statusMessage: '',
  error: null,
  history: [],
};

// Generate unique transaction ID
const generateTxId = () => `USDC-${Math.random().toString(36).substr(2, 6).toUpperCase()}`;

export const useUsdcTransactionStore = create<UsdcTransactionStore>()(
  persist(
    (set, get) => ({
      ...initialState,

      initTransaction: ({ amount, recipient, fees }) => {
        const tx: UsdcTransactionData = {
          id: generateTxId(),
          amount,
          recipient,
          fees,
          phase: 'INITIATE',
          startedAt: Date.now(),
          txHashes: {},
        };
        set({
          currentTransaction: tx,
          currentPhase: 'INITIATE',
          progress: 0,
          statusMessage: 'Initializing USDC transaction...',
          error: null,
        });
      },

      startTransaction: async ({ amount, recipient, senderXRPL }) => {
        const { currentTransaction, setPhase, setProgress, setStatusMessage, setError, completeTransaction, setTxHash } = get();
        if (!currentTransaction) {
          throw new Error('No transaction initialized');
        }

        console.log('[UsdcTransactionStore] Starting transaction:', {
          amount,
          recipient,
          senderXRPL,
        });

        // Get orchestrator instance
        const orchestrator = usdcTransactionOrchestratorService;

        // Subscribe to orchestrator events
        const unsubPhaseStarted = orchestrator.on('phase_started', (payload) => {
          const phase = payload.phase as UsdcOrchestratorPhase;
          setPhase(phase as UsdcTransactionPhase);
          setStatusMessage(payload.message || '');
          setProgress(payload.progress || 0);
        });

        const unsubPhaseCompleted = orchestrator.on('phase_completed', (payload) => {
          const phase = payload.phase as UsdcOrchestratorPhase;
          setPhase(phase as UsdcTransactionPhase);
          setProgress(payload.progress || 0);
          setStatusMessage(payload.message || '');
        });

        const unsubProgressUpdate = orchestrator.on('progress_update', (payload) => {
          setStatusMessage(payload.message || '');
          if (payload.progress !== undefined) {
            setProgress(payload.progress);
          }
        });

        const unsubTransactionComplete = orchestrator.on('transaction_complete', () => {
          completeTransaction();
          // Cleanup listeners
          unsubPhaseStarted();
          unsubPhaseCompleted();
          unsubProgressUpdate();
          unsubTransactionComplete();
          unsubTransactionFailed();
        });

        const unsubTransactionFailed = orchestrator.on('transaction_failed', (payload) => {
          setError(payload.error || 'Transaction failed');
          // Cleanup listeners
          unsubPhaseStarted();
          unsubPhaseCompleted();
          unsubProgressUpdate();
          unsubTransactionComplete();
          unsubTransactionFailed();
        });

        try {
          // Start the real orchestrator
          const tx = await orchestrator.start({
            amount,
            recipient,
            senderXRPL,
            skipWait: true, // Skip WAIT phase by default for faster transactions
          });

          // Store tx hashes as they come in from the transaction
          if (tx.txHashes.approval) {
            setTxHash('approval', tx.txHashes.approval);
          }
          if (tx.txHashes.xrplBridge) {
            setTxHash('xrplBridge', tx.txHashes.xrplBridge);
          }
          if (tx.txHashes.deposit) {
            setTxHash('deposit', tx.txHashes.deposit);
          }
          if (tx.txHashes.withdraw) {
            setTxHash('withdraw', tx.txHashes.withdraw);
          }
          if (tx.txHashes.evmBridge) {
            setTxHash('evmBridge', tx.txHashes.evmBridge);
          }
        } catch (error) {
          // Cleanup listeners on error
          unsubPhaseStarted();
          unsubPhaseCompleted();
          unsubProgressUpdate();
          unsubTransactionComplete();
          unsubTransactionFailed();

          const errorMsg = error instanceof Error ? error.message : 'Failed to start transaction';
          setError(errorMsg);
          throw error;
        }
      },

      setPhase: (phase) => {
        const { currentTransaction } = get();
        if (!currentTransaction) return;

        set({
          currentTransaction: {
            ...currentTransaction,
            phase,
          },
          currentPhase: phase,
        });
      },

      setProgress: (progress) => {
        set({ progress });
      },

      setStatusMessage: (message) => {
        set({ statusMessage: message });
      },

      setTxHash: (key, hash) => {
        const { currentTransaction } = get();
        if (!currentTransaction) return;

        set({
          currentTransaction: {
            ...currentTransaction,
            txHashes: {
              ...currentTransaction.txHashes,
              [key]: hash,
            },
          },
        });
      },

      setDepositData: (data) => {
        const { currentTransaction } = get();
        if (!currentTransaction) return;

        set({
          currentTransaction: {
            ...currentTransaction,
            depositData: data,
          },
        });
      },

      setError: (error) => {
        const { currentTransaction } = get();
        if (!currentTransaction) return;

        set({
          currentTransaction: {
            ...currentTransaction,
            phase: 'FAILED',
            error,
          },
          currentPhase: 'FAILED',
          error,
        });
      },

      completeTransaction: () => {
        const { currentTransaction, history } = get();
        if (!currentTransaction) return;

        const completedTx: UsdcTransactionData = {
          ...currentTransaction,
          phase: 'COMPLETE',
          completedAt: Date.now(),
        };

        set({
          currentTransaction: completedTx,
          currentPhase: 'COMPLETE',
          progress: 100,
          statusMessage: 'Transaction complete!',
          history: [completedTx, ...history].slice(0, 50),
        });
      },

      clearTransaction: () => {
        set({
          currentTransaction: null,
          currentPhase: 'IDLE',
          progress: 0,
          statusMessage: '',
          error: null,
        });
      },

      // Demo mode: simulate progress through phases
      simulateProgress: () => {
        const phases: UsdcTransactionPhase[] = [
          'INITIATE',
          'BRIDGE_TO_EVM',  // Bridge first (XRPL → EVM)
          'APPROVAL',       // ERC-20 approval (after bridging)
          'DEPOSIT',
          'WAIT',
          'PROVE',
          'WITHDRAW',
          'BRIDGE_TO_XRPL',
          'COMPLETE',
        ];

        const messages: Record<UsdcTransactionPhase, string> = {
          IDLE: 'Ready',
          INITIATE: 'Preparing USDC transaction...',
          BRIDGE_TO_EVM: 'Bridging USDC to EVM...',  // Bridge first
          APPROVAL: 'Approving ERC-20 token...',     // Then approve
          DEPOSIT: 'Depositing to privacy pool...',
          WAIT: 'Waiting for privacy...',
          PROVE: 'Generating ZK proof...',
          WITHDRAW: 'Withdrawing from privacy pool...',
          BRIDGE_TO_XRPL: 'Bridging USDC to XRPL...',
          COMPLETE: 'Complete!',
          FAILED: 'Failed',
        };

        const durations = [800, 1000, 1500, 1500, 2000, 2000, 1500, 1500, 0]; // ms per phase in demo

        let currentIndex = 0;

        const advancePhase = () => {
          if (currentIndex < phases.length - 1) {
            currentIndex++;
            const { setPhase, setProgress, setStatusMessage, completeTransaction } = get();
            const phase = phases[currentIndex];
            const progress = Math.round((currentIndex / (phases.length - 1)) * 100);

            if (phase === 'COMPLETE') {
              completeTransaction();
            } else {
              setPhase(phase);
              setProgress(progress);
              setStatusMessage(messages[phase]);
              setTimeout(advancePhase, durations[currentIndex]);
            }
          }
        };

        // Start the simulation
        setTimeout(advancePhase, durations[0]);
      },
    }),
    {
      name: 'veil-usdc-transaction-store',
      partialize: (state) => ({
        currentTransaction: state.currentTransaction,
        history: state.history,
      }),
    }
  )
);
