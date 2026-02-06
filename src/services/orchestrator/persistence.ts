/**
 * Transaction Persistence Service
 *
 * Handles saving and loading transaction state for recovery.
 * Uses localStorage for non-sensitive data and Tauri keychain for secrets.
 */

import type { OrchestratorTransaction } from './types';
import { OrchestratorError, ORCHESTRATOR_ERROR_CODES } from './types';
import { secureStorageService } from '@services/secure-storage';

// =============================================================================
// Constants
// =============================================================================

/**
 * Storage keys
 */
const STORAGE_KEYS = {
  /** Current active transaction */
  ACTIVE_TRANSACTION: 'veil_active_transaction',
  /** Transaction history */
  TRANSACTION_HISTORY: 'veil_transaction_history',
  /** Pending transactions for recovery */
  PENDING_TRANSACTIONS: 'veil_pending_transactions',
  /** Secure storage key prefix for deposit notes */
  DEPOSIT_NOTE_PREFIX: 'veil_deposit_note_',
} as const;

/**
 * Maximum transactions to keep in history
 */
const MAX_HISTORY_SIZE = 50;

// =============================================================================
// Types
// =============================================================================

/**
 * Serializable transaction state (for localStorage)
 */
export interface SerializedTransaction {
  id: string;
  currentPhase: string;
  phaseStatus: string;
  params: {
    amount: string;
    recipient: string;
    senderXRPL: string;
    senderEVM?: string;
    waitDuration?: number;
    skipWait?: boolean;
  };
  phaseResults: Record<string, {
    success: boolean;
    phase: string;
    data?: Record<string, unknown>;
    error?: string;
    txHash?: string;
    timestamp: number;
  }>;
  txHashes: {
    xrplBridge?: string;
    deposit?: string;
    withdraw?: string;
    evmBridge?: string;
  };
  depositData?: {
    commitment: string;
    nullifierHash: string;
    leafIndex: number;
  };
  withdrawData?: {
    proofGenerated: boolean;
    proofTimestamp?: number;
  };
  startedAt: number;
  completedAt?: number;
  error?: string;
  retryCount: number;
  maxRetries: number;
  lastUpdatedAt: number;
}

/**
 * Recovery result
 */
export interface RecoveryResult {
  hasPending: boolean;
  transaction: OrchestratorTransaction | null;
  canResume: boolean;
  message: string;
}

// =============================================================================
// Persistence Service
// =============================================================================

class TransactionPersistenceService {
  /**
   * Save the current active transaction
   */
  async saveActiveTransaction(transaction: OrchestratorTransaction): Promise<void> {
    try {
      const serialized = this.serializeTransaction(transaction);
      localStorage.setItem(
        STORAGE_KEYS.ACTIVE_TRANSACTION,
        JSON.stringify(serialized)
      );

      // Also save deposit note to secure storage if available
      if (transaction.depositData) {
        await this.saveDepositNote(transaction.id, transaction.depositData);
      }

      console.log(
        `[Persistence] Saved active transaction: ${transaction.id} at phase ${transaction.currentPhase}`
      );
    } catch (error) {
      throw new OrchestratorError(
        ORCHESTRATOR_ERROR_CODES.PERSISTENCE_ERROR,
        `Failed to save transaction: ${error instanceof Error ? error.message : 'Unknown error'}`,
        undefined,
        error
      );
    }
  }

  /**
   * Load the current active transaction
   */
  async loadActiveTransaction(): Promise<OrchestratorTransaction | null> {
    try {
      const data = localStorage.getItem(STORAGE_KEYS.ACTIVE_TRANSACTION);
      if (!data) {
        return null;
      }

      const serialized: SerializedTransaction = JSON.parse(data);
      const transaction = this.deserializeTransaction(serialized);

      // Load deposit note from secure storage if needed
      if (transaction.depositData) {
        const secureNote = await this.loadDepositNote(transaction.id);
        if (secureNote) {
          transaction.depositData = secureNote;
        }
      }

      console.log(
        `[Persistence] Loaded active transaction: ${transaction.id} at phase ${transaction.currentPhase}`
      );

      return transaction;
    } catch (error) {
      console.error('[Persistence] Failed to load active transaction:', error);
      return null;
    }
  }

  /**
   * Clear the active transaction
   */
  async clearActiveTransaction(): Promise<void> {
    try {
      // Get the transaction ID before clearing
      const data = localStorage.getItem(STORAGE_KEYS.ACTIVE_TRANSACTION);
      if (data) {
        const serialized: SerializedTransaction = JSON.parse(data);
        // Clean up secure storage
        await this.deleteDepositNote(serialized.id);
      }

      localStorage.removeItem(STORAGE_KEYS.ACTIVE_TRANSACTION);
      console.log('[Persistence] Cleared active transaction');
    } catch (error) {
      console.error('[Persistence] Failed to clear active transaction:', error);
    }
  }

  /**
   * Check for pending transactions that need recovery
   */
  async checkForPendingTransactions(): Promise<RecoveryResult> {
    try {
      const transaction = await this.loadActiveTransaction();

      if (!transaction) {
        return {
          hasPending: false,
          transaction: null,
          canResume: false,
          message: 'No pending transactions',
        };
      }

      // Check if the transaction is in a recoverable state
      const isRecoverable = this.isTransactionRecoverable(transaction);

      return {
        hasPending: true,
        transaction,
        canResume: isRecoverable,
        message: isRecoverable
          ? `Found pending transaction ${transaction.id} at phase ${transaction.currentPhase}`
          : `Found failed transaction ${transaction.id} - cannot resume`,
      };
    } catch (error) {
      console.error('[Persistence] Failed to check for pending transactions:', error);
      return {
        hasPending: false,
        transaction: null,
        canResume: false,
        message: 'Error checking for pending transactions',
      };
    }
  }

  /**
   * Check if a transaction can be resumed
   */
  isTransactionRecoverable(transaction: OrchestratorTransaction): boolean {
    // Cannot resume if already complete or permanently failed
    if (transaction.currentPhase === 'COMPLETE') {
      return false;
    }

    if (transaction.currentPhase === 'FAILED') {
      // Check if we can retry from the last successful phase
      return transaction.retryCount < transaction.maxRetries;
    }

    // Check if the transaction is not too old (24 hours)
    const maxAge = 24 * 60 * 60 * 1000;
    const age = Date.now() - transaction.lastUpdatedAt;
    if (age > maxAge) {
      console.warn(
        `[Persistence] Transaction ${transaction.id} is too old (${Math.round(age / 3600000)}h)`
      );
      return false;
    }

    return true;
  }

  /**
   * Save completed transaction to history
   */
  async saveToHistory(transaction: OrchestratorTransaction): Promise<void> {
    try {
      const historyData = localStorage.getItem(STORAGE_KEYS.TRANSACTION_HISTORY);
      const history: SerializedTransaction[] = historyData
        ? JSON.parse(historyData)
        : [];

      // Add to front of array
      const serialized = this.serializeTransaction(transaction);
      history.unshift(serialized);

      // Keep only the most recent transactions
      const trimmed = history.slice(0, MAX_HISTORY_SIZE);

      localStorage.setItem(
        STORAGE_KEYS.TRANSACTION_HISTORY,
        JSON.stringify(trimmed)
      );

      console.log(`[Persistence] Added transaction ${transaction.id} to history`);
    } catch (error) {
      console.error('[Persistence] Failed to save to history:', error);
    }
  }

  /**
   * Load transaction history
   */
  async loadHistory(): Promise<OrchestratorTransaction[]> {
    try {
      const historyData = localStorage.getItem(STORAGE_KEYS.TRANSACTION_HISTORY);
      if (!historyData) {
        return [];
      }

      const serialized: SerializedTransaction[] = JSON.parse(historyData);
      return serialized.map((s) => this.deserializeTransaction(s));
    } catch (error) {
      console.error('[Persistence] Failed to load history:', error);
      return [];
    }
  }

  /**
   * Clear all stored data (for testing/reset)
   */
  async clearAll(): Promise<void> {
    try {
      localStorage.removeItem(STORAGE_KEYS.ACTIVE_TRANSACTION);
      localStorage.removeItem(STORAGE_KEYS.TRANSACTION_HISTORY);
      localStorage.removeItem(STORAGE_KEYS.PENDING_TRANSACTIONS);
      console.log('[Persistence] Cleared all data');
    } catch (error) {
      console.error('[Persistence] Failed to clear all:', error);
    }
  }

  // ===========================================================================
  // Secure Storage for Deposit Notes
  // ===========================================================================

  /**
   * Save deposit note to secure storage
   */
  private async saveDepositNote(
    transactionId: string,
    depositData: OrchestratorTransaction['depositData']
  ): Promise<void> {
    if (!depositData) return;

    try {
      const key = `${STORAGE_KEYS.DEPOSIT_NOTE_PREFIX}${transactionId}`;
      await secureStorageService.storeJSON(key, depositData);
      console.log(`[Persistence] Saved deposit note for ${transactionId}`);
    } catch (error) {
      console.error('[Persistence] Failed to save deposit note:', error);
      // Don't throw - this is a secondary operation
    }
  }

  /**
   * Load deposit note from secure storage
   */
  private async loadDepositNote(
    transactionId: string
  ): Promise<OrchestratorTransaction['depositData'] | null> {
    try {
      const key = `${STORAGE_KEYS.DEPOSIT_NOTE_PREFIX}${transactionId}`;
      const data = await secureStorageService.getJSON<{
        commitment: string;
        nullifierHash: string;
        leafIndex: number;
      }>(key);
      return data;
    } catch (error) {
      console.error('[Persistence] Failed to load deposit note:', error);
      return null;
    }
  }

  /**
   * Delete deposit note from secure storage
   */
  private async deleteDepositNote(transactionId: string): Promise<void> {
    try {
      const key = `${STORAGE_KEYS.DEPOSIT_NOTE_PREFIX}${transactionId}`;
      await secureStorageService.delete(key);
      console.log(`[Persistence] Deleted deposit note for ${transactionId}`);
    } catch (error) {
      console.error('[Persistence] Failed to delete deposit note:', error);
    }
  }

  // ===========================================================================
  // Serialization
  // ===========================================================================

  /**
   * Serialize transaction for storage
   */
  private serializeTransaction(
    transaction: OrchestratorTransaction
  ): SerializedTransaction {
    return {
      id: transaction.id,
      currentPhase: transaction.currentPhase,
      phaseStatus: transaction.phaseStatus,
      params: { ...transaction.params },
      phaseResults: Object.fromEntries(
        Object.entries(transaction.phaseResults).map(([key, value]) => [
          key,
          value ? {
            success: value.success,
            phase: value.phase,
            data: value.data,
            error: value.error,
            txHash: value.txHash,
            timestamp: value.timestamp,
          } : undefined,
        ]).filter(([, v]) => v !== undefined)
      ) as SerializedTransaction['phaseResults'],
      txHashes: { ...transaction.txHashes },
      depositData: transaction.depositData
        ? { ...transaction.depositData }
        : undefined,
      withdrawData: transaction.withdrawData
        ? { ...transaction.withdrawData }
        : undefined,
      startedAt: transaction.startedAt,
      completedAt: transaction.completedAt,
      error: transaction.error,
      retryCount: transaction.retryCount,
      maxRetries: transaction.maxRetries,
      lastUpdatedAt: transaction.lastUpdatedAt,
    };
  }

  /**
   * Deserialize transaction from storage
   */
  private deserializeTransaction(
    serialized: SerializedTransaction
  ): OrchestratorTransaction {
    return {
      id: serialized.id,
      currentPhase: serialized.currentPhase as OrchestratorTransaction['currentPhase'],
      phaseStatus: serialized.phaseStatus as OrchestratorTransaction['phaseStatus'],
      params: { ...serialized.params },
      phaseResults: Object.fromEntries(
        Object.entries(serialized.phaseResults).map(([key, value]) => [
          key,
          value ? {
            success: value.success,
            phase: value.phase as OrchestratorTransaction['currentPhase'],
            data: value.data,
            error: value.error,
            txHash: value.txHash,
            timestamp: value.timestamp,
          } : undefined,
        ]).filter(([, v]) => v !== undefined)
      ) as OrchestratorTransaction['phaseResults'],
      txHashes: { ...serialized.txHashes },
      depositData: serialized.depositData
        ? { ...serialized.depositData }
        : undefined,
      withdrawData: serialized.withdrawData
        ? { ...serialized.withdrawData }
        : undefined,
      startedAt: serialized.startedAt,
      completedAt: serialized.completedAt,
      error: serialized.error,
      retryCount: serialized.retryCount,
      maxRetries: serialized.maxRetries,
      lastUpdatedAt: serialized.lastUpdatedAt,
    };
  }
}

// =============================================================================
// Export
// =============================================================================

/** Singleton instance */
export const transactionPersistenceService = new TransactionPersistenceService();

/** Export class for testing */
export { TransactionPersistenceService };

/** Export storage keys for testing */
export { STORAGE_KEYS };
