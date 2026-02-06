/**
 * EVM Signer Service
 *
 * Provides EVM wallet signing capabilities with secure key storage via Tauri.
 * Private keys are stored in the OS native keychain and never exposed to the frontend.
 *
 * Security Model:
 * - Private key stored ONLY in Tauri keychain via secureStorageService
 * - Key is retrieved only during signing operations
 * - Address derivation happens locally for display purposes
 * - All signing operations use ethers.Wallet internally
 *
 * @see https://docs.ethers.org/v6/api/wallet/
 */

import { Wallet, type TransactionRequest, type TransactionResponse } from 'ethers';
import { secureStorageService } from '@services/secure-storage';
import { evmProviderService } from './provider';

// =============================================================================
// Types
// =============================================================================

export interface EVMSignerService {
  // Key management
  hasWallet(): Promise<boolean>;
  createWallet(): Promise<{ address: string }>;
  importWallet(privateKey: string): Promise<{ address: string }>;
  deleteWallet(): Promise<void>;

  // Signing (key never leaves secure storage context)
  getAddress(): Promise<string | null>;
  getSigner(): Promise<Wallet | null>;
  signTransaction(tx: TransactionRequest): Promise<string>;
  signMessage(message: string): Promise<string>;
  sendTransaction(tx: TransactionRequest): Promise<TransactionResponse>;
}

export interface SignerError {
  code: string;
  message: string;
  originalError?: unknown;
}

// =============================================================================
// Constants
// =============================================================================

/**
 * Storage key for the EVM private key in secure storage
 */
const EVM_PRIVATE_KEY_STORAGE_KEY = 'evm_private_key';

/**
 * Storage key for the cached EVM address (non-sensitive)
 */
const EVM_ADDRESS_STORAGE_KEY = 'evm_address';

/**
 * Error codes for signer operations
 */
export const SIGNER_ERROR_CODES = {
  NO_WALLET: 'NO_WALLET',
  WALLET_EXISTS: 'WALLET_EXISTS',
  INVALID_PRIVATE_KEY: 'INVALID_PRIVATE_KEY',
  SIGNING_FAILED: 'SIGNING_FAILED',
  STORAGE_ERROR: 'STORAGE_ERROR',
  TRANSACTION_FAILED: 'TRANSACTION_FAILED',
} as const;

// =============================================================================
// EVMSignerServiceImpl Class
// =============================================================================

class EVMSignerServiceImpl implements EVMSignerService {
  /**
   * Check if a wallet exists in secure storage
   */
  async hasWallet(): Promise<boolean> {
    try {
      return await secureStorageService.has(EVM_PRIVATE_KEY_STORAGE_KEY);
    } catch (error) {
      console.error('[EVMSignerService] hasWallet failed:', error);
      return false;
    }
  }

  /**
   * Create a new random EVM wallet
   *
   * Generates a new wallet with a random private key and stores it securely.
   * Returns only the public address - private key never leaves secure storage.
   *
   * @returns The public address of the new wallet
   * @throws SignerError if a wallet already exists or storage fails
   */
  async createWallet(): Promise<{ address: string }> {
    // Check if wallet already exists
    const exists = await this.hasWallet();
    if (exists) {
      throw this.createError(
        SIGNER_ERROR_CODES.WALLET_EXISTS,
        'Wallet already exists. Delete the existing wallet first.'
      );
    }

    try {
      // Generate a new random wallet
      const wallet = Wallet.createRandom();
      const privateKey = wallet.privateKey;
      const address = wallet.address;

      // Store private key in secure storage
      await secureStorageService.store(EVM_PRIVATE_KEY_STORAGE_KEY, privateKey);

      // Cache the address (non-sensitive) for quick retrieval
      await secureStorageService.store(EVM_ADDRESS_STORAGE_KEY, address);

      // Log only the address, never the private key
      console.log('[EVMSignerService] Wallet created:', address);

      return { address };
    } catch (error) {
      // Clean up on failure
      await this.cleanupOnError();

      if (this.isSignerError(error)) {
        throw error;
      }

      throw this.createError(
        SIGNER_ERROR_CODES.STORAGE_ERROR,
        'Failed to create wallet',
        error
      );
    }
  }

  /**
   * Import an existing EVM wallet from a private key
   *
   * Validates the private key, stores it securely, and returns the derived address.
   * The private key is stored in OS keychain and never exposed after import.
   *
   * @param privateKey - The private key to import (with or without 0x prefix)
   * @returns The public address derived from the private key
   * @throws SignerError if the private key is invalid or a wallet already exists
   */
  async importWallet(privateKey: string): Promise<{ address: string }> {
    // Check if wallet already exists
    const exists = await this.hasWallet();
    if (exists) {
      throw this.createError(
        SIGNER_ERROR_CODES.WALLET_EXISTS,
        'Wallet already exists. Delete the existing wallet first.'
      );
    }

    // Validate and normalize the private key
    let normalizedKey = privateKey.trim();
    if (!normalizedKey.startsWith('0x')) {
      normalizedKey = '0x' + normalizedKey;
    }

    // Validate private key format
    if (!/^0x[a-fA-F0-9]{64}$/.test(normalizedKey)) {
      throw this.createError(
        SIGNER_ERROR_CODES.INVALID_PRIVATE_KEY,
        'Invalid private key format. Must be 64 hex characters.'
      );
    }

    try {
      // Create wallet to validate and derive address
      const wallet = new Wallet(normalizedKey);
      const address = wallet.address;

      // Store private key in secure storage
      await secureStorageService.store(EVM_PRIVATE_KEY_STORAGE_KEY, normalizedKey);

      // Cache the address (non-sensitive) for quick retrieval
      await secureStorageService.store(EVM_ADDRESS_STORAGE_KEY, address);

      // Log only the address, never the private key
      console.log('[EVMSignerService] Wallet imported:', address);

      return { address };
    } catch (error) {
      // Clean up on failure
      await this.cleanupOnError();

      if (this.isSignerError(error)) {
        throw error;
      }

      // Check if this is an ethers error for invalid private key
      if (error instanceof Error && error.message.includes('invalid')) {
        throw this.createError(
          SIGNER_ERROR_CODES.INVALID_PRIVATE_KEY,
          'Invalid private key',
          error
        );
      }

      throw this.createError(
        SIGNER_ERROR_CODES.STORAGE_ERROR,
        'Failed to import wallet',
        error
      );
    }
  }

  /**
   * Delete the wallet from secure storage
   *
   * Removes both the private key and cached address from the OS keychain.
   * This operation cannot be undone - ensure user has backed up their key.
   */
  async deleteWallet(): Promise<void> {
    try {
      // Delete private key
      await secureStorageService.delete(EVM_PRIVATE_KEY_STORAGE_KEY);

      // Delete cached address
      await secureStorageService.delete(EVM_ADDRESS_STORAGE_KEY);

      console.log('[EVMSignerService] Wallet deleted');
    } catch (error) {
      throw this.createError(
        SIGNER_ERROR_CODES.STORAGE_ERROR,
        'Failed to delete wallet',
        error
      );
    }
  }

  /**
   * Get the wallet address
   *
   * Returns the cached address if available, otherwise derives it from the stored key.
   *
   * @returns The wallet address, or null if no wallet exists
   */
  async getAddress(): Promise<string | null> {
    // First, try to get cached address
    try {
      const cachedAddress = await secureStorageService.get(EVM_ADDRESS_STORAGE_KEY);
      if (cachedAddress) {
        return cachedAddress;
      }
    } catch {
      // Cache miss or error - continue to derive from key
    }

    // If no cached address, derive from private key
    const wallet = await this.getWalletInstance();
    if (!wallet) {
      return null;
    }

    // Cache the address for future use
    try {
      await secureStorageService.store(EVM_ADDRESS_STORAGE_KEY, wallet.address);
    } catch {
      // Non-critical - address caching failed but we can still return it
    }

    return wallet.address;
  }

  /**
   * Get a connected Wallet (Signer) for contract interactions
   *
   * Returns a wallet instance connected to the EVM provider.
   * Used for signing contract transactions (e.g., PrivacyPool deposits).
   *
   * @returns A connected Wallet, or null if no wallet exists
   */
  async getSigner(): Promise<Wallet | null> {
    const wallet = await this.getWalletInstance();
    if (!wallet) {
      return null;
    }
    // Connect wallet to provider for contract interactions
    return wallet.connect(evmProviderService.getProvider());
  }

  /**
   * Sign a transaction
   *
   * Retrieves the private key from secure storage, signs the transaction,
   * and returns the signed transaction hex. The key is held in memory only
   * for the duration of the signing operation.
   *
   * @param tx - The transaction request to sign
   * @returns The signed transaction as a hex string
   * @throws SignerError if no wallet exists or signing fails
   */
  async signTransaction(tx: TransactionRequest): Promise<string> {
    const wallet = await this.getWalletInstance();
    if (!wallet) {
      throw this.createError(
        SIGNER_ERROR_CODES.NO_WALLET,
        'No wallet found. Create or import a wallet first.'
      );
    }

    try {
      // Connect wallet to provider for chain info
      const provider = evmProviderService.getProvider();
      const connectedWallet = wallet.connect(provider);

      // Sign the transaction
      const signedTx = await connectedWallet.signTransaction(tx);
      return signedTx;
    } catch (error) {
      throw this.createError(
        SIGNER_ERROR_CODES.SIGNING_FAILED,
        'Failed to sign transaction',
        error
      );
    }
  }

  /**
   * Sign a message
   *
   * Signs an arbitrary message using EIP-191 personal sign standard.
   *
   * @param message - The message to sign
   * @returns The signature as a hex string
   * @throws SignerError if no wallet exists or signing fails
   */
  async signMessage(message: string): Promise<string> {
    const wallet = await this.getWalletInstance();
    if (!wallet) {
      throw this.createError(
        SIGNER_ERROR_CODES.NO_WALLET,
        'No wallet found. Create or import a wallet first.'
      );
    }

    try {
      const signature = await wallet.signMessage(message);
      return signature;
    } catch (error) {
      throw this.createError(
        SIGNER_ERROR_CODES.SIGNING_FAILED,
        'Failed to sign message',
        error
      );
    }
  }

  /**
   * Sign and send a transaction
   *
   * Combines signing and broadcasting into a single operation.
   * Uses the provider to estimate gas and send the transaction.
   *
   * @param tx - The transaction request to send
   * @returns The transaction response
   * @throws SignerError if no wallet exists, signing fails, or broadcast fails
   */
  async sendTransaction(tx: TransactionRequest): Promise<TransactionResponse> {
    const wallet = await this.getWalletInstance();
    if (!wallet) {
      throw this.createError(
        SIGNER_ERROR_CODES.NO_WALLET,
        'No wallet found. Create or import a wallet first.'
      );
    }

    try {
      // Connect wallet to provider
      const provider = evmProviderService.getProvider();
      const connectedWallet = wallet.connect(provider);

      // Send the transaction (signs and broadcasts)
      const txResponse = await connectedWallet.sendTransaction(tx);
      return txResponse;
    } catch (error) {
      throw this.createError(
        SIGNER_ERROR_CODES.TRANSACTION_FAILED,
        'Failed to send transaction',
        error
      );
    }
  }

  // ===========================================================================
  // Private Methods
  // ===========================================================================

  /**
   * Get a wallet instance from secure storage
   *
   * IMPORTANT: This method retrieves the private key from secure storage.
   * The wallet instance should be used immediately and not stored long-term.
   *
   * @returns A Wallet instance, or null if no wallet exists
   */
  private async getWalletInstance(): Promise<Wallet | null> {
    try {
      const privateKey = await secureStorageService.get(EVM_PRIVATE_KEY_STORAGE_KEY);
      if (!privateKey) {
        return null;
      }
      return new Wallet(privateKey);
    } catch (error) {
      console.error('[EVMSignerService] Failed to get wallet instance:', error);
      return null;
    }
  }

  /**
   * Cleanup storage on error during wallet creation/import
   */
  private async cleanupOnError(): Promise<void> {
    try {
      await secureStorageService.delete(EVM_PRIVATE_KEY_STORAGE_KEY);
      await secureStorageService.delete(EVM_ADDRESS_STORAGE_KEY);
    } catch {
      // Ignore cleanup errors
    }
  }

  /**
   * Create a standardized error object
   */
  private createError(
    code: string,
    message: string,
    originalError?: unknown
  ): SignerError {
    const error: SignerError = { code, message };
    if (originalError) {
      error.originalError = originalError;
    }
    console.error(`[EVMSignerService] ${code}: ${message}`, originalError);
    return error;
  }

  /**
   * Type guard for SignerError
   */
  private isSignerError(error: unknown): error is SignerError {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      'message' in error
    );
  }
}

// =============================================================================
// Export
// =============================================================================

// Export singleton instance
export const evmSignerService = new EVMSignerServiceImpl();

// Export class for testing
export { EVMSignerServiceImpl };

// Export storage key constants for testing
export const SIGNER_STORAGE_KEYS = {
  PRIVATE_KEY: EVM_PRIVATE_KEY_STORAGE_KEY,
  ADDRESS: EVM_ADDRESS_STORAGE_KEY,
};
