/**
 * EVM Service Index
 *
 * Barrel exports for EVM services.
 * Provides wXRP balance checking, transaction helpers, and wallet signing
 * for XRPL EVM Sidechain.
 */

import { formatUnits, parseUnits, isAddress, type TransactionRequest } from 'ethers';
import { evmProviderService, EVMProviderService, type ProviderStatus } from './provider';
import {
  evmSignerService,
  EVMSignerServiceImpl,
  SIGNER_ERROR_CODES,
  SIGNER_STORAGE_KEYS,
  type EVMSignerService,
  type SignerError,
} from './signer';
import { XRPL_EVM_SIDECHAIN, type ChainConfig } from '@constants/chains';

// =============================================================================
// Re-exports from provider
// =============================================================================

export { evmProviderService, EVMProviderService };
export type { ProviderStatus };

// =============================================================================
// Re-exports from signer
// =============================================================================

export {
  evmSignerService,
  EVMSignerServiceImpl,
  SIGNER_ERROR_CODES,
  SIGNER_STORAGE_KEYS,
};
export type { EVMSignerService, SignerError };

// =============================================================================
// Types
// =============================================================================

export interface EVMBalance {
  raw: bigint;
  formatted: string;
  symbol: string;
}

export interface TransactionResult {
  success: boolean;
  hash: string | null;
  error?: string;
}

export interface EVMServiceError {
  code: string;
  message: string;
  originalError?: unknown;
}

// =============================================================================
// Error Codes
// =============================================================================

export const EVM_ERROR_CODES = {
  INVALID_ADDRESS: 'INVALID_ADDRESS',
  PROVIDER_ERROR: 'PROVIDER_ERROR',
  INSUFFICIENT_BALANCE: 'INSUFFICIENT_BALANCE',
  TRANSACTION_FAILED: 'TRANSACTION_FAILED',
  CONNECTION_ERROR: 'CONNECTION_ERROR',
} as const;

// =============================================================================
// EVMService Class
// =============================================================================

class EVMService {
  private providerService: EVMProviderService;

  constructor(providerService?: EVMProviderService) {
    this.providerService = providerService ?? evmProviderService;
  }

  /**
   * Check if an address is a valid EVM address
   */
  isValidAddress(address: string): boolean {
    return isAddress(address);
  }

  /**
   * Get wXRP balance for an address
   *
   * @param address - EVM address to check
   * @returns Balance in wXRP with raw bigint and formatted string
   */
  async getBalance(address: string): Promise<EVMBalance> {
    if (!this.isValidAddress(address)) {
      throw this.createError(
        EVM_ERROR_CODES.INVALID_ADDRESS,
        `Invalid EVM address: ${address}`
      );
    }

    try {
      const provider = this.providerService.getProvider();
      const balance = await provider.getBalance(address);

      return {
        raw: balance,
        formatted: formatUnits(balance, XRPL_EVM_SIDECHAIN.nativeCurrency.decimals),
        symbol: XRPL_EVM_SIDECHAIN.nativeCurrency.symbol,
      };
    } catch (error) {
      throw this.createError(
        EVM_ERROR_CODES.PROVIDER_ERROR,
        'Failed to fetch balance',
        error
      );
    }
  }

  /**
   * Get formatted wXRP balance as a string (e.g., "123.45")
   *
   * @param address - EVM address to check
   * @param decimals - Number of decimal places (default: 6)
   */
  async getFormattedBalance(address: string, decimals: number = 6): Promise<string> {
    const balance = await this.getBalance(address);
    const num = parseFloat(balance.formatted);
    return num.toFixed(decimals);
  }

  /**
   * Estimate gas for a transaction
   *
   * @param tx - Transaction request
   * @returns Estimated gas as bigint
   */
  async estimateGas(tx: TransactionRequest): Promise<bigint> {
    try {
      const provider = this.providerService.getProvider();
      return await provider.estimateGas(tx);
    } catch (error) {
      throw this.createError(
        EVM_ERROR_CODES.PROVIDER_ERROR,
        'Failed to estimate gas',
        error
      );
    }
  }

  /**
   * Get current gas price
   *
   * @returns Gas price as bigint (in wei)
   */
  async getGasPrice(): Promise<bigint> {
    try {
      const provider = this.providerService.getProvider();
      const feeData = await provider.getFeeData();
      return feeData.gasPrice ?? BigInt(0);
    } catch (error) {
      throw this.createError(
        EVM_ERROR_CODES.PROVIDER_ERROR,
        'Failed to get gas price',
        error
      );
    }
  }

  /**
   * Wait for a transaction to be confirmed
   *
   * @param txHash - Transaction hash to wait for
   * @param confirmations - Number of confirmations to wait for (default: 1)
   * @returns Transaction receipt or null if not found
   */
  async waitForTransaction(txHash: string, confirmations: number = 1) {
    try {
      const provider = this.providerService.getProvider();
      return await provider.waitForTransaction(txHash, confirmations);
    } catch (error) {
      throw this.createError(
        EVM_ERROR_CODES.TRANSACTION_FAILED,
        'Failed to wait for transaction',
        error
      );
    }
  }

  /**
   * Get transaction receipt
   *
   * @param txHash - Transaction hash
   */
  async getTransactionReceipt(txHash: string) {
    try {
      const provider = this.providerService.getProvider();
      return await provider.getTransactionReceipt(txHash);
    } catch (error) {
      throw this.createError(
        EVM_ERROR_CODES.PROVIDER_ERROR,
        'Failed to get transaction receipt',
        error
      );
    }
  }

  /**
   * Check provider connection status
   */
  async checkConnection(): Promise<ProviderStatus> {
    return this.providerService.checkConnection();
  }

  /**
   * Health check for the EVM service
   */
  async healthCheck(): Promise<boolean> {
    return this.providerService.healthCheck();
  }

  /**
   * Get chain configuration
   */
  getChainConfig(): ChainConfig {
    return this.providerService.getChainConfig();
  }

  /**
   * Parse wXRP amount to wei
   *
   * @param amount - Amount in wXRP (e.g., "100.5")
   * @returns Amount in wei as bigint
   */
  parseWXRP(amount: string): bigint {
    return parseUnits(amount, XRPL_EVM_SIDECHAIN.nativeCurrency.decimals);
  }

  /**
   * Format wei to wXRP
   *
   * @param wei - Amount in wei
   * @returns Amount in wXRP as string
   */
  formatWXRP(wei: bigint): string {
    return formatUnits(wei, XRPL_EVM_SIDECHAIN.nativeCurrency.decimals);
  }

  /**
   * Cleanup provider resources
   */
  destroy(): void {
    this.providerService.destroy();
  }

  // ===========================================================================
  // Private Methods
  // ===========================================================================

  private createError(
    code: string,
    message: string,
    originalError?: unknown
  ): EVMServiceError {
    const error: EVMServiceError = { code, message };
    if (originalError) {
      error.originalError = originalError;
    }
    console.error(`[EVMService] ${code}: ${message}`, originalError);
    return error;
  }
}

// =============================================================================
// Export
// =============================================================================

// Export singleton instance
export const evmService = new EVMService();

// Export class for testing
export { EVMService };

// Export utility functions
export const evmUtils = {
  isValidAddress: isAddress,
  parseWXRP: (amount: string) => parseUnits(amount, XRPL_EVM_SIDECHAIN.nativeCurrency.decimals),
  formatWXRP: (wei: bigint) => formatUnits(wei, XRPL_EVM_SIDECHAIN.nativeCurrency.decimals),
};
