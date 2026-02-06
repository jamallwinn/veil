/**
 * EVM Provider Service
 *
 * Configures and manages the ethers.js JsonRpcProvider for XRPL EVM Mainnet.
 * Provides singleton pattern matching other services.
 *
 * Features:
 * - Connection to XRPL EVM Mainnet RPC
 * - Chain ID validation
 * - Connection health checking
 * - Automatic reconnection on failure
 */

import { JsonRpcProvider, Network } from 'ethers';
import {
  XRPL_EVM_MAINNET,
  CHAIN_IDS,
  getRpcUrl,
  type ChainConfig,
} from '@constants/chains';

// =============================================================================
// Types
// =============================================================================

export interface ProviderStatus {
  connected: boolean;
  chainId: number | null;
  blockNumber: number | null;
  rpcUrl: string;
  error?: string;
}

export interface ProviderConfig {
  chainId: number;
  rpcUrl?: string;
  timeout?: number;
}

// =============================================================================
// Constants
// =============================================================================

// Note: DEFAULT_TIMEOUT available for future retry logic implementation
// const DEFAULT_TIMEOUT = 10000; // 10 seconds
const HEALTH_CHECK_TIMEOUT = 5000; // 5 seconds

// =============================================================================
// EVMProviderService Class
// =============================================================================

class EVMProviderService {
  private provider: JsonRpcProvider | null = null;
  private config: ChainConfig;
  private rpcUrl: string;

  constructor(config?: ProviderConfig) {
    // Default to XRPL EVM Mainnet (Chain ID: 1440000)
    const chainId = config?.chainId ?? CHAIN_IDS.XRPL_EVM_MAINNET;

    if (chainId !== CHAIN_IDS.XRPL_EVM_MAINNET && chainId !== CHAIN_IDS.XRPL_EVM_SIDECHAIN && chainId !== CHAIN_IDS.XRPL_EVM_DEVNET) {
      throw new Error(`Unsupported chain ID: ${chainId}. Only XRPL EVM Mainnet/Sidechain is supported.`);
    }

    // Use mainnet config by default
    this.config = chainId === CHAIN_IDS.XRPL_EVM_MAINNET
      ? XRPL_EVM_MAINNET
      : XRPL_EVM_MAINNET; // Fall back to mainnet for all other chains

    this.rpcUrl = config?.rpcUrl ?? getRpcUrl(chainId) ?? XRPL_EVM_MAINNET.rpcUrls.default;
    // Note: timeout from config is available for future retry logic implementation
    // Currently unused but kept in interface for API stability
    void config?.timeout;
  }

  /**
   * Get the ethers.js provider instance
   * Creates the provider if it doesn't exist
   */
  getProvider(): JsonRpcProvider {
    if (!this.provider) {
      this.provider = this.createProvider();
    }
    return this.provider;
  }

  /**
   * Create a new provider instance
   */
  private createProvider(): JsonRpcProvider {
    // Create a static network to avoid auto-detection
    // This is more efficient and avoids unnecessary eth_chainId calls
    const network = Network.from({
      name: this.config.shortName,
      chainId: this.config.chainId,
    });

    const provider = new JsonRpcProvider(
      this.rpcUrl,
      network,
      {
        staticNetwork: network,
        // polling disabled by default, can be enabled if needed
      }
    );

    return provider;
  }

  /**
   * Check if the provider is connected and the chain ID matches
   */
  async checkConnection(): Promise<ProviderStatus> {
    const status: ProviderStatus = {
      connected: false,
      chainId: null,
      blockNumber: null,
      rpcUrl: this.rpcUrl,
    };

    try {
      const provider = this.getProvider();

      // Race against timeout
      const networkPromise = provider.getNetwork();
      const blockPromise = provider.getBlockNumber();

      const [network, blockNumber] = await Promise.race([
        Promise.all([networkPromise, blockPromise]),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Connection timeout')), HEALTH_CHECK_TIMEOUT)
        ),
      ]);

      const chainId = Number(network.chainId);
      status.chainId = chainId;
      status.blockNumber = blockNumber;

      // Validate chain ID
      if (chainId !== this.config.chainId) {
        status.error = `Chain ID mismatch: expected ${this.config.chainId}, got ${chainId}`;
        status.connected = false;
      } else {
        status.connected = true;
      }
    } catch (error) {
      status.error = error instanceof Error ? error.message : 'Unknown connection error';
      status.connected = false;
    }

    return status;
  }

  /**
   * Perform a health check on the provider connection
   */
  async healthCheck(): Promise<boolean> {
    const status = await this.checkConnection();
    return status.connected;
  }

  /**
   * Get the current block number
   */
  async getBlockNumber(): Promise<number> {
    const provider = this.getProvider();
    return provider.getBlockNumber();
  }

  /**
   * Get the chain configuration
   */
  getChainConfig(): ChainConfig {
    return this.config;
  }

  /**
   * Get the current RPC URL
   */
  getRpcUrl(): string {
    return this.rpcUrl;
  }

  /**
   * Destroy the provider instance
   * Useful for cleanup or reconnection
   */
  destroy(): void {
    if (this.provider) {
      this.provider.destroy();
      this.provider = null;
    }
  }

  /**
   * Reconnect to the RPC endpoint
   * Destroys existing provider and creates a new one
   */
  async reconnect(): Promise<ProviderStatus> {
    this.destroy();
    return this.checkConnection();
  }

  /**
   * Switch to a different RPC URL
   */
  async switchRpcUrl(newRpcUrl: string): Promise<ProviderStatus> {
    this.rpcUrl = newRpcUrl;
    this.destroy();
    return this.checkConnection();
  }
}

// =============================================================================
// Export
// =============================================================================

// Export singleton instance for default XRPL EVM Sidechain
export const evmProviderService = new EVMProviderService();

// Export class for testing and custom configurations
export { EVMProviderService };
