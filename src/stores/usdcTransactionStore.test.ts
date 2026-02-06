/**
 * USDC Transaction Store Tests
 *
 * Tests for the USDC transaction state management store.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { act } from '@testing-library/react';
import {
  useUsdcTransactionStore,
  phaseToStage,
  type UsdcTransactionPhase,
  type UsdcFeeBreakdown,
} from './usdcTransactionStore';

describe('useUsdcTransactionStore', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Reset store to initial state before each test
    act(() => {
      useUsdcTransactionStore.setState({
        currentTransaction: null,
        currentPhase: 'IDLE',
        progress: 0,
        statusMessage: '',
        error: null,
        history: [],
      });
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ===========================================================================
  // Phase to Stage Mapping
  // ===========================================================================

  describe('phaseToStage mapping', () => {
    it('should map securing phases correctly', () => {
      expect(phaseToStage.INITIATE).toBe('securing');
      expect(phaseToStage.APPROVAL).toBe('securing');
      expect(phaseToStage.BRIDGE_TO_EVM).toBe('securing');
      expect(phaseToStage.DEPOSIT).toBe('securing');
    });

    it('should map privacy phases correctly', () => {
      expect(phaseToStage.WAIT).toBe('privacy');
      expect(phaseToStage.PROVE).toBe('privacy');
    });

    it('should map delivery phases correctly', () => {
      expect(phaseToStage.WITHDRAW).toBe('delivery');
      expect(phaseToStage.BRIDGE_TO_XRPL).toBe('delivery');
    });

    it('should map complete phase correctly', () => {
      expect(phaseToStage.COMPLETE).toBe('complete');
    });

    it('should map null phases correctly', () => {
      expect(phaseToStage.IDLE).toBeNull();
      expect(phaseToStage.FAILED).toBeNull();
    });

    it('should include APPROVAL phase (unique to USDC)', () => {
      expect(phaseToStage.APPROVAL).toBe('securing');
    });
  });

  // ===========================================================================
  // Initial State
  // ===========================================================================

  describe('initial state', () => {
    it('should start with correct initial state', () => {
      const state = useUsdcTransactionStore.getState();

      expect(state.currentTransaction).toBeNull();
      expect(state.currentPhase).toBe('IDLE');
      expect(state.progress).toBe(0);
      expect(state.statusMessage).toBe('');
      expect(state.error).toBeNull();
      expect(state.history).toEqual([]);
    });
  });

  // ===========================================================================
  // initTransaction
  // ===========================================================================

  describe('initTransaction', () => {
    const mockFees: UsdcFeeBreakdown = {
      bridge: 0.1,
      bridgeGas: 0.2,
      privacy: 0.5,
      evmGas: 0.01,
      approval: 0.005,
      xrpBridgeGas: 1.1,
      total: 0.815,
      totalXrpGas: 1.1,
    };

    it('should initialize a new transaction', () => {
      act(() => {
        useUsdcTransactionStore.getState().initTransaction({
          amount: '100',
          recipient: 'rRecipientAddress123456789012345',
          fees: mockFees,
        });
      });

      const state = useUsdcTransactionStore.getState();

      expect(state.currentTransaction).not.toBeNull();
      expect(state.currentTransaction?.amount).toBe('100');
      expect(state.currentTransaction?.recipient).toBe('rRecipientAddress123456789012345');
      expect(state.currentTransaction?.fees).toEqual(mockFees);
      expect(state.currentTransaction?.phase).toBe('INITIATE');
      expect(state.currentPhase).toBe('INITIATE');
      expect(state.progress).toBe(0);
      expect(state.error).toBeNull();
    });

    it('should generate unique transaction IDs', () => {
      act(() => {
        useUsdcTransactionStore.getState().initTransaction({
          amount: '100',
          recipient: 'rRecipient1',
          fees: mockFees,
        });
      });
      const id1 = useUsdcTransactionStore.getState().currentTransaction?.id;

      act(() => {
        useUsdcTransactionStore.getState().clearTransaction();
        useUsdcTransactionStore.getState().initTransaction({
          amount: '200',
          recipient: 'rRecipient2',
          fees: mockFees,
        });
      });
      const id2 = useUsdcTransactionStore.getState().currentTransaction?.id;

      expect(id1).not.toBe(id2);
    });

    it('should set started timestamp', () => {
      act(() => {
        useUsdcTransactionStore.getState().initTransaction({
          amount: '100',
          recipient: 'rRecipient',
          fees: mockFees,
        });
      });

      const startedAt = useUsdcTransactionStore.getState().currentTransaction?.startedAt;
      expect(startedAt).toBeDefined();
      expect(startedAt).toBeGreaterThan(0);
    });
  });

  // ===========================================================================
  // setPhase
  // ===========================================================================

  describe('setPhase', () => {
    const mockFees: UsdcFeeBreakdown = {
      bridge: 0.1,
      bridgeGas: 0.2,
      privacy: 0.5,
      evmGas: 0.01,
      approval: 0.005,
      xrpBridgeGas: 1.1,
      total: 0.815,
      totalXrpGas: 1.1,
    };

    beforeEach(() => {
      act(() => {
        useUsdcTransactionStore.getState().initTransaction({
          amount: '100',
          recipient: 'rRecipient',
          fees: mockFees,
        });
      });
    });

    it('should update phase', () => {
      act(() => {
        useUsdcTransactionStore.getState().setPhase('APPROVAL');
      });

      const state = useUsdcTransactionStore.getState();
      expect(state.currentPhase).toBe('APPROVAL');
      expect(state.currentTransaction?.phase).toBe('APPROVAL');
    });

    it('should update through all phases', () => {
      const phases: UsdcTransactionPhase[] = [
        'INITIATE',
        'APPROVAL',
        'BRIDGE_TO_EVM',
        'DEPOSIT',
        'WAIT',
        'PROVE',
        'WITHDRAW',
        'BRIDGE_TO_XRPL',
        'COMPLETE',
      ];

      phases.forEach((phase) => {
        act(() => {
          useUsdcTransactionStore.getState().setPhase(phase);
        });

        expect(useUsdcTransactionStore.getState().currentPhase).toBe(phase);
      });
    });

    it('should do nothing if no current transaction', () => {
      act(() => {
        useUsdcTransactionStore.getState().clearTransaction();
        useUsdcTransactionStore.getState().setPhase('DEPOSIT');
      });

      expect(useUsdcTransactionStore.getState().currentPhase).toBe('IDLE');
    });
  });

  // ===========================================================================
  // setProgress
  // ===========================================================================

  describe('setProgress', () => {
    it('should update progress', () => {
      act(() => {
        useUsdcTransactionStore.getState().setProgress(50);
      });

      expect(useUsdcTransactionStore.getState().progress).toBe(50);
    });

    it('should allow progress from 0 to 100', () => {
      act(() => {
        useUsdcTransactionStore.getState().setProgress(0);
      });
      expect(useUsdcTransactionStore.getState().progress).toBe(0);

      act(() => {
        useUsdcTransactionStore.getState().setProgress(100);
      });
      expect(useUsdcTransactionStore.getState().progress).toBe(100);
    });
  });

  // ===========================================================================
  // setStatusMessage
  // ===========================================================================

  describe('setStatusMessage', () => {
    it('should update status message', () => {
      act(() => {
        useUsdcTransactionStore.getState().setStatusMessage('Approving ERC-20...');
      });

      expect(useUsdcTransactionStore.getState().statusMessage).toBe('Approving ERC-20...');
    });
  });

  // ===========================================================================
  // setTxHash
  // ===========================================================================

  describe('setTxHash', () => {
    const mockFees: UsdcFeeBreakdown = {
      bridge: 0.1,
      bridgeGas: 0.2,
      privacy: 0.5,
      evmGas: 0.01,
      approval: 0.005,
      xrpBridgeGas: 1.1,
      total: 0.815,
      totalXrpGas: 1.1,
    };

    beforeEach(() => {
      act(() => {
        useUsdcTransactionStore.getState().initTransaction({
          amount: '100',
          recipient: 'rRecipient',
          fees: mockFees,
        });
      });
    });

    it('should set approval tx hash (unique to USDC)', () => {
      act(() => {
        useUsdcTransactionStore.getState().setTxHash('approval', '0xApprovalHash');
      });

      expect(useUsdcTransactionStore.getState().currentTransaction?.txHashes.approval).toBe('0xApprovalHash');
    });

    it('should set all tx hash types', () => {
      act(() => {
        useUsdcTransactionStore.getState().setTxHash('approval', '0xApproval');
        useUsdcTransactionStore.getState().setTxHash('xrplBridge', '0xBridge1');
        useUsdcTransactionStore.getState().setTxHash('deposit', '0xDeposit');
        useUsdcTransactionStore.getState().setTxHash('withdraw', '0xWithdraw');
        useUsdcTransactionStore.getState().setTxHash('evmBridge', '0xBridge2');
      });

      const txHashes = useUsdcTransactionStore.getState().currentTransaction?.txHashes;
      expect(txHashes?.approval).toBe('0xApproval');
      expect(txHashes?.xrplBridge).toBe('0xBridge1');
      expect(txHashes?.deposit).toBe('0xDeposit');
      expect(txHashes?.withdraw).toBe('0xWithdraw');
      expect(txHashes?.evmBridge).toBe('0xBridge2');
    });

    it('should do nothing if no current transaction', () => {
      act(() => {
        useUsdcTransactionStore.getState().clearTransaction();
        useUsdcTransactionStore.getState().setTxHash('deposit', '0xHash');
      });

      expect(useUsdcTransactionStore.getState().currentTransaction).toBeNull();
    });
  });

  // ===========================================================================
  // setDepositData
  // ===========================================================================

  describe('setDepositData', () => {
    const mockFees: UsdcFeeBreakdown = {
      bridge: 0.1,
      bridgeGas: 0.2,
      privacy: 0.5,
      evmGas: 0.01,
      approval: 0.005,
      xrpBridgeGas: 1.1,
      total: 0.815,
      totalXrpGas: 1.1,
    };

    beforeEach(() => {
      act(() => {
        useUsdcTransactionStore.getState().initTransaction({
          amount: '100',
          recipient: 'rRecipient',
          fees: mockFees,
        });
      });
    });

    it('should set deposit data', () => {
      const depositData = {
        commitment: '0xCommitment',
        nullifier: '0xNullifier',
        secret: '0xSecret',
        leafIndex: 5,
      };

      act(() => {
        useUsdcTransactionStore.getState().setDepositData(depositData);
      });

      expect(useUsdcTransactionStore.getState().currentTransaction?.depositData).toEqual(depositData);
    });
  });

  // ===========================================================================
  // setError
  // ===========================================================================

  describe('setError', () => {
    const mockFees: UsdcFeeBreakdown = {
      bridge: 0.1,
      bridgeGas: 0.2,
      privacy: 0.5,
      evmGas: 0.01,
      approval: 0.005,
      xrpBridgeGas: 1.1,
      total: 0.815,
      totalXrpGas: 1.1,
    };

    beforeEach(() => {
      act(() => {
        useUsdcTransactionStore.getState().initTransaction({
          amount: '100',
          recipient: 'rRecipient',
          fees: mockFees,
        });
      });
    });

    it('should set error and update phase to FAILED', () => {
      act(() => {
        useUsdcTransactionStore.getState().setError('ERC-20 approval failed');
      });

      const state = useUsdcTransactionStore.getState();
      expect(state.error).toBe('ERC-20 approval failed');
      expect(state.currentPhase).toBe('FAILED');
      expect(state.currentTransaction?.phase).toBe('FAILED');
      expect(state.currentTransaction?.error).toBe('ERC-20 approval failed');
    });
  });

  // ===========================================================================
  // completeTransaction
  // ===========================================================================

  describe('completeTransaction', () => {
    const mockFees: UsdcFeeBreakdown = {
      bridge: 0.1,
      bridgeGas: 0.2,
      privacy: 0.5,
      evmGas: 0.01,
      approval: 0.005,
      xrpBridgeGas: 1.1,
      total: 0.815,
      totalXrpGas: 1.1,
    };

    beforeEach(() => {
      act(() => {
        useUsdcTransactionStore.getState().initTransaction({
          amount: '100',
          recipient: 'rRecipient',
          fees: mockFees,
        });
      });
    });

    it('should complete transaction and update state', () => {
      act(() => {
        useUsdcTransactionStore.getState().completeTransaction();
      });

      const state = useUsdcTransactionStore.getState();
      expect(state.currentPhase).toBe('COMPLETE');
      expect(state.progress).toBe(100);
      expect(state.statusMessage).toBe('Transaction complete!');
      expect(state.currentTransaction?.phase).toBe('COMPLETE');
      expect(state.currentTransaction?.completedAt).toBeDefined();
    });

    it('should add completed transaction to history', () => {
      act(() => {
        useUsdcTransactionStore.getState().completeTransaction();
      });

      const history = useUsdcTransactionStore.getState().history;
      expect(history).toHaveLength(1);
      expect(history[0].phase).toBe('COMPLETE');
    });

    it('should limit history to 50 items', () => {
      // Complete 55 transactions
      for (let i = 0; i < 55; i++) {
        act(() => {
          useUsdcTransactionStore.getState().initTransaction({
            amount: `${i}`,
            recipient: 'rRecipient',
            fees: mockFees,
          });
          useUsdcTransactionStore.getState().completeTransaction();
        });
      }

      expect(useUsdcTransactionStore.getState().history).toHaveLength(50);
    });
  });

  // ===========================================================================
  // clearTransaction
  // ===========================================================================

  describe('clearTransaction', () => {
    const mockFees: UsdcFeeBreakdown = {
      bridge: 0.1,
      bridgeGas: 0.2,
      privacy: 0.5,
      evmGas: 0.01,
      approval: 0.005,
      xrpBridgeGas: 1.1,
      total: 0.815,
      totalXrpGas: 1.1,
    };

    beforeEach(() => {
      act(() => {
        useUsdcTransactionStore.getState().initTransaction({
          amount: '100',
          recipient: 'rRecipient',
          fees: mockFees,
        });
      });
    });

    it('should clear current transaction', () => {
      act(() => {
        useUsdcTransactionStore.getState().clearTransaction();
      });

      const state = useUsdcTransactionStore.getState();
      expect(state.currentTransaction).toBeNull();
      expect(state.currentPhase).toBe('IDLE');
      expect(state.progress).toBe(0);
      expect(state.statusMessage).toBe('');
      expect(state.error).toBeNull();
    });

    it('should preserve history', () => {
      act(() => {
        useUsdcTransactionStore.getState().completeTransaction();
      });
      const historyBefore = useUsdcTransactionStore.getState().history.length;

      act(() => {
        useUsdcTransactionStore.getState().initTransaction({
          amount: '200',
          recipient: 'rRecipient2',
          fees: mockFees,
        });
        useUsdcTransactionStore.getState().clearTransaction();
      });

      expect(useUsdcTransactionStore.getState().history).toHaveLength(historyBefore);
    });
  });

  // ===========================================================================
  // simulateProgress (Demo Mode)
  // ===========================================================================

  describe('simulateProgress', () => {
    const mockFees: UsdcFeeBreakdown = {
      bridge: 0.1,
      bridgeGas: 0.2,
      privacy: 0.5,
      evmGas: 0.01,
      approval: 0.005,
      xrpBridgeGas: 1.1,
      total: 0.815,
      totalXrpGas: 1.1,
    };

    beforeEach(() => {
      act(() => {
        useUsdcTransactionStore.getState().initTransaction({
          amount: '100',
          recipient: 'rRecipient',
          fees: mockFees,
        });
      });
    });

    it('should progress through phases automatically', async () => {
      act(() => {
        useUsdcTransactionStore.getState().simulateProgress();
      });

      // After first interval, should move to BRIDGE_TO_EVM (bridge first to fund wallet)
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000);
      });
      expect(useUsdcTransactionStore.getState().currentPhase).toBe('BRIDGE_TO_EVM');

      // After more time, should progress to APPROVAL then DEPOSIT
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2000);
      });
      expect(['APPROVAL', 'DEPOSIT'].includes(useUsdcTransactionStore.getState().currentPhase)).toBe(true);
    });

    it('should complete after all phases', async () => {
      act(() => {
        useUsdcTransactionStore.getState().simulateProgress();
      });

      // Advance through all phases (total ~12 seconds)
      await act(async () => {
        await vi.advanceTimersByTimeAsync(15000);
      });

      const state = useUsdcTransactionStore.getState();
      expect(state.currentPhase).toBe('COMPLETE');
      expect(state.progress).toBe(100);
    });

    it('should include APPROVAL phase in simulation', async () => {
      const phasesObserved: UsdcTransactionPhase[] = [];

      act(() => {
        useUsdcTransactionStore.getState().simulateProgress();
      });

      // Capture phases as we progress
      for (let i = 0; i < 15; i++) {
        await act(async () => {
          await vi.advanceTimersByTimeAsync(1000);
        });
        const currentPhase = useUsdcTransactionStore.getState().currentPhase;
        if (!phasesObserved.includes(currentPhase)) {
          phasesObserved.push(currentPhase);
        }
      }

      expect(phasesObserved).toContain('APPROVAL');
    });
  });

  // ===========================================================================
  // Persistence
  // ===========================================================================

  describe('persistence', () => {
    it('should have correct store name', () => {
      // The persist middleware should use 'veil-usdc-transaction-store'
      expect(useUsdcTransactionStore.persist.getOptions().name).toBe('veil-usdc-transaction-store');
    });
  });
});
