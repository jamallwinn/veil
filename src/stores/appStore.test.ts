import { describe, it, expect, beforeEach } from 'vitest';
import { useAppStore } from './appStore';

// Reset store between tests
beforeEach(() => {
  const store = useAppStore.getState();
  store.reset();
});

describe('appStore', () => {
  describe('initial state', () => {
    it('should have correct initial state', () => {
      const state = useAppStore.getState();

      expect(state.isDemo).toBe(false);
      expect(state.currentView).toBe('landing');
    });
  });

  describe('startDemo', () => {
    it('should enable demo mode and set view to payment', () => {
      const { startDemo } = useAppStore.getState();

      startDemo();

      const state = useAppStore.getState();
      expect(state.isDemo).toBe(true);
      expect(state.currentView).toBe('payment');
    });
  });

  describe('exitDemo', () => {
    it('should disable demo mode and return to landing', () => {
      const { startDemo, exitDemo } = useAppStore.getState();

      // Start demo first
      startDemo();
      expect(useAppStore.getState().isDemo).toBe(true);

      // Exit demo
      exitDemo();

      const state = useAppStore.getState();
      expect(state.isDemo).toBe(false);
      expect(state.currentView).toBe('landing');
    });
  });

  describe('setView', () => {
    it('should update current view', () => {
      const { setView } = useAppStore.getState();

      setView('progress');
      expect(useAppStore.getState().currentView).toBe('progress');

      setView('completion');
      expect(useAppStore.getState().currentView).toBe('completion');
    });
  });

  describe('reset', () => {
    it('should reset to initial state', () => {
      const { startDemo, setView, reset } = useAppStore.getState();

      // Change state
      startDemo();
      setView('completion');

      // Reset
      reset();

      const state = useAppStore.getState();
      expect(state.isDemo).toBe(false);
      expect(state.currentView).toBe('landing');
    });
  });
});
