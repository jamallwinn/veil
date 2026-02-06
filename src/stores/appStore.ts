import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface AppState {
  isDemo: boolean;
  currentView: 'landing' | 'payment' | 'progress' | 'completion';
}

interface AppActions {
  startDemo: () => void;
  exitDemo: () => void;
  setView: (view: AppState['currentView']) => void;
  reset: () => void;
}

type AppStore = AppState & AppActions;

const initialState: AppState = {
  isDemo: false,
  currentView: 'landing',
};

export const useAppStore = create<AppStore>()(
  persist(
    (set) => ({
      ...initialState,

      startDemo: () => set({ isDemo: true, currentView: 'payment' }),

      exitDemo: () => set({ isDemo: false, currentView: 'landing' }),

      setView: (view) => set({ currentView: view }),

      reset: () => set(initialState),
    }),
    {
      name: 'veil-app-store',
      partialize: (state) => ({
        // Don't persist demo mode across sessions
        currentView: state.currentView,
      }),
    }
  )
);
