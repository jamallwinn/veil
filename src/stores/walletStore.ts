import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { gemWalletService } from '@services/gemwallet';

interface WalletState {
  isConnected: boolean;
  isConnecting: boolean;
  address: string | null;
  balance: string | null;
  network: 'mainnet' | 'testnet' | null;
  error: string | null;
}

interface WalletActions {
  connect: () => Promise<void>;
  disconnect: () => void;
  refreshBalance: () => Promise<void>;
  setError: (error: string | null) => void;
  checkConnection: () => Promise<void>;
  // For demo mode
  simulateConnection: (address: string, balance: string) => void;
}

type WalletStore = WalletState & WalletActions;

const initialState: WalletState = {
  isConnected: false,
  isConnecting: false,
  address: null,
  balance: null,
  network: null,
  error: null,
};

export const useWalletStore = create<WalletStore>()(
  persist(
    (set, get) => ({
      ...initialState,

      connect: async () => {
        console.log('[WalletStore] Starting connection...');
        set({ isConnecting: true, error: null });

        try {
          // Check if GemWallet is installed
          console.log('[WalletStore] Checking if GemWallet installed...');
          const isInstalled = await gemWalletService.isInstalled();
          if (!isInstalled) {
            throw new Error('GemWallet is not installed. Please install the extension.');
          }
          console.log('[WalletStore] GemWallet is installed');

          // Get network and validate (non-blocking - warn but continue)
          console.log('[WalletStore] Getting network...');
          const network = await gemWalletService.getNetwork();
          console.log('[WalletStore] Network:', network);
          if (network && network !== 'mainnet') {
            throw new Error(`Please switch to XRPL Mainnet in GemWallet. Current: ${network}`);
          }
          if (!network) {
            console.warn('[WalletStore] Could not determine network, proceeding anyway...');
          }

          // Connect and get address
          console.log('[WalletStore] Getting address...');
          const address = await gemWalletService.connect();
          if (!address) {
            throw new Error('Failed to connect to GemWallet. Please approve the connection request.');
          }
          console.log('[WalletStore] Got address:', address);

          // Get balance
          console.log('[WalletStore] Getting balance...');
          const balance = await gemWalletService.getBalance(address);
          console.log('[WalletStore] Balance:', balance);

          set({
            isConnected: true,
            isConnecting: false,
            address,
            balance,
            network: network || 'mainnet', // Default to mainnet if unknown
            error: null,
          });
          console.log('[WalletStore] Connection successful!');
        } catch (error) {
          console.error('[WalletStore] Connection failed:', error);
          set({
            isConnecting: false,
            error: error instanceof Error ? error.message : 'Connection failed',
          });
        }
      },

      disconnect: () => {
        set(initialState);
      },

      refreshBalance: async () => {
        const { address } = get();
        if (!address) return;

        try {
          const balance = await gemWalletService.getBalance(address);
          set({ balance });
        } catch (error) {
          console.error('Failed to refresh balance:', error);
        }
      },

      setError: (error) => set({ error }),

      checkConnection: async () => {
        // Check if we have a persisted connection that's still valid
        const { address, isConnected } = get();
        if (!isConnected || !address) return;

        try {
          const isInstalled = await gemWalletService.isInstalled();
          if (!isInstalled) {
            set(initialState);
            return;
          }

          // Verify we're still connected
          const currentAddress = await gemWalletService.getAddress();
          if (currentAddress !== address) {
            set(initialState);
            return;
          }

          // Refresh balance
          const balance = await gemWalletService.getBalance(address);
          set({ balance });
        } catch {
          // Connection no longer valid
          set(initialState);
        }
      },

      // For demo mode - simulate wallet connection
      simulateConnection: (address: string, balance: string) => {
        set({
          isConnected: true,
          isConnecting: false,
          address,
          balance,
          network: 'mainnet',
          error: null,
        });
      },
    }),
    {
      name: 'veil-wallet-store',
      partialize: (state) => ({
        isConnected: state.isConnected,
        address: state.address,
        network: state.network,
      }),
    }
  )
);
