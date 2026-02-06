import { describe, it, expect, beforeEach } from 'vitest';
import { useWalletStore } from './walletStore';

// Reset store between tests
beforeEach(() => {
  const store = useWalletStore.getState();
  store.disconnect();
});

describe('walletStore', () => {
  describe('initial state', () => {
    it('should have correct initial state', () => {
      const state = useWalletStore.getState();

      expect(state.isConnected).toBe(false);
      expect(state.isConnecting).toBe(false);
      expect(state.address).toBeNull();
      expect(state.balance).toBeNull();
      expect(state.network).toBeNull();
      expect(state.error).toBeNull();
    });
  });

  describe('simulateConnection', () => {
    it('should set wallet state for demo mode', () => {
      const { simulateConnection } = useWalletStore.getState();

      simulateConnection('rDemoAddress123', '500.00');

      const state = useWalletStore.getState();
      expect(state.isConnected).toBe(true);
      expect(state.address).toBe('rDemoAddress123');
      expect(state.balance).toBe('500.00');
      expect(state.network).toBe('mainnet');
    });
  });

  describe('disconnect', () => {
    it('should reset state on disconnect', () => {
      const { simulateConnection, disconnect } = useWalletStore.getState();

      // First connect
      simulateConnection('rDemoAddress123', '500.00');
      expect(useWalletStore.getState().isConnected).toBe(true);

      // Then disconnect
      disconnect();

      const state = useWalletStore.getState();
      expect(state.isConnected).toBe(false);
      expect(state.address).toBeNull();
      expect(state.balance).toBeNull();
    });
  });

  describe('setError', () => {
    it('should set error message', () => {
      const { setError } = useWalletStore.getState();

      setError('Test error message');

      expect(useWalletStore.getState().error).toBe('Test error message');
    });

    it('should clear error when null is passed', () => {
      const { setError } = useWalletStore.getState();

      setError('Test error');
      setError(null);

      expect(useWalletStore.getState().error).toBeNull();
    });
  });
});
