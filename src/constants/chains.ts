/**
 * Chain Constants
 *
 * Configuration for supported blockchain networks.
 * Currently supports XRPL EVM Sidechain.
 *
 * XRPL EVM Chain IDs:
 * - Mainnet: 1440000 (xrplevm_1440000-1)
 * - Testnet: 1449000 (xrplevm_1449000-1)
 * - Devnet: 1440002 (exrp_1440002-1)
 *
 * See: https://docs.xrplevm.org/pages/operators/resources/networks
 */

// =============================================================================
// Types
// =============================================================================

export interface ChainConfig {
  chainId: number;
  name: string;
  shortName: string;
  nativeCurrency: {
    name: string;
    symbol: string;
    decimals: number;
  };
  rpcUrls: {
    default: string;
    fallback?: string[];
  };
  blockExplorer?: {
    name: string;
    url: string;
  };
  isTestnet: boolean;
}

// =============================================================================
// XRPL EVM Sidechain Configuration
// =============================================================================

/**
 * XRPL EVM Sidechain Mainnet
 * Chain ID: 1440000 (xrplevm_1440000-1)
 * Launched: June 30, 2025
 * See: https://docs.xrplevm.org
 */
export const XRPL_EVM_MAINNET: ChainConfig = {
  chainId: 1440000,
  name: 'XRPL EVM Mainnet',
  shortName: 'xrpl-evm',
  nativeCurrency: {
    name: 'XRP',
    symbol: 'XRP',
    decimals: 18,
  },
  rpcUrls: {
    // Public RPC endpoint for XRPL EVM Mainnet
    // Can be overridden via VITE_XRPL_EVM_RPC_URL environment variable
    default: 'https://rpc.xrplevm.org',
    fallback: [
      'https://rpc-evm-sidechain.xrpl.org',
    ],
  },
  blockExplorer: {
    name: 'XRPL EVM Explorer',
    url: 'https://explorer.xrplevm.org',
  },
  isTestnet: false,
};

/**
 * XRPL EVM Sidechain (Legacy/Devnet alias)
 * Using Devnet for development (Chain ID: 1440002)
 * Note: For production, use XRPL_EVM_MAINNET (Chain ID: 1440000)
 * See: https://docs.xrplevm.org
 */
export const XRPL_EVM_SIDECHAIN: ChainConfig = {
  chainId: 1440002,
  name: 'XRPL EVM Sidechain (Devnet)',
  shortName: 'xrpl-evm-devnet',
  nativeCurrency: {
    name: 'XRP',
    symbol: 'XRP',
    decimals: 18,
  },
  rpcUrls: {
    // Devnet RPC endpoint - use testnet RPC as devnet endpoint is deprecated
    // Can be overridden via VITE_XRPL_EVM_RPC_URL environment variable
    default: 'https://rpc.testnet.xrplevm.org',
    fallback: ['https://rpc.xrplevm.org'],
  },
  blockExplorer: {
    name: 'XRPL EVM Devnet Explorer',
    url: 'https://explorer.testnet.xrplevm.org',
  },
  isTestnet: true, // Devnet is a test environment
};

/**
 * XRPL EVM Sidechain Testnet
 * Chain ID: 1449000 (xrplevm_1449000-1)
 * See: https://docs.xrplevm.org/pages/operators/resources/networks
 */
export const XRPL_EVM_TESTNET: ChainConfig = {
  chainId: 1449000,
  name: 'XRPL EVM Testnet',
  shortName: 'xrpl-evm-testnet',
  nativeCurrency: {
    name: 'XRP',
    symbol: 'XRP',
    decimals: 18,
  },
  rpcUrls: {
    default: 'https://rpc.testnet.xrplevm.org',
    fallback: [],
  },
  blockExplorer: {
    name: 'XRPL EVM Testnet Explorer',
    url: 'https://explorer.testnet.xrplevm.org',
  },
  isTestnet: true,
};

/**
 * XRPL EVM Sidechain Devnet (deprecated alias for testnet)
 * See: https://docs.xrplevm.org
 */
export const XRPL_EVM_DEVNET: ChainConfig = {
  chainId: 1449000, // Use testnet chain ID
  name: 'XRPL EVM Testnet',
  shortName: 'xrpl-evm-testnet',
  nativeCurrency: {
    name: 'XRP',
    symbol: 'XRP',
    decimals: 18,
  },
  rpcUrls: {
    default: 'https://rpc.testnet.xrplevm.org',
  },
  blockExplorer: {
    name: 'XRPL EVM Testnet Explorer',
    url: 'https://explorer.testnet.xrplevm.org',
  },
  isTestnet: true,
};

// =============================================================================
// Chain ID Constants
// =============================================================================

export const CHAIN_IDS = {
  /** XRPL EVM Mainnet - Production network (launched June 30, 2025) */
  XRPL_EVM_MAINNET: 1440000,
  /** XRPL EVM Sidechain - Legacy alias for devnet, used in current codebase */
  XRPL_EVM_SIDECHAIN: 1440002,
  /** XRPL EVM Devnet - Development network */
  XRPL_EVM_DEVNET: 1440002,
  /** XRPL EVM Testnet */
  XRPL_EVM_TESTNET: 1449000,
} as const;

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Get chain configuration by chain ID
 */
export function getChainConfig(chainId: number): ChainConfig | undefined {
  switch (chainId) {
    case CHAIN_IDS.XRPL_EVM_MAINNET:
      return XRPL_EVM_MAINNET;
    case CHAIN_IDS.XRPL_EVM_SIDECHAIN:
    case CHAIN_IDS.XRPL_EVM_DEVNET:
      return XRPL_EVM_SIDECHAIN;
    case CHAIN_IDS.XRPL_EVM_TESTNET:
      return XRPL_EVM_TESTNET;
    default:
      return undefined;
  }
}

/**
 * Check if a chain ID is supported
 */
export function isSupportedChain(chainId: number): boolean {
  return Object.values(CHAIN_IDS).includes(chainId as typeof CHAIN_IDS[keyof typeof CHAIN_IDS]);
}

/**
 * Get RPC URL for a chain, with environment variable override
 */
export function getRpcUrl(chainId: number): string | undefined {
  // Check for environment variable override
  const envRpcUrl = import.meta.env.VITE_XRPL_EVM_RPC_URL;
  if (envRpcUrl && (chainId === CHAIN_IDS.XRPL_EVM_MAINNET || chainId === CHAIN_IDS.XRPL_EVM_SIDECHAIN)) {
    return envRpcUrl;
  }

  const config = getChainConfig(chainId);
  return config?.rpcUrls.default;
}
