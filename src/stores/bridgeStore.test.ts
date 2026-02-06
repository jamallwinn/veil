import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { useBridgeStore, getBridgeProgress, isBridgeTerminal } from './bridgeStore';
import { axelarBridgeService } from '@services/bridge';

// Mock the bridge service
vi.mock('@services/bridge', () => ({
  axelarBridgeService: {
    bridgeToEVM: vi.fn(),
    bridgeToXRPL: vi.fn(),
    getBridgeStatus: vi.fn(),
  },
}));

// Reset store between tests
beforeEach(() => {
  useBridgeStore.getState().reset();
  vi.clearAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('bridgeStore', () => {
  describe('initial state', () => {
    it('should have correct initial state', () => {
      const state = useBridgeStore.getState();

      expect(state.isActive).toBe(false);
      expect(state.direction).toBeNull();
      expect(state.txHash).toBeNull();
      expect(state.status).toBeNull();
      expect(state.confirmations).toBe(0);
      expect(state.requiredConfirmations).toBe(0);
      expect(state.estimatedTimeRemaining).toBeNull();
      expect(state.error).toBeNull();
      expect(state.isInitiating).toBe(false);
      expect(state.isPolling).toBe(false);
    });
  });

  describe('startBridgeToEVM', () => {
    it('should successfully initiate bridge to EVM', async () => {
      const mockTxHash = '0xABC123DEF456';
      vi.mocked(axelarBridgeService.bridgeToEVM).mockResolvedValueOnce({
        success: true,
        txHash: mockTxHash,
      });

      const { startBridgeToEVM } = useBridgeStore.getState();

      const result = await startBridgeToEVM(
        '100',
        'rTestXRPLAddress123456789',
        '0x1234567890123456789012345678901234567890'
      );

      expect(result.success).toBe(true);
      expect(result.txHash).toBe(mockTxHash);

      const state = useBridgeStore.getState();
      expect(state.isActive).toBe(true);
      expect(state.direction).toBe('toEVM');
      expect(state.txHash).toBe(mockTxHash);
      expect(state.status).toBe('pending');
      expect(state.requiredConfirmations).toBe(6);
    });

    it('should handle bridge initiation failure', async () => {
      vi.mocked(axelarBridgeService.bridgeToEVM).mockResolvedValueOnce({
        success: false,
        txHash: null,
        error: 'Insufficient funds',
      });

      const { startBridgeToEVM } = useBridgeStore.getState();

      const result = await startBridgeToEVM(
        '100',
        'rTestXRPLAddress123456789',
        '0x1234567890123456789012345678901234567890'
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('Insufficient funds');

      const state = useBridgeStore.getState();
      expect(state.isActive).toBe(false);
      expect(state.error).toBe('Insufficient funds');
    });

    it('should handle exceptions during bridge initiation', async () => {
      vi.mocked(axelarBridgeService.bridgeToEVM).mockRejectedValueOnce(
        new Error('Network error')
      );

      const { startBridgeToEVM } = useBridgeStore.getState();

      const result = await startBridgeToEVM(
        '100',
        'rTestXRPLAddress123456789',
        '0x1234567890123456789012345678901234567890'
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('Network error');

      const state = useBridgeStore.getState();
      expect(state.error).toBe('Network error');
    });

    it('should set isInitiating during bridge start', async () => {
      let resolvePromise: (value: unknown) => void;
      const pendingPromise = new Promise((resolve) => {
        resolvePromise = resolve;
      });

      vi.mocked(axelarBridgeService.bridgeToEVM).mockReturnValueOnce(
        pendingPromise as Promise<{ success: boolean; txHash: string | null }>
      );

      const { startBridgeToEVM } = useBridgeStore.getState();

      const bridgePromise = startBridgeToEVM(
        '100',
        'rTestXRPLAddress123456789',
        '0x1234567890123456789012345678901234567890'
      );

      // Should be initiating while promise is pending
      expect(useBridgeStore.getState().isInitiating).toBe(true);

      // Resolve the promise
      resolvePromise!({ success: true, txHash: '0xABC123' });
      await bridgePromise;

      // Should no longer be initiating
      expect(useBridgeStore.getState().isInitiating).toBe(false);
    });
  });

  describe('startBridgeToXRPL', () => {
    it('should successfully initiate bridge to XRPL', async () => {
      const mockTxHash = 'XRPL_TX_HASH_123';
      vi.mocked(axelarBridgeService.bridgeToXRPL).mockResolvedValueOnce({
        success: true,
        txHash: mockTxHash,
      });

      const { startBridgeToXRPL } = useBridgeStore.getState();

      const result = await startBridgeToXRPL(
        '100',
        '0x1234567890123456789012345678901234567890',
        'rTestXRPLAddress123456789'
      );

      expect(result.success).toBe(true);
      expect(result.txHash).toBe(mockTxHash);

      const state = useBridgeStore.getState();
      expect(state.isActive).toBe(true);
      expect(state.direction).toBe('toXRPL');
      expect(state.txHash).toBe(mockTxHash);
      expect(state.status).toBe('pending');
      expect(state.requiredConfirmations).toBe(12);
    });

    it('should handle bridge initiation failure', async () => {
      vi.mocked(axelarBridgeService.bridgeToXRPL).mockResolvedValueOnce({
        success: false,
        txHash: null,
        error: 'Bridge unavailable',
      });

      const { startBridgeToXRPL } = useBridgeStore.getState();

      const result = await startBridgeToXRPL(
        '100',
        '0x1234567890123456789012345678901234567890',
        'rTestXRPLAddress123456789'
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('Bridge unavailable');
    });
  });

  describe('updateStatus', () => {
    it('should update bridge status correctly', () => {
      const { updateStatus } = useBridgeStore.getState();

      updateStatus({
        status: 'confirming',
        confirmations: 3,
        requiredConfirmations: 6,
        estimatedTimeRemaining: 10,
      });

      const state = useBridgeStore.getState();
      expect(state.status).toBe('confirming');
      expect(state.confirmations).toBe(3);
      expect(state.requiredConfirmations).toBe(6);
      expect(state.estimatedTimeRemaining).toBe(10);
    });

    it('should handle undefined estimatedTimeRemaining', () => {
      const { updateStatus } = useBridgeStore.getState();

      updateStatus({
        status: 'pending',
        confirmations: 1,
        requiredConfirmations: 6,
      });

      expect(useBridgeStore.getState().estimatedTimeRemaining).toBeNull();
    });
  });

  describe('pollBridgeStatus', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    it('should poll for status updates', async () => {
      vi.mocked(axelarBridgeService.getBridgeStatus).mockResolvedValue({
        status: 'confirming',
        confirmations: 1,
        requiredConfirmations: 6,
        estimatedTimeRemaining: 15,
      });

      const { pollBridgeStatus } = useBridgeStore.getState();
      const cleanup = pollBridgeStatus('0xTEST_HASH');

      // Advance timer to trigger first poll
      await vi.advanceTimersByTimeAsync(1000);

      expect(axelarBridgeService.getBridgeStatus).toHaveBeenCalledWith('0xTEST_HASH');

      const state = useBridgeStore.getState();
      expect(state.confirmations).toBe(1);
      expect(state.status).toBe('confirming');
      expect(state.isPolling).toBe(true);

      cleanup();
    });

    it('should call onComplete when bridge completes', async () => {
      vi.mocked(axelarBridgeService.getBridgeStatus).mockResolvedValue({
        status: 'complete',
        confirmations: 6,
        requiredConfirmations: 6,
      });

      const onComplete = vi.fn();
      const { pollBridgeStatus } = useBridgeStore.getState();
      const cleanup = pollBridgeStatus('0xTEST_HASH', onComplete);

      await vi.advanceTimersByTimeAsync(1000);

      expect(onComplete).toHaveBeenCalled();
      expect(useBridgeStore.getState().status).toBe('complete');

      cleanup();
    });

    it('should call onError when bridge fails', async () => {
      vi.mocked(axelarBridgeService.getBridgeStatus).mockResolvedValue({
        status: 'failed',
        confirmations: 2,
        requiredConfirmations: 6,
      });

      const onError = vi.fn();
      const { pollBridgeStatus } = useBridgeStore.getState();
      const cleanup = pollBridgeStatus('0xTEST_HASH', undefined, onError);

      await vi.advanceTimersByTimeAsync(1000);

      expect(onError).toHaveBeenCalledWith('Bridge transaction failed');
      expect(useBridgeStore.getState().status).toBe('failed');

      cleanup();
    });

    it('should handle polling errors', async () => {
      vi.mocked(axelarBridgeService.getBridgeStatus).mockRejectedValue(
        new Error('API error')
      );

      const onError = vi.fn();
      const { pollBridgeStatus } = useBridgeStore.getState();
      const cleanup = pollBridgeStatus('0xTEST_HASH', undefined, onError);

      await vi.advanceTimersByTimeAsync(1000);

      expect(onError).toHaveBeenCalledWith('API error');
      expect(useBridgeStore.getState().error).toBe('API error');

      cleanup();
    });

    it('should stop polling when cleanup is called', async () => {
      vi.mocked(axelarBridgeService.getBridgeStatus).mockResolvedValue({
        status: 'confirming',
        confirmations: 1,
        requiredConfirmations: 6,
      });

      const { pollBridgeStatus } = useBridgeStore.getState();
      const cleanup = pollBridgeStatus('0xTEST_HASH');

      // First poll
      await vi.advanceTimersByTimeAsync(1000);
      expect(axelarBridgeService.getBridgeStatus).toHaveBeenCalledTimes(1);

      // Cleanup
      cleanup();

      // No more polls should occur
      await vi.advanceTimersByTimeAsync(2000);
      expect(axelarBridgeService.getBridgeStatus).toHaveBeenCalledTimes(1);
      expect(useBridgeStore.getState().isPolling).toBe(false);
    });
  });

  describe('completeBridge', () => {
    it('should mark bridge as complete', () => {
      const { completeBridge } = useBridgeStore.getState();

      completeBridge();

      const state = useBridgeStore.getState();
      expect(state.status).toBe('complete');
      expect(state.isPolling).toBe(false);
    });
  });

  describe('failBridge', () => {
    it('should mark bridge as failed with error', () => {
      const { failBridge } = useBridgeStore.getState();

      failBridge('Transaction timeout');

      const state = useBridgeStore.getState();
      expect(state.status).toBe('failed');
      expect(state.error).toBe('Transaction timeout');
      expect(state.isPolling).toBe(false);
    });
  });

  describe('reset', () => {
    it('should reset to initial state', async () => {
      // First set some state
      vi.mocked(axelarBridgeService.bridgeToEVM).mockResolvedValueOnce({
        success: true,
        txHash: '0xABC123',
      });

      const { startBridgeToEVM, reset } = useBridgeStore.getState();
      await startBridgeToEVM('100', 'rTest123', '0x1234567890123456789012345678901234567890');

      // Verify state was set
      expect(useBridgeStore.getState().isActive).toBe(true);

      // Reset
      reset();

      // Verify initial state
      const state = useBridgeStore.getState();
      expect(state.isActive).toBe(false);
      expect(state.direction).toBeNull();
      expect(state.txHash).toBeNull();
      expect(state.status).toBeNull();
      expect(state.confirmations).toBe(0);
      expect(state.error).toBeNull();
    });
  });

  describe('getBridgeProgress helper', () => {
    it('should return 0 when not active', () => {
      const state = useBridgeStore.getState();
      expect(getBridgeProgress(state)).toBe(0);
    });

    it('should return 100 when complete', () => {
      useBridgeStore.setState({
        isActive: true,
        status: 'complete',
        confirmations: 6,
        requiredConfirmations: 6,
      });

      const state = useBridgeStore.getState();
      expect(getBridgeProgress(state)).toBe(100);
    });

    it('should calculate progress based on confirmations', () => {
      useBridgeStore.setState({
        isActive: true,
        status: 'confirming',
        confirmations: 3,
        requiredConfirmations: 6,
      });

      const state = useBridgeStore.getState();
      expect(getBridgeProgress(state)).toBe(50);
    });

    it('should handle zero required confirmations', () => {
      useBridgeStore.setState({
        isActive: true,
        status: 'pending',
        confirmations: 0,
        requiredConfirmations: 0,
      });

      const state = useBridgeStore.getState();
      expect(getBridgeProgress(state)).toBe(0);
    });
  });

  describe('isBridgeTerminal helper', () => {
    it('should return false for non-terminal states', () => {
      useBridgeStore.setState({ status: 'pending' });
      expect(isBridgeTerminal(useBridgeStore.getState())).toBe(false);

      useBridgeStore.setState({ status: 'confirming' });
      expect(isBridgeTerminal(useBridgeStore.getState())).toBe(false);

      useBridgeStore.setState({ status: null });
      expect(isBridgeTerminal(useBridgeStore.getState())).toBe(false);
    });

    it('should return true for terminal states', () => {
      useBridgeStore.setState({ status: 'complete' });
      expect(isBridgeTerminal(useBridgeStore.getState())).toBe(true);

      useBridgeStore.setState({ status: 'failed' });
      expect(isBridgeTerminal(useBridgeStore.getState())).toBe(true);
    });
  });
});
