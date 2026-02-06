import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  TransactionOrchestratorService,
  transactionOrchestratorService,
  generateTransactionId,
  getPhaseProgress,
  getNextPhase,
  isValidPhaseTransition,
  PHASE_ORDER,
} from './index';
import { transactionPersistenceService } from './persistence';

// Mock dependent services
vi.mock('@services/bridge', () => ({
  axelarBridgeService: {
    setDemoMode: vi.fn(),
    setEVMProvider: vi.fn(),
    setEVMSignerService: vi.fn(),
    setGemWalletService: vi.fn(),
    setAxelarEnvironment: vi.fn(),
    bridgeToEVM: vi.fn(),
    bridgeToXRPL: vi.fn(),
    getBridgeStatus: vi.fn(),
  },
}));

vi.mock('@services/zkPool', () => ({
  zkPoolService: {
    setDemoMode: vi.fn(),
    isReady: vi.fn().mockReturnValue(true),
    initialize: vi.fn().mockResolvedValue(undefined),
    deposit: vi.fn(),
    withdraw: vi.fn(),
    generateWithdrawProof: vi.fn(),
    getAllNotes: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock('@services/gemwallet', () => ({
  gemWalletService: {
    isInstalled: vi.fn().mockResolvedValue(true),
    isValidAddress: vi.fn().mockReturnValue(true),
  },
}));

vi.mock('@services/evm/signer', () => ({
  evmSignerService: {
    getAddress: vi.fn().mockResolvedValue('0x1234567890abcdef1234567890abcdef12345678'),
  },
}));

vi.mock('@services/evm/provider', () => ({
  evmProviderService: {
    getProvider: vi.fn(),
    checkConnection: vi.fn().mockResolvedValue({ connected: true, chainId: 1449000 }),
  },
}));

vi.mock('./persistence', () => ({
  transactionPersistenceService: {
    saveActiveTransaction: vi.fn().mockResolvedValue(undefined),
    loadActiveTransaction: vi.fn().mockResolvedValue(null),
    clearActiveTransaction: vi.fn().mockResolvedValue(undefined),
    checkForPendingTransactions: vi.fn().mockResolvedValue({
      hasPending: false,
      transaction: null,
      canResume: false,
      message: 'No pending transactions',
    }),
    isTransactionRecoverable: vi.fn().mockReturnValue(true),
    saveToHistory: vi.fn().mockResolvedValue(undefined),
  },
}));

describe('TransactionOrchestratorService', () => {
  let orchestrator: TransactionOrchestratorService;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    orchestrator = new TransactionOrchestratorService({ demoMode: true });
  });

  afterEach(() => {
    vi.useRealTimers();
    orchestrator.cleanup();
  });

  describe('Configuration', () => {
    it('should have default configuration', () => {
      const config = orchestrator.getConfig();

      expect(config.maxRetries).toBe(3);
      expect(config.retryDelayMs).toBe(2000);
      expect(config.phaseTimeoutMs).toBe(120000);
    });

    it('should allow updating configuration', () => {
      orchestrator.updateConfig({ maxRetries: 5 });

      const config = orchestrator.getConfig();
      expect(config.maxRetries).toBe(5);
    });

    it('should toggle demo mode', () => {
      expect(orchestrator.isDemoMode()).toBe(true);

      orchestrator.setDemoMode(false);
      expect(orchestrator.isDemoMode()).toBe(false);
    });
  });

  describe('Transaction Lifecycle', () => {
    const validParams = {
      amount: '100',
      recipient: 'rRecipientAddress123456789012345',
      senderXRPL: 'rSenderAddress123456789012345678',
      senderEVM: '0x1234567890abcdef1234567890abcdef12345678',
      skipWait: true,
    };

    it('should start a new transaction', async () => {
      const tx = await orchestrator.start(validParams);

      expect(tx).toBeDefined();
      expect(tx.id).toMatch(/^VEIL-/);
      expect(tx.currentPhase).toBe('INITIATE');
      expect(tx.params).toMatchObject(validParams);
    });

    it('should reject invalid amount', async () => {
      await expect(
        orchestrator.start({ ...validParams, amount: '0' })
      ).rejects.toThrow();
    });

    it('should reject missing recipient', async () => {
      await expect(
        orchestrator.start({ ...validParams, recipient: '' })
      ).rejects.toThrow();
    });

    it('should reject starting a new transaction while one is active', async () => {
      await orchestrator.start(validParams);

      await expect(orchestrator.start(validParams)).rejects.toThrow(
        'A transaction is already in progress'
      );
    });

    it('should get current transaction', async () => {
      expect(orchestrator.getCurrentTransaction()).toBeNull();

      await orchestrator.start(validParams);

      const current = orchestrator.getCurrentTransaction();
      expect(current).toBeDefined();
      expect(current?.params.amount).toBe('100');
    });

    it('should report active state correctly', async () => {
      expect(orchestrator.isActive()).toBe(false);

      await orchestrator.start(validParams);

      expect(orchestrator.isActive()).toBe(true);
    });

    it('should abort an active transaction', async () => {
      await orchestrator.start(validParams);
      expect(orchestrator.isActive()).toBe(true);

      await orchestrator.abort();

      expect(orchestrator.isActive()).toBe(false);
      const tx = orchestrator.getCurrentTransaction();
      expect(tx?.currentPhase).toBe('FAILED');
      expect(tx?.error).toBe('Transaction aborted by user');
    });
  });

  describe('Event System', () => {
    const validParams = {
      amount: '100',
      recipient: 'rRecipientAddress123456789012345',
      senderXRPL: 'rSenderAddress123456789012345678',
      skipWait: true,
    };

    it('should emit phase_started event when starting', async () => {
      const listener = vi.fn();
      orchestrator.on('phase_started', listener);

      await orchestrator.start(validParams);

      // Advance timers for async execution
      await vi.advanceTimersByTimeAsync(100);

      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'phase_started',
          phase: 'INITIATE',
        })
      );
    });

    it('should allow unsubscribing from events', async () => {
      const listener = vi.fn();
      const unsubscribe = orchestrator.on('phase_started', listener);

      unsubscribe();

      await orchestrator.start(validParams);
      await vi.advanceTimersByTimeAsync(100);

      expect(listener).not.toHaveBeenCalled();
    });

    it('should remove all listeners', async () => {
      const listener = vi.fn();
      orchestrator.on('phase_started', listener);
      orchestrator.on('phase_completed', listener);

      orchestrator.removeAllListeners();

      await orchestrator.start(validParams);
      await vi.advanceTimersByTimeAsync(100);

      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe('Recovery', () => {
    it('should check for pending transactions', async () => {
      const result = await orchestrator.checkForPendingTransactions();

      expect(result.hasPending).toBe(false);
      expect(transactionPersistenceService.checkForPendingTransactions).toHaveBeenCalled();
    });

    it('should return recovery result with pending transaction', async () => {
      const mockTx = {
        id: 'VEIL-TEST-123',
        currentPhase: 'DEPOSIT' as const,
        phaseStatus: 'pending' as const,
        params: {
          amount: '100',
          recipient: 'rTest',
          senderXRPL: 'rSender',
        },
        phaseResults: {},
        txHashes: {},
        startedAt: Date.now(),
        retryCount: 0,
        maxRetries: 3,
        lastUpdatedAt: Date.now(),
      };

      vi.mocked(transactionPersistenceService.checkForPendingTransactions).mockResolvedValueOnce({
        hasPending: true,
        transaction: mockTx,
        canResume: true,
        message: 'Found pending transaction',
      });

      const result = await orchestrator.checkForPendingTransactions();

      expect(result.hasPending).toBe(true);
      expect(result.canResume).toBe(true);
      expect(result.transaction).toEqual(mockTx);
    });
  });

  describe('Cleanup', () => {
    it('should cleanup resources', () => {
      orchestrator.cleanup();

      expect(orchestrator.isActive()).toBe(false);
    });
  });
});

describe('Orchestrator Utility Functions', () => {
  describe('generateTransactionId', () => {
    it('should generate unique IDs', () => {
      const id1 = generateTransactionId();
      const id2 = generateTransactionId();

      expect(id1).toMatch(/^VEIL-/);
      expect(id2).toMatch(/^VEIL-/);
      expect(id1).not.toBe(id2);
    });
  });

  describe('getPhaseProgress', () => {
    it('should return 0 for INITIATE', () => {
      expect(getPhaseProgress('INITIATE')).toBe(0);
    });

    it('should return 100 for COMPLETE', () => {
      expect(getPhaseProgress('COMPLETE')).toBe(100);
    });

    it('should return intermediate values for middle phases', () => {
      expect(getPhaseProgress('DEPOSIT')).toBeGreaterThan(0);
      expect(getPhaseProgress('DEPOSIT')).toBeLessThan(100);
    });
  });

  describe('getNextPhase', () => {
    it('should return BRIDGE_TO_EVM after INITIATE', () => {
      expect(getNextPhase('INITIATE')).toBe('BRIDGE_TO_EVM');
    });

    it('should return DEPOSIT after BRIDGE_TO_EVM', () => {
      expect(getNextPhase('BRIDGE_TO_EVM')).toBe('DEPOSIT');
    });

    it('should skip WAIT when skipWait is true', () => {
      expect(getNextPhase('DEPOSIT', true)).toBe('PROVE');
    });

    it('should not skip WAIT when skipWait is false', () => {
      expect(getNextPhase('DEPOSIT', false)).toBe('WAIT');
    });

    it('should return null after COMPLETE', () => {
      expect(getNextPhase('COMPLETE')).toBeNull();
    });
  });

  describe('isValidPhaseTransition', () => {
    it('should allow INITIATE to BRIDGE_TO_EVM', () => {
      expect(isValidPhaseTransition('INITIATE', 'BRIDGE_TO_EVM')).toBe(true);
    });

    it('should allow any phase to FAILED', () => {
      expect(isValidPhaseTransition('INITIATE', 'FAILED')).toBe(true);
      expect(isValidPhaseTransition('PROVE', 'FAILED')).toBe(true);
    });

    it('should allow DEPOSIT to PROVE (skip WAIT)', () => {
      expect(isValidPhaseTransition('DEPOSIT', 'PROVE')).toBe(true);
    });

    it('should not allow backwards transitions', () => {
      expect(isValidPhaseTransition('PROVE', 'INITIATE')).toBe(false);
    });

    it('should not allow skipping multiple phases', () => {
      expect(isValidPhaseTransition('INITIATE', 'DEPOSIT')).toBe(false);
    });
  });

  describe('PHASE_ORDER', () => {
    it('should have all phases in correct order', () => {
      expect(PHASE_ORDER[0]).toBe('INITIATE');
      expect(PHASE_ORDER[PHASE_ORDER.length - 1]).toBe('COMPLETE');
    });

    it('should include all expected phases', () => {
      expect(PHASE_ORDER).toContain('BRIDGE_TO_EVM');
      expect(PHASE_ORDER).toContain('DEPOSIT');
      expect(PHASE_ORDER).toContain('WAIT');
      expect(PHASE_ORDER).toContain('PROVE');
      expect(PHASE_ORDER).toContain('WITHDRAW');
      expect(PHASE_ORDER).toContain('BRIDGE_TO_XRPL');
    });
  });
});

describe('Singleton Instance', () => {
  it('should export a singleton instance', () => {
    expect(transactionOrchestratorService).toBeDefined();
    expect(transactionOrchestratorService).toBeInstanceOf(TransactionOrchestratorService);
  });
});
