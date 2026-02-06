/**
 * Orchestrator Store
 *
 * Zustand store for transaction orchestrator state management.
 * Bridges the orchestrator service to React components.
 */

import { create } from 'zustand';
import {
  transactionOrchestratorService,
  type OrchestratorPhase,
  type OrchestratorTransaction,
  type TransactionParams,
  type OrchestratorEventPayload,
  type RecoveryResult,
  PHASE_TO_USER_STAGE,
  PHASE_DESCRIPTIONS,
  getPhaseProgress,
} from '@services/orchestrator';

// =============================================================================
// Types
// =============================================================================

export type UserStage = 'securing' | 'privacy' | 'delivery' | 'complete';

interface OrchestratorState {
  // Current transaction state
  transaction: OrchestratorTransaction | null;
  currentPhase: OrchestratorPhase | null;
  currentStage: UserStage | null;
  progress: number;
  statusMessage: string;

  // Loading states
  isStarting: boolean;
  isRunning: boolean;
  isResuming: boolean;

  // Error state
  error: string | null;

  // Recovery state
  hasPendingRecovery: boolean;
  recoveryTransaction: OrchestratorTransaction | null;
  canResume: boolean;
}

interface PreflightResult {
  passed: boolean;
  checks: Array<{ name: string; status: 'pass' | 'fail' | 'warn'; message: string }>;
  summary: string;
}

interface OrchestratorActions {
  // Transaction lifecycle
  startTransaction: (params: TransactionParams) => Promise<void>;
  resumeTransaction: () => Promise<void>;
  abortTransaction: () => Promise<void>;
  clearTransaction: () => void;

  // Pre-flight validation
  runPreflight: (params: TransactionParams) => Promise<PreflightResult>;

  // Recovery
  checkForRecovery: () => Promise<void>;
  dismissRecovery: () => void;

  // Internal
  handleEvent: (event: OrchestratorEventPayload) => void;
  reset: () => void;
}

type OrchestratorStore = OrchestratorState & OrchestratorActions;

// =============================================================================
// Initial State
// =============================================================================

const initialState: OrchestratorState = {
  transaction: null,
  currentPhase: null,
  currentStage: null,
  progress: 0,
  statusMessage: '',

  isStarting: false,
  isRunning: false,
  isResuming: false,

  error: null,

  hasPendingRecovery: false,
  recoveryTransaction: null,
  canResume: false,
};

// =============================================================================
// Store Definition
// =============================================================================

export const useOrchestratorStore = create<OrchestratorStore>()((set, get) => {
  // Event handler
  const handleEvent = (event: OrchestratorEventPayload) => {
    const { type, phase, progress, message, error } = event;

    switch (type) {
      case 'phase_started':
        set({
          currentPhase: phase || null,
          currentStage: phase ? PHASE_TO_USER_STAGE[phase] : null,
          progress: progress || 0,
          statusMessage: message || (phase ? PHASE_DESCRIPTIONS[phase] : ''),
          isRunning: true,
        });
        break;

      case 'phase_completed':
        set({
          currentPhase: phase || null,
          currentStage: phase ? PHASE_TO_USER_STAGE[phase] : null,
          progress: progress || 0,
          statusMessage: message || 'Phase completed',
        });
        break;

      case 'phase_failed':
        set({
          error: error || 'Phase failed',
          statusMessage: message || 'Phase failed',
        });
        break;

      case 'phase_retry':
        set({
          statusMessage: message || 'Retrying...',
          error: null,
        });
        break;

      case 'progress_update':
        set({
          progress: progress || get().progress,
          statusMessage: message || get().statusMessage,
        });
        break;

      case 'transaction_complete':
        set({
          currentPhase: 'COMPLETE',
          currentStage: 'complete',
          progress: 100,
          statusMessage: 'Transaction complete',
          isRunning: false,
        });
        break;

      case 'transaction_failed':
        set({
          currentPhase: 'FAILED',
          currentStage: null,
          error: error || 'Transaction failed',
          statusMessage: message || 'Transaction failed',
          isRunning: false,
        });
        break;

      case 'state_restored':
        set({
          currentPhase: phase || null,
          currentStage: phase ? PHASE_TO_USER_STAGE[phase] : null,
          progress: progress || 0,
          statusMessage: message || 'State restored',
          isResuming: false,
          isRunning: true,
        });
        break;
    }

    // Update transaction state
    const tx = transactionOrchestratorService.getCurrentTransaction();
    if (tx) {
      set({ transaction: tx });
    }
  };

  return {
    ...initialState,

    handleEvent,

    runPreflight: async (params: TransactionParams): Promise<PreflightResult> => {
      console.log('[OrchestratorStore] Running pre-flight checks...');
      const result = await transactionOrchestratorService.preflight(params);
      return result;
    },

    startTransaction: async (params: TransactionParams) => {
      set({
        isStarting: true,
        error: null,
        statusMessage: 'Starting transaction...',
      });

      try {
        // Subscribe to events
        transactionOrchestratorService.on('phase_started', get().handleEvent);
        transactionOrchestratorService.on('phase_completed', get().handleEvent);
        transactionOrchestratorService.on('phase_failed', get().handleEvent);
        transactionOrchestratorService.on('phase_retry', get().handleEvent);
        transactionOrchestratorService.on('progress_update', get().handleEvent);
        transactionOrchestratorService.on('transaction_complete', get().handleEvent);
        transactionOrchestratorService.on('transaction_failed', get().handleEvent);

        // Start the transaction
        const tx = await transactionOrchestratorService.start(params);

        set({
          transaction: tx,
          currentPhase: tx.currentPhase,
          currentStage: PHASE_TO_USER_STAGE[tx.currentPhase],
          progress: getPhaseProgress(tx.currentPhase),
          isStarting: false,
          isRunning: true,
        });
      } catch (error) {
        set({
          isStarting: false,
          error: error instanceof Error ? error.message : 'Failed to start transaction',
          statusMessage: 'Failed to start transaction',
        });
        throw error;
      }
    },

    resumeTransaction: async () => {
      const { recoveryTransaction } = get();

      if (!recoveryTransaction) {
        set({ error: 'No transaction to resume' });
        return;
      }

      set({
        isResuming: true,
        error: null,
        statusMessage: 'Resuming transaction...',
      });

      try {
        // Subscribe to events
        transactionOrchestratorService.on('phase_started', get().handleEvent);
        transactionOrchestratorService.on('phase_completed', get().handleEvent);
        transactionOrchestratorService.on('phase_failed', get().handleEvent);
        transactionOrchestratorService.on('phase_retry', get().handleEvent);
        transactionOrchestratorService.on('progress_update', get().handleEvent);
        transactionOrchestratorService.on('transaction_complete', get().handleEvent);
        transactionOrchestratorService.on('transaction_failed', get().handleEvent);
        transactionOrchestratorService.on('state_restored', get().handleEvent);

        // Resume the transaction
        const tx = await transactionOrchestratorService.resume(recoveryTransaction);

        if (tx) {
          set({
            transaction: tx,
            currentPhase: tx.currentPhase,
            currentStage: PHASE_TO_USER_STAGE[tx.currentPhase],
            progress: getPhaseProgress(tx.currentPhase),
            hasPendingRecovery: false,
            recoveryTransaction: null,
            canResume: false,
          });
        }
      } catch (error) {
        set({
          isResuming: false,
          error: error instanceof Error ? error.message : 'Failed to resume transaction',
          statusMessage: 'Failed to resume',
        });
        throw error;
      }
    },

    abortTransaction: async () => {
      try {
        await transactionOrchestratorService.abort();
        set({
          isRunning: false,
          statusMessage: 'Transaction aborted',
        });
      } catch (error) {
        set({
          error: error instanceof Error ? error.message : 'Failed to abort',
        });
      }
    },

    clearTransaction: () => {
      transactionOrchestratorService.cleanup();
      set(initialState);
    },

    checkForRecovery: async () => {
      try {
        const result: RecoveryResult =
          await transactionOrchestratorService.checkForPendingTransactions();

        set({
          hasPendingRecovery: result.hasPending,
          recoveryTransaction: result.transaction,
          canResume: result.canResume,
        });

        if (result.hasPending) {
          console.log('[OrchestratorStore] Found pending transaction:', result.message);
        }
      } catch (error) {
        console.error('[OrchestratorStore] Recovery check failed:', error);
      }
    },

    dismissRecovery: () => {
      set({
        hasPendingRecovery: false,
        recoveryTransaction: null,
        canResume: false,
      });
    },

    reset: () => {
      transactionOrchestratorService.cleanup();
      set(initialState);
    },
  };
});

// =============================================================================
// Selector Helpers
// =============================================================================

/**
 * Get user-facing stage info
 */
export const getStageInfo = (
  state: OrchestratorState
): { name: string; description: string } | null => {
  switch (state.currentStage) {
    case 'securing':
      return {
        name: 'Securing Payment',
        description: 'Initiating bridge transfer',
      };
    case 'privacy':
      return {
        name: 'Privacy Layer',
        description: 'Adding zero-knowledge protection',
      };
    case 'delivery':
      return {
        name: 'Delivery',
        description: 'Completing settlement',
      };
    case 'complete':
      return {
        name: 'Complete',
        description: 'Transaction complete',
      };
    default:
      return null;
  }
};

/**
 * Check if transaction is in a terminal state
 */
export const isTransactionTerminal = (state: OrchestratorState): boolean => {
  return state.currentPhase === 'COMPLETE' || state.currentPhase === 'FAILED';
};

/**
 * Get the stage index (1-3) for UI
 */
export const getStageIndex = (state: OrchestratorState): number => {
  switch (state.currentStage) {
    case 'securing':
      return 1;
    case 'privacy':
      return 2;
    case 'delivery':
      return 3;
    case 'complete':
      return 3;
    default:
      return 0;
  }
};
