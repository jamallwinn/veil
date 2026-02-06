import { create } from 'zustand';
import {
  axelarBridgeService,
  BridgeStatusType,
  BridgeDirection,
} from '@services/bridge';

// =============================================================================
// Types & Interfaces
// =============================================================================

interface BridgeState {
  // Current bridge transaction state
  isActive: boolean;
  direction: BridgeDirection | null;
  txHash: string | null;
  status: BridgeStatusType | null;
  confirmations: number;
  requiredConfirmations: number;
  estimatedTimeRemaining: number | null;
  error: string | null;

  // Loading states
  isInitiating: boolean;
  isPolling: boolean;
}

interface BridgeActions {
  /**
   * Start a bridge transaction to EVM
   * @param amount - Amount of XRP to bridge
   * @param fromXRPLAddress - Sender's XRPL address
   * @param toEVMAddress - Recipient's EVM address
   */
  startBridgeToEVM: (
    amount: string,
    fromXRPLAddress: string,
    toEVMAddress: string
  ) => Promise<{ success: boolean; txHash: string | null; error?: string }>;

  /**
   * Start a bridge transaction back to XRPL
   * @param amount - Amount of wXRP to bridge
   * @param fromEVMAddress - Sender's EVM address
   * @param toXRPLAddress - Recipient's XRPL address
   */
  startBridgeToXRPL: (
    amount: string,
    fromEVMAddress: string,
    toXRPLAddress: string
  ) => Promise<{ success: boolean; txHash: string | null; error?: string }>;

  /**
   * Update bridge status from polling
   */
  updateStatus: (status: {
    status: BridgeStatusType;
    confirmations: number;
    requiredConfirmations: number;
    estimatedTimeRemaining?: number;
  }) => void;

  /**
   * Poll for bridge status updates
   * @param txHash - Transaction hash to poll
   * @param onComplete - Callback when bridge completes
   * @param onError - Callback on error
   * @returns Cleanup function to stop polling
   */
  pollBridgeStatus: (
    txHash: string,
    onComplete?: () => void,
    onError?: (error: string) => void
  ) => () => void;

  /**
   * Mark bridge as complete
   */
  completeBridge: () => void;

  /**
   * Mark bridge as failed
   * @param error - Error message
   */
  failBridge: (error: string) => void;

  /**
   * Reset bridge state
   */
  reset: () => void;
}

type BridgeStore = BridgeState & BridgeActions;

// =============================================================================
// Initial State
// =============================================================================

const initialState: BridgeState = {
  isActive: false,
  direction: null,
  txHash: null,
  status: null,
  confirmations: 0,
  requiredConfirmations: 0,
  estimatedTimeRemaining: null,
  error: null,
  isInitiating: false,
  isPolling: false,
};

// =============================================================================
// Store Definition
// =============================================================================

export const useBridgeStore = create<BridgeStore>()((set, get) => ({
  ...initialState,

  startBridgeToEVM: async (amount, fromXRPLAddress, toEVMAddress) => {
    set({ isInitiating: true, error: null });

    try {
      const result = await axelarBridgeService.bridgeToEVM(
        amount,
        fromXRPLAddress,
        toEVMAddress
      );

      if (result.success && result.txHash) {
        set({
          isActive: true,
          isInitiating: false,
          direction: 'toEVM',
          txHash: result.txHash,
          status: 'pending',
          confirmations: 0,
          requiredConfirmations: 6, // XRPL confirmations for toEVM
          estimatedTimeRemaining: 20, // ~20 seconds for toEVM
        });

        return { success: true, txHash: result.txHash };
      } else {
        const error = result.error || 'Failed to initiate bridge transaction';
        set({ isInitiating: false, error });
        return { success: false, txHash: null, error };
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error occurred';
      set({ isInitiating: false, error: errorMessage });
      return { success: false, txHash: null, error: errorMessage };
    }
  },

  startBridgeToXRPL: async (amount, fromEVMAddress, toXRPLAddress) => {
    set({ isInitiating: true, error: null });

    try {
      const result = await axelarBridgeService.bridgeToXRPL(
        amount,
        fromEVMAddress,
        toXRPLAddress
      );

      if (result.success && result.txHash) {
        set({
          isActive: true,
          isInitiating: false,
          direction: 'toXRPL',
          txHash: result.txHash,
          status: 'pending',
          confirmations: 0,
          requiredConfirmations: 12, // EVM confirmations for toXRPL
          estimatedTimeRemaining: 25, // ~25 seconds for toXRPL
        });

        return { success: true, txHash: result.txHash };
      } else {
        const error = result.error || 'Failed to initiate bridge transaction';
        set({ isInitiating: false, error });
        return { success: false, txHash: null, error };
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error occurred';
      set({ isInitiating: false, error: errorMessage });
      return { success: false, txHash: null, error: errorMessage };
    }
  },

  updateStatus: (statusUpdate) => {
    const { status, confirmations, requiredConfirmations, estimatedTimeRemaining } =
      statusUpdate;

    set({
      status,
      confirmations,
      requiredConfirmations,
      estimatedTimeRemaining: estimatedTimeRemaining ?? null,
    });
  },

  pollBridgeStatus: (txHash, onComplete, onError) => {
    set({ isPolling: true });

    const pollInterval = setInterval(async () => {
      try {
        const bridgeStatus = await axelarBridgeService.getBridgeStatus(txHash);

        get().updateStatus(bridgeStatus);

        if (bridgeStatus.status === 'complete') {
          clearInterval(pollInterval);
          get().completeBridge();
          onComplete?.();
        } else if (bridgeStatus.status === 'failed') {
          clearInterval(pollInterval);
          const error = 'Bridge transaction failed';
          get().failBridge(error);
          onError?.(error);
        }
      } catch (error) {
        clearInterval(pollInterval);
        const errorMessage =
          error instanceof Error ? error.message : 'Failed to get bridge status';
        get().failBridge(errorMessage);
        onError?.(errorMessage);
      }
    }, 1000); // Poll every second

    // Return cleanup function
    return () => {
      clearInterval(pollInterval);
      set({ isPolling: false });
    };
  },

  completeBridge: () => {
    set({
      status: 'complete',
      isPolling: false,
    });
  },

  failBridge: (error) => {
    set({
      status: 'failed',
      error,
      isPolling: false,
    });
  },

  reset: () => {
    set(initialState);
  },
}));

// =============================================================================
// Selector Helpers
// =============================================================================

/**
 * Get progress percentage based on confirmations
 */
export const getBridgeProgress = (state: BridgeState): number => {
  if (!state.isActive) return 0;
  if (state.status === 'complete') return 100;
  if (state.requiredConfirmations === 0) return 0;

  return Math.round(
    (state.confirmations / state.requiredConfirmations) * 100
  );
};

/**
 * Check if bridge is in a terminal state
 */
export const isBridgeTerminal = (state: BridgeState): boolean => {
  return state.status === 'complete' || state.status === 'failed';
};
