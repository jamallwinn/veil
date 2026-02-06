import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  TransactionPersistenceService,
  transactionPersistenceService,
  STORAGE_KEYS,
} from './persistence';
import type { OrchestratorTransaction } from './types';

// Mock secure storage service
vi.mock('@services/secure-storage', () => ({
  secureStorageService: {
    storeJSON: vi.fn().mockResolvedValue(undefined),
    getJSON: vi.fn().mockResolvedValue(null),
    delete: vi.fn().mockResolvedValue(undefined),
  },
}));

describe('TransactionPersistenceService', () => {
  let persistence: TransactionPersistenceService;
  let mockLocalStorage: Record<string, string>;

  beforeEach(() => {
    vi.clearAllMocks();

    // Mock localStorage
    mockLocalStorage = {};
    vi.stubGlobal('localStorage', {
      getItem: vi.fn((key: string) => mockLocalStorage[key] || null),
      setItem: vi.fn((key: string, value: string) => {
        mockLocalStorage[key] = value;
      }),
      removeItem: vi.fn((key: string) => {
        delete mockLocalStorage[key];
      }),
    });

    persistence = new TransactionPersistenceService();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const createMockTransaction = (
    overrides?: Partial<OrchestratorTransaction>
  ): OrchestratorTransaction => ({
    id: 'VEIL-TEST-123',
    currentPhase: 'DEPOSIT',
    phaseStatus: 'pending',
    params: {
      amount: '100',
      recipient: 'rRecipient123',
      senderXRPL: 'rSender123',
    },
    phaseResults: {},
    txHashes: {},
    startedAt: Date.now(),
    retryCount: 0,
    maxRetries: 3,
    lastUpdatedAt: Date.now(),
    ...overrides,
  });

  describe('saveActiveTransaction', () => {
    it('should save transaction to localStorage', async () => {
      const tx = createMockTransaction();

      await persistence.saveActiveTransaction(tx);

      expect(localStorage.setItem).toHaveBeenCalledWith(
        STORAGE_KEYS.ACTIVE_TRANSACTION,
        expect.any(String)
      );
    });

    it('should serialize transaction correctly', async () => {
      const tx = createMockTransaction();

      await persistence.saveActiveTransaction(tx);

      const savedValue = mockLocalStorage[STORAGE_KEYS.ACTIVE_TRANSACTION];
      const parsed = JSON.parse(savedValue);

      expect(parsed.id).toBe(tx.id);
      expect(parsed.currentPhase).toBe(tx.currentPhase);
      expect(parsed.params.amount).toBe(tx.params.amount);
    });
  });

  describe('loadActiveTransaction', () => {
    it('should return null when no transaction exists', async () => {
      const result = await persistence.loadActiveTransaction();

      expect(result).toBeNull();
    });

    it('should load and deserialize transaction', async () => {
      const tx = createMockTransaction();
      mockLocalStorage[STORAGE_KEYS.ACTIVE_TRANSACTION] = JSON.stringify({
        id: tx.id,
        currentPhase: tx.currentPhase,
        phaseStatus: tx.phaseStatus,
        params: tx.params,
        phaseResults: {},
        txHashes: {},
        startedAt: tx.startedAt,
        retryCount: tx.retryCount,
        maxRetries: tx.maxRetries,
        lastUpdatedAt: tx.lastUpdatedAt,
      });

      const result = await persistence.loadActiveTransaction();

      expect(result).toBeDefined();
      expect(result?.id).toBe(tx.id);
      expect(result?.currentPhase).toBe(tx.currentPhase);
    });

    it('should return null on parse error', async () => {
      mockLocalStorage[STORAGE_KEYS.ACTIVE_TRANSACTION] = 'invalid json';

      const result = await persistence.loadActiveTransaction();

      expect(result).toBeNull();
    });
  });

  describe('clearActiveTransaction', () => {
    it('should remove transaction from localStorage', async () => {
      const tx = createMockTransaction();
      mockLocalStorage[STORAGE_KEYS.ACTIVE_TRANSACTION] = JSON.stringify(tx);

      await persistence.clearActiveTransaction();

      expect(localStorage.removeItem).toHaveBeenCalledWith(
        STORAGE_KEYS.ACTIVE_TRANSACTION
      );
    });
  });

  describe('checkForPendingTransactions', () => {
    it('should return hasPending: false when no transaction exists', async () => {
      const result = await persistence.checkForPendingTransactions();

      expect(result.hasPending).toBe(false);
      expect(result.transaction).toBeNull();
    });

    it('should return hasPending: true when transaction exists', async () => {
      const tx = createMockTransaction();
      mockLocalStorage[STORAGE_KEYS.ACTIVE_TRANSACTION] = JSON.stringify({
        id: tx.id,
        currentPhase: tx.currentPhase,
        phaseStatus: tx.phaseStatus,
        params: tx.params,
        phaseResults: {},
        txHashes: {},
        startedAt: tx.startedAt,
        retryCount: tx.retryCount,
        maxRetries: tx.maxRetries,
        lastUpdatedAt: tx.lastUpdatedAt,
      });

      const result = await persistence.checkForPendingTransactions();

      expect(result.hasPending).toBe(true);
      expect(result.transaction).toBeDefined();
    });

    it('should set canResume: false for completed transactions', async () => {
      const tx = createMockTransaction({ currentPhase: 'COMPLETE' });
      mockLocalStorage[STORAGE_KEYS.ACTIVE_TRANSACTION] = JSON.stringify({
        id: tx.id,
        currentPhase: tx.currentPhase,
        phaseStatus: tx.phaseStatus,
        params: tx.params,
        phaseResults: {},
        txHashes: {},
        startedAt: tx.startedAt,
        retryCount: tx.retryCount,
        maxRetries: tx.maxRetries,
        lastUpdatedAt: tx.lastUpdatedAt,
      });

      const result = await persistence.checkForPendingTransactions();

      expect(result.hasPending).toBe(true);
      expect(result.canResume).toBe(false);
    });
  });

  describe('isTransactionRecoverable', () => {
    it('should return false for completed transactions', () => {
      const tx = createMockTransaction({ currentPhase: 'COMPLETE' });

      const result = persistence.isTransactionRecoverable(tx);

      expect(result).toBe(false);
    });

    it('should return true for pending transactions within retry limit', () => {
      const tx = createMockTransaction({
        currentPhase: 'DEPOSIT',
        retryCount: 1,
      });

      const result = persistence.isTransactionRecoverable(tx);

      expect(result).toBe(true);
    });

    it('should return true for failed transactions with retries left', () => {
      const tx = createMockTransaction({
        currentPhase: 'FAILED',
        retryCount: 1,
        maxRetries: 3,
      });

      const result = persistence.isTransactionRecoverable(tx);

      expect(result).toBe(true);
    });

    it('should return false for failed transactions at max retries', () => {
      const tx = createMockTransaction({
        currentPhase: 'FAILED',
        retryCount: 3,
        maxRetries: 3,
      });

      const result = persistence.isTransactionRecoverable(tx);

      expect(result).toBe(false);
    });

    it('should return false for old transactions', () => {
      const tx = createMockTransaction({
        lastUpdatedAt: Date.now() - 25 * 60 * 60 * 1000, // 25 hours ago
      });

      const result = persistence.isTransactionRecoverable(tx);

      expect(result).toBe(false);
    });
  });

  describe('saveToHistory', () => {
    it('should save transaction to history', async () => {
      const tx = createMockTransaction({ currentPhase: 'COMPLETE' });

      await persistence.saveToHistory(tx);

      expect(localStorage.setItem).toHaveBeenCalledWith(
        STORAGE_KEYS.TRANSACTION_HISTORY,
        expect.any(String)
      );
    });

    it('should add to existing history', async () => {
      const existingTx = createMockTransaction({ id: 'VEIL-OLD-111' });
      mockLocalStorage[STORAGE_KEYS.TRANSACTION_HISTORY] = JSON.stringify([
        {
          id: existingTx.id,
          currentPhase: existingTx.currentPhase,
          phaseStatus: existingTx.phaseStatus,
          params: existingTx.params,
          phaseResults: {},
          txHashes: {},
          startedAt: existingTx.startedAt,
          retryCount: existingTx.retryCount,
          maxRetries: existingTx.maxRetries,
          lastUpdatedAt: existingTx.lastUpdatedAt,
        },
      ]);

      const newTx = createMockTransaction({ id: 'VEIL-NEW-222' });
      await persistence.saveToHistory(newTx);

      const savedValue = mockLocalStorage[STORAGE_KEYS.TRANSACTION_HISTORY];
      const parsed = JSON.parse(savedValue);

      expect(parsed.length).toBe(2);
      expect(parsed[0].id).toBe('VEIL-NEW-222'); // Newest first
    });
  });

  describe('loadHistory', () => {
    it('should return empty array when no history exists', async () => {
      const result = await persistence.loadHistory();

      expect(result).toEqual([]);
    });

    it('should load and parse history', async () => {
      const tx = createMockTransaction();
      mockLocalStorage[STORAGE_KEYS.TRANSACTION_HISTORY] = JSON.stringify([
        {
          id: tx.id,
          currentPhase: tx.currentPhase,
          phaseStatus: tx.phaseStatus,
          params: tx.params,
          phaseResults: {},
          txHashes: {},
          startedAt: tx.startedAt,
          retryCount: tx.retryCount,
          maxRetries: tx.maxRetries,
          lastUpdatedAt: tx.lastUpdatedAt,
        },
      ]);

      const result = await persistence.loadHistory();

      expect(result.length).toBe(1);
      expect(result[0].id).toBe(tx.id);
    });
  });

  describe('clearAll', () => {
    it('should clear all storage keys', async () => {
      mockLocalStorage[STORAGE_KEYS.ACTIVE_TRANSACTION] = 'test';
      mockLocalStorage[STORAGE_KEYS.TRANSACTION_HISTORY] = 'test';

      await persistence.clearAll();

      expect(localStorage.removeItem).toHaveBeenCalledWith(STORAGE_KEYS.ACTIVE_TRANSACTION);
      expect(localStorage.removeItem).toHaveBeenCalledWith(STORAGE_KEYS.TRANSACTION_HISTORY);
    });
  });
});

describe('Singleton Instance', () => {
  it('should export a singleton instance', () => {
    expect(transactionPersistenceService).toBeDefined();
    expect(transactionPersistenceService).toBeInstanceOf(TransactionPersistenceService);
  });
});
