/**
 * RAILGUN Store
 *
 * Zustand store for managing RAILGUN privacy protocol state.
 * Coordinates with the RAILGUN service for engine lifecycle,
 * wallet management, balance scanning, and shield operations.
 */

import { create } from 'zustand';
import {
  railgunService,
  shieldService,
  type RailgunWallet,
  type ShieldedBalance,
  type ShieldTransaction,
  type EngineStatus,
  type ScanProgress,
  type ShieldParams,
  type ShieldResult,
} from '@services/railgun';

// =============================================================================
// Types & Interfaces
// =============================================================================

interface RailgunState {
  // Engine state
  engineStatus: EngineStatus;
  isInitializing: boolean;

  // Wallet state
  wallet: RailgunWallet | null;
  isLoadingWallet: boolean;
  walletError: string | null;

  // Balance state
  balances: ShieldedBalance[];
  scanProgress: ScanProgress;
  isScanning: boolean;

  // Shield operation state
  activeShields: ShieldTransaction[];
  isShielding: boolean;
  shieldError: string | null;

  // Demo mode
  isDemoMode: boolean;

  // General error
  error: string | null;
}

interface RailgunActions {
  /**
   * Initialize the RAILGUN engine
   */
  initializeEngine: () => Promise<void>;

  /**
   * Create a new RAILGUN wallet
   * @param encryptionKey - User-provided encryption key
   */
  createWallet: (encryptionKey: string) => Promise<RailgunWallet | null>;

  /**
   * Load an existing RAILGUN wallet
   * @param encryptionKey - User-provided encryption key
   */
  loadWallet: (encryptionKey: string) => Promise<RailgunWallet | null>;

  /**
   * Unload the current wallet
   */
  unloadWallet: () => void;

  /**
   * Delete the stored wallet
   */
  deleteWallet: () => Promise<void>;

  /**
   * Scan for balance updates
   */
  scanBalances: () => Promise<void>;

  /**
   * Execute a shield operation
   * @param params - Shield parameters
   */
  shield: (params: ShieldParams) => Promise<ShieldResult>;

  /**
   * Update active shield transactions
   */
  refreshShieldTransactions: () => void;

  /**
   * Toggle demo mode
   */
  setDemoMode: (enabled: boolean) => void;

  /**
   * Clear error state
   */
  clearError: () => void;

  /**
   * Reset all state
   */
  reset: () => void;
}

type RailgunStore = RailgunState & RailgunActions;

// =============================================================================
// Initial State
// =============================================================================

const initialState: RailgunState = {
  engineStatus: 'uninitialized',
  isInitializing: false,
  wallet: null,
  isLoadingWallet: false,
  walletError: null,
  balances: [],
  scanProgress: {
    status: 'idle',
    progress: 0,
    lastScannedBlock: 0,
    currentBlock: 0,
  },
  isScanning: false,
  activeShields: [],
  isShielding: false,
  shieldError: null,
  isDemoMode: true,
  error: null,
};

// =============================================================================
// Store Definition
// =============================================================================

export const useRailgunStore = create<RailgunStore>()((set, get) => ({
  ...initialState,

  initializeEngine: async () => {
    const { engineStatus, isInitializing } = get();

    // Don't re-initialize
    if (engineStatus === 'ready' || isInitializing) {
      return;
    }

    set({ isInitializing: true, error: null });

    try {
      await railgunService.initializeEngine();

      set({
        engineStatus: railgunService.getEngineStatus(),
        isInitializing: false,
        isDemoMode: railgunService.isDemoMode(),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to initialize engine';
      set({
        engineStatus: 'error',
        isInitializing: false,
        error: message,
      });
    }
  },

  createWallet: async (encryptionKey) => {
    set({ isLoadingWallet: true, walletError: null });

    try {
      const wallet = await railgunService.createWallet(encryptionKey);

      set({
        wallet,
        isLoadingWallet: false,
        balances: [],
      });

      return wallet;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to create wallet';
      set({
        isLoadingWallet: false,
        walletError: message,
      });
      return null;
    }
  },

  loadWallet: async (encryptionKey) => {
    set({ isLoadingWallet: true, walletError: null });

    try {
      const wallet = await railgunService.loadWallet(encryptionKey);

      set({
        wallet,
        isLoadingWallet: false,
      });

      // Trigger balance scan after loading wallet
      get().scanBalances();

      return wallet;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load wallet';
      set({
        isLoadingWallet: false,
        walletError: message,
      });
      return null;
    }
  },

  unloadWallet: () => {
    railgunService.unloadWallet();
    set({
      wallet: null,
      balances: [],
      activeShields: [],
      scanProgress: {
        status: 'idle',
        progress: 0,
        lastScannedBlock: 0,
        currentBlock: 0,
      },
    });
  },

  deleteWallet: async () => {
    await railgunService.deleteWallet();
    get().unloadWallet();
  },

  scanBalances: async () => {
    const { wallet, isScanning } = get();

    if (!wallet || isScanning) {
      return;
    }

    set({ isScanning: true, error: null });

    try {
      await railgunService.scanBalances();

      set({
        balances: railgunService.getAllShieldedBalances(),
        scanProgress: railgunService.getScanProgress(),
        isScanning: false,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to scan balances';
      set({
        scanProgress: {
          ...get().scanProgress,
          status: 'error',
          error: message,
        },
        isScanning: false,
        error: message,
      });
    }
  },

  shield: async (params) => {
    set({ isShielding: true, shieldError: null });

    try {
      const result = await shieldService.shield(params);

      if (result.success && result.txHash) {
        // Update active shields
        get().refreshShieldTransactions();
      }

      set({ isShielding: false });

      if (!result.success) {
        set({ shieldError: result.error || 'Shield operation failed' });
      }

      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Shield operation failed';
      set({
        isShielding: false,
        shieldError: message,
      });
      return {
        success: false,
        txHash: null,
        error: message,
      };
    }
  },

  refreshShieldTransactions: () => {
    const transactions = shieldService.getActiveTransactions();
    set({ activeShields: transactions });
  },

  setDemoMode: (enabled) => {
    railgunService.setDemoMode(enabled);
    set({ isDemoMode: enabled });
  },

  clearError: () => {
    set({
      error: null,
      walletError: null,
      shieldError: null,
    });
  },

  reset: () => {
    railgunService.cleanup();
    set(initialState);
  },
}));

// =============================================================================
// Selector Helpers
// =============================================================================

/**
 * Check if RAILGUN is ready for use
 */
export const isRailgunReady = (state: RailgunState): boolean => {
  return state.engineStatus === 'ready' && state.wallet !== null;
};

/**
 * Get total shielded balance in formatted string
 */
export const getTotalShieldedBalance = (state: RailgunState): string => {
  const total = state.balances.reduce((sum, b) => sum + b.balance, BigInt(0));
  return railgunService.isDemoMode()
    ? '0.0' // In demo mode, show zero
    : (Number(total) / 1e18).toFixed(6);
};

/**
 * Check if any shield operations are pending
 */
export const hasActiveShields = (state: RailgunState): boolean => {
  return state.activeShields.some(
    (tx) => tx.status === 'pending' || tx.status === 'confirming'
  );
};

/**
 * Get shield operation progress percentage
 */
export const getShieldProgress = (txHash: string, state: RailgunState): number => {
  const tx = state.activeShields.find((t) => t.txHash === txHash);
  if (!tx) return 0;
  if (tx.status === 'complete') return 100;
  if (tx.requiredConfirmations === 0) return 0;
  return Math.round((tx.confirmations / tx.requiredConfirmations) * 100);
};
