import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { FeeBreakdown } from '@utils/fees';

export type TransactionPhase =
  | 'IDLE'
  | 'INITIATE'
  | 'BRIDGE_TO_EVM'
  | 'SHIELD'
  | 'PRIVATE_STATE'
  | 'ZK_PROOF'
  | 'UNSHIELD'
  | 'BRIDGE_TO_XRPL'
  | 'COMPLETE'
  | 'FAILED';

export type UserStage = 'securing' | 'privacy' | 'delivery' | 'complete';

// Map technical phases to user-facing stages
export const phaseToStage: Record<TransactionPhase, UserStage | null> = {
  IDLE: null,
  INITIATE: 'securing',
  BRIDGE_TO_EVM: 'securing',
  SHIELD: 'securing',
  PRIVATE_STATE: 'privacy',
  ZK_PROOF: 'privacy',
  UNSHIELD: 'delivery',
  BRIDGE_TO_XRPL: 'delivery',
  COMPLETE: 'complete',
  FAILED: null,
};

export interface TransactionData {
  id: string;
  amount: string;
  recipient: string;
  fees: FeeBreakdown;
  phase: TransactionPhase;
  startedAt: number;
  completedAt?: number;
  error?: string;
  txHashes: {
    xrplBridge?: string;
    shield?: string;
    unshield?: string;
    evmBridge?: string;
    settlement?: string;
  };
}

interface TransactionState {
  currentTransaction: TransactionData | null;
  history: TransactionData[];
}

interface TransactionActions {
  initTransaction: (params: { amount: string; recipient: string; fees: FeeBreakdown }) => void;
  setPhase: (phase: TransactionPhase) => void;
  setTxHash: (key: keyof TransactionData['txHashes'], hash: string) => void;
  setError: (error: string) => void;
  completeTransaction: () => void;
  clearTransaction: () => void;
  // For demo mode
  simulateProgress: () => void;
}

type TransactionStore = TransactionState & TransactionActions;

const initialState: TransactionState = {
  currentTransaction: null,
  history: [],
};

// Generate unique transaction ID
const generateTxId = () => `PRV-${Math.random().toString(36).substr(2, 6).toUpperCase()}`;

export const useTransactionStore = create<TransactionStore>()(
  persist(
    (set, get) => ({
      ...initialState,

      initTransaction: ({ amount, recipient, fees }) => {
        const tx: TransactionData = {
          id: generateTxId(),
          amount,
          recipient,
          fees,
          phase: 'INITIATE',
          startedAt: Date.now(),
          txHashes: {},
        };
        set({ currentTransaction: tx });
      },

      setPhase: (phase) => {
        const { currentTransaction } = get();
        if (!currentTransaction) return;

        set({
          currentTransaction: {
            ...currentTransaction,
            phase,
          },
        });
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

      setError: (error) => {
        const { currentTransaction } = get();
        if (!currentTransaction) return;

        set({
          currentTransaction: {
            ...currentTransaction,
            phase: 'FAILED',
            error,
          },
        });
      },

      completeTransaction: () => {
        const { currentTransaction, history } = get();
        if (!currentTransaction) return;

        const completedTx: TransactionData = {
          ...currentTransaction,
          phase: 'COMPLETE',
          completedAt: Date.now(),
        };

        set({
          currentTransaction: completedTx,
          history: [completedTx, ...history].slice(0, 50), // Keep last 50 transactions
        });
      },

      clearTransaction: () => {
        set({ currentTransaction: null });
      },

      // Demo mode: simulate progress through phases
      simulateProgress: () => {
        const phases: TransactionPhase[] = [
          'INITIATE',
          'BRIDGE_TO_EVM',
          'SHIELD',
          'PRIVATE_STATE',
          'ZK_PROOF',
          'UNSHIELD',
          'BRIDGE_TO_XRPL',
          'COMPLETE',
        ];

        const durations = [1000, 1500, 1500, 2000, 2000, 1500, 1500, 0]; // ms per phase in demo

        let currentIndex = 0;

        const advancePhase = () => {
          if (currentIndex < phases.length - 1) {
            currentIndex++;
            const { setPhase, completeTransaction } = get();

            if (phases[currentIndex] === 'COMPLETE') {
              completeTransaction();
            } else {
              setPhase(phases[currentIndex]);
              setTimeout(advancePhase, durations[currentIndex]);
            }
          }
        };

        // Start the simulation
        setTimeout(advancePhase, durations[0]);
      },
    }),
    {
      name: 'veil-transaction-store',
      partialize: (state) => ({
        currentTransaction: state.currentTransaction,
        history: state.history,
      }),
    }
  )
);
