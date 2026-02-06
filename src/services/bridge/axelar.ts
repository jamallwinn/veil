/**
 * Axelar Bridge Service
 *
 * Provides integration with Axelar bridge for cross-chain transfers between
 * XRPL Mainnet and XRPL EVM Sidechain.
 *
 * Implementation Status:
 * - Demo mode: Full mock implementation for development/testing
 * - Real mode: Full integration with Axelar SDK (@axelar-network/axelarjs-sdk)
 *
 * Architecture:
 * - XRPL -> EVM: User sends XRP to deposit address, receives wXRP on EVM
 * - EVM -> XRPL: User calls ITS contract, XRP released on XRPL
 *
 * @see https://docs.axelar.dev/dev/axelarjs-sdk/intro
 * @see https://docs.xrplevm.org/pages/bridge
 */

import { type EVMProviderService } from '@services/evm/provider';
import { type GemWalletService } from '@services/gemwallet';
import {
  evmSignerService,
  type EVMSignerService,
} from '@services/evm/signer';
import { CHAIN_IDS } from '@constants/chains';
import { parseUnits, Contract, type TransactionResponse } from 'ethers';

// Axelar SDK imports (AxelarQueryAPI for fee estimation, Environment for config)
import {
  AxelarQueryAPI,
  Environment,
} from '@axelar-network/axelarjs-sdk';
import {
  AxelarRecoveryApi,
  GMPStatus,
  type GMPStatusResponse,
} from '@axelar-network/axelarjs-sdk/dist/src/libs/TransactionRecoveryApi/AxelarRecoveryApi';

// =============================================================================
// Types & Interfaces
// =============================================================================

export type BridgeDirection = 'toEVM' | 'toXRPL';

export type BridgeStatusType = 'pending' | 'confirming' | 'complete' | 'failed';

/**
 * Axelar GMP Status types (from Axelar SDK)
 * @see https://docs.axelar.dev/dev/axelarjs-sdk/tx-status-query-recovery
 */
export type AxelarGMPStatus =
  | 'source_gateway_called'
  | 'destination_gateway_approved'
  | 'destination_executed'
  | 'express_executed'
  | 'error'
  | 'executing'
  | 'approving'
  | 'confirmed'
  | 'not_executed'
  | 'insufficient_fee'
  | 'unknown_error'
  | 'cannot_fetch_status';

export interface BridgeResult {
  success: boolean;
  txHash: string | null;
  depositAddress?: string; // For toEVM: address to send XRP to
  error?: string;
}

export interface BridgeStatus {
  status: BridgeStatusType;
  confirmations: number;
  requiredConfirmations: number;
  estimatedTimeRemaining?: number; // seconds
  axelarStatus?: AxelarGMPStatus; // Raw Axelar status for debugging
  axelarScanUrl?: string; // Link to Axelarscan for tracking
}

export interface BridgeEstimate {
  fee: string; // Fee in XRP
  estimatedTime: number; // seconds
  minimumAmount: string; // Minimum XRP amount
}

export interface BridgeTransaction {
  id: string;
  direction: BridgeDirection;
  amount: string;
  fromAddress: string;
  toAddress: string;
  status: BridgeStatusType;
  txHash: string;
  depositAddress?: string; // For toEVM bridging
  startedAt: number;
  completedAt?: number;
  confirmations: number;
  axelarStatus?: AxelarGMPStatus;
}

export interface BridgeServiceConfig {
  /** Optional EVM provider for real blockchain interactions */
  evmProvider?: EVMProviderService;
  /** Optional GemWallet service for XRPL signing */
  gemWalletService?: GemWalletService;
  /** Optional EVM signer service for EVM transaction signing */
  evmSignerService?: EVMSignerService;
  /** Enable demo/mock mode (default: true) */
  demoMode?: boolean;
  /** Axelar environment (default: 'mainnet') */
  axelarEnvironment?: 'mainnet' | 'testnet';
}

/**
 * Response from Axelar deposit address API
 */
export interface AxelarDepositAddressResponse {
  depositAddress: string;
  expiresAt?: number;
}

/**
 * Response from Axelar status query
 */
export interface AxelarStatusResponse {
  status: AxelarGMPStatus;
  gasPaidInfo?: {
    status: 'gas_unpaid' | 'gas_paid' | 'gas_paid_not_enough_gas' | 'gas_paid_enough_gas';
  };
  error?: {
    message: string;
  };
}

// =============================================================================
// Constants
// =============================================================================

/**
 * XRPL EVM Sidechain Chain ID
 * See: https://docs.xrplevm.org
 * @deprecated Use CHAIN_IDS.XRPL_EVM_SIDECHAIN from @constants/chains instead
 */
export const XRPL_EVM_CHAIN_ID = CHAIN_IDS.XRPL_EVM_SIDECHAIN;

/**
 * Axelar chain identifiers
 * @see https://docs.axelar.dev/validator/external-chains/xrpl-evm/
 */
export const AXELAR_CHAIN_IDS = {
  XRPL: 'xrpl', // XRPL Mainnet
  XRPL_EVM: 'xrpl-evm', // XRPL EVM Sidechain
  XRPL_EVM_TESTNET: 'xrpl-evm-testnet',
} as const;

/**
 * Axelar API endpoints
 */
const AXELAR_API = {
  MAINNET: 'https://api.axelarscan.io',
  TESTNET: 'https://testnet.api.axelarscan.io',
  AXELARSCAN_MAINNET: 'https://axelarscan.io',
  AXELARSCAN_TESTNET: 'https://testnet.axelarscan.io',
} as const;

/**
 * Bridge configuration
 */
const BRIDGE_CONFIG = {
  // Fee percentage (0.1%)
  FEE_PERCENTAGE: 0.001,

  // Minimum bridge amount in XRP
  MINIMUM_AMOUNT: '1',

  // Required confirmations
  REQUIRED_CONFIRMATIONS: {
    toEVM: 6, // XRPL confirmations before EVM mint
    toXRPL: 12, // EVM confirmations before XRPL release
  },

  // Estimated bridge times (seconds)
  ESTIMATED_TIME: {
    toEVM: 20, // ~20 seconds for XRPL -> EVM
    toXRPL: 25, // ~25 seconds for EVM -> XRPL
  },

  // Mock simulation settings
  MOCK: {
    CONFIRMATION_INTERVAL_MS: 2000, // Time between confirmations
    FAILURE_RATE: 0.02, // 2% chance of simulated failure
  },

  // Deposit address expiration (24 hours in ms)
  DEPOSIT_ADDRESS_EXPIRATION: 24 * 60 * 60 * 1000,

  // Status polling interval (ms)
  STATUS_POLL_INTERVAL: 3000,
};

/**
 * Axelar contract addresses
 *
 * Sources:
 * - Mainnet: https://github.com/axelarnetwork/axelar-contract-deployments
 * - Testnet: https://docs.axelar.dev/dev/reference/testnet-contract-addresses
 * - XRPL EVM Docs: https://docs.xrplevm.org/pages/bridge/interchain-transfer
 *
 * The XRPL EVM Sidechain uses Axelar's ITS (Interchain Token Service) contracts
 * for cross-chain token transfers. XRP is the native gas token on XRPL EVM.
 *
 * IMPORTANT: Some addresses are still TBD pending official Axelar mainnet deployment.
 * These will be updated when Axelar publishes official mainnet addresses.
 */
const AXELAR_ADDRESSES = {
  // MAINNET ADDRESSES (Chain ID: 1440000)
  // Source: https://axelarscan.io/resources/chains (xrpl-evm)
  MAINNET: {
    // XRPL bridge multisig account (Axelar Amplifier)
    // Users send XRP here to bridge to EVM
    // Source: Axelarscan - xrpl chain
    XRPL_BRIDGE: 'rfmS3zqrQrka8wVyhXifEeyTwe8AMz2Yhw',

    // Axelar Amplifier Gateway contract on XRPL EVM Sidechain
    // Source: Axelarscan - xrpl-evm chain
    EVM_GATEWAY: '0xe432150cce91c13a887f7D836923d5597adD8E31',

    // Axelar Gas Service contract on XRPL EVM Sidechain
    // Used for cross-chain gas payments
    GAS_SERVICE: '0x2d5d7d31F671F86C782533cc367F14109a082712',

    // Native XRP representation on XRPL EVM Sidechain
    // XRP is the native gas token, this is the standard ERC-20 interface address
    // See: https://docs.xrplevm.org
    NATIVE_XRP: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',

    // Interchain Token Service (ITS) on XRPL EVM Sidechain
    // Standard Axelar ITS address (same across all EVM chains)
    // See: https://docs.axelar.dev/dev/reference/mainnet-contract-addresses/
    ITS_CONTRACT: '0xB5FB4BE02232B1bBA4dC8f81dc24C26980dE9e3C',

    // ITS Token Factory - Standard address across all EVM chains
    ITS_FACTORY: '0x83a93500d23Fbc3e82B410aD07A6a9F7A0670D66',
  },

  // TESTNET ADDRESSES (Chain ID: 1440001)
  // Note: Using mainnet addresses as fallback - testnet may have different addresses
  TESTNET: {
    // XRPL bridge multisig account (Testnet)
    // See: https://docs.xrplevm.org/pages/bridge/general-message-passing
    XRPL_BRIDGE: 'rfEf91bLxrTVC76vw1W3Ur8Jk4Lwujskmb',

    // Axelar Amplifier Gateway contract on XRPL EVM Testnet
    // Using mainnet address as reference - verify on testnet explorer
    EVM_GATEWAY: '0xe432150cce91c13a887f7D836923d5597adD8E31',

    // Axelar Gas Service contract
    GAS_SERVICE: '0x2d5d7d31F671F86C782533cc367F14109a082712',

    // Native XRP representation (same as mainnet)
    NATIVE_XRP: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',

    // Interchain Token Service (ITS) on XRPL EVM Testnet
    // See: https://docs.xrplevm.org/pages/bridge/interchain-transfer
    ITS_CONTRACT: '0x3b1ca8B18698409fF95e29c506ad7014980F0193',

    // ITS Token Factory (Testnet)
    ITS_FACTORY: '0x83a93500d23Fbc3e82B410aD07A6a9F7A0670D66',
  },
};

/**
 * Legacy flat address structure for backward compatibility
 * @deprecated Use getAddressesForEnvironment() instead
 */
const AXELAR_ADDRESSES_LEGACY = {
  XRPL_BRIDGE: AXELAR_ADDRESSES.MAINNET.XRPL_BRIDGE,
  EVM_GATEWAY: AXELAR_ADDRESSES.MAINNET.EVM_GATEWAY,
  GAS_SERVICE: AXELAR_ADDRESSES.MAINNET.GAS_SERVICE,
  WXRP_TOKEN: AXELAR_ADDRESSES.MAINNET.NATIVE_XRP, // Renamed to NATIVE_XRP
  ITS_CONTRACT: AXELAR_ADDRESSES.MAINNET.ITS_CONTRACT,
  ITS_FACTORY: AXELAR_ADDRESSES.MAINNET.ITS_FACTORY,
};

/**
 * Check if an address is a TBD placeholder
 */
const isTBDAddress = (address: string): boolean => {
  return address.includes('TBD');
};

/**
 * Validate that required addresses are not TBD placeholders
 * Throws an error if TBD addresses are used in non-demo mode
 *
 * @param environment - 'mainnet' or 'testnet'
 * @param demoMode - Whether the service is in demo mode
 * @throws Error if TBD addresses are detected in real mode
 */
const validateAddressesForRealMode = (
  environment: 'mainnet' | 'testnet',
  demoMode: boolean
): void => {
  if (demoMode) {
    return; // Skip validation in demo mode
  }

  const addresses = environment === 'mainnet'
    ? AXELAR_ADDRESSES.MAINNET
    : AXELAR_ADDRESSES.TESTNET;

  const tbdAddresses: string[] = [];

  if (isTBDAddress(addresses.XRPL_BRIDGE)) {
    tbdAddresses.push(`XRPL_BRIDGE: ${addresses.XRPL_BRIDGE}`);
  }
  if (isTBDAddress(addresses.EVM_GATEWAY)) {
    tbdAddresses.push(`EVM_GATEWAY: ${addresses.EVM_GATEWAY}`);
  }

  if (tbdAddresses.length > 0) {
    throw new Error(
      `Cannot use real mode with TBD placeholder addresses on ${environment}. ` +
      `The following addresses need to be updated with real values:\n` +
      tbdAddresses.join('\n') +
      `\n\nPlease check https://docs.axelar.dev/dev/reference/mainnet-contract-addresses/ ` +
      `for the latest Axelar contract addresses.`
    );
  }
};

/**
 * Get the appropriate addresses for the given environment
 */
const getAddressesForEnvironment = (environment: 'mainnet' | 'testnet') => {
  return environment === 'mainnet'
    ? AXELAR_ADDRESSES.MAINNET
    : AXELAR_ADDRESSES.TESTNET;
};

// =============================================================================
// Transaction Stores (Separated for Demo and Real modes)
// =============================================================================

/**
 * In-memory store for demo/mock transactions
 * Used when demoMode is true for development/testing
 */
const demoTransactions = new Map<string, BridgeTransaction>();

/**
 * In-memory store for real transactions
 * Used when demoMode is false for actual blockchain operations
 * In production, this could be backed by persistent storage
 */
const realTransactions = new Map<string, BridgeTransaction>();

/**
 * Get the appropriate transaction store based on mode
 * @param demoMode - Whether the service is in demo mode
 * @returns The appropriate transaction store
 */
const getTransactionStore = (demoMode: boolean): Map<string, BridgeTransaction> => {
  return demoMode ? demoTransactions : realTransactions;
};


// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Generate a mock transaction hash
 */
const generateMockTxHash = (direction: BridgeDirection): string => {
  const prefix = direction === 'toEVM' ? '0x' : '';
  const randomPart = Math.random().toString(36).substring(2, 15) +
    Math.random().toString(36).substring(2, 15);
  return `${prefix}${randomPart.toUpperCase().padEnd(64, '0')}`;
};

/**
 * Generate a unique bridge transaction ID
 */
const generateBridgeId = (): string => {
  return `BRG-${Date.now()}-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
};

/**
 * Calculate bridge fee
 */
const calculateFee = (amount: string): string => {
  const amountNum = parseFloat(amount);
  if (isNaN(amountNum) || amountNum <= 0) {
    return '0';
  }
  const fee = amountNum * BRIDGE_CONFIG.FEE_PERCENTAGE;
  return fee.toFixed(6);
};

/**
 * Validate XRPL address format
 */
const isValidXRPLAddress = (address: string): boolean => {
  const xrplAddressRegex = /^r[1-9A-HJ-NP-Za-km-z]{24,34}$/;
  return xrplAddressRegex.test(address);
};

/**
 * Validate EVM address format
 */
const isValidEVMAddress = (address: string): boolean => {
  const evmAddressRegex = /^0x[a-fA-F0-9]{40}$/;
  return evmAddressRegex.test(address);
};

/**
 * Simulate random delay for realistic behavior
 */
const simulateDelay = (baseMs: number, varianceMs: number = 500): Promise<void> => {
  const delay = baseMs + Math.random() * varianceMs;
  return new Promise((resolve) => setTimeout(resolve, delay));
};

/**
 * Map Axelar GMP status to our internal status type
 *
 * IMPORTANT: 'cannot_fetch_status' is returned by Axelar's GMP API for XRPL native
 * transactions because XRPL is not an EVM chain and Axelar cannot index it the same way.
 * This is NOT a failure - the XRPL transaction may have succeeded. We treat it as 'pending'
 * to allow the orchestrator to verify the transaction via XRPL ledger directly.
 */
const mapAxelarStatusToBridgeStatus = (axelarStatus: AxelarGMPStatus): BridgeStatusType => {
  switch (axelarStatus) {
    case 'source_gateway_called':
    case 'approving':
    case 'confirmed':
      return 'pending';
    case 'destination_gateway_approved':
    case 'executing':
      return 'confirming';
    case 'destination_executed':
    case 'express_executed':
      return 'complete';
    // True failure statuses - these indicate actual errors
    case 'error':
    case 'unknown_error':
    case 'insufficient_fee':
      return 'failed';
    // cannot_fetch_status is NOT a failure - Axelar can't track XRPL native txs
    // The orchestrator should verify via XRPL ledger if this persists
    case 'cannot_fetch_status':
      return 'pending';
    default:
      return 'pending';
  }
};

/**
 * Generate Axelarscan URL for transaction tracking
 */
const getAxelarscanUrl = (
  txHash: string,
  environment: 'mainnet' | 'testnet' = 'mainnet'
): string => {
  const baseUrl = environment === 'mainnet'
    ? AXELAR_API.AXELARSCAN_MAINNET
    : AXELAR_API.AXELARSCAN_TESTNET;
  return `${baseUrl}/gmp/${txHash}`;
};

// =============================================================================
// Browser-Compatible Utilities
// =============================================================================

/**
 * Convert a string to hex encoding (browser-compatible)
 * Replaces Node.js Buffer.from(str).toString('hex') which doesn't work in browsers
 */
const stringToHex = (str: string): string => {
  return Array.from(new TextEncoder().encode(str))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
};

// =============================================================================
// AxelarBridgeService Class
// =============================================================================

class AxelarBridgeService {
  private pollingIntervals: Map<string, NodeJS.Timeout> = new Map();
  private evmProvider: EVMProviderService | null = null;
  private gemWalletService: GemWalletService | null = null;
  private evmSigner: EVMSignerService | null = null;
  private demoMode: boolean = true;
  private axelarEnvironment: 'mainnet' | 'testnet' = 'mainnet';

  constructor(config?: BridgeServiceConfig) {
    this.evmProvider = config?.evmProvider ?? null;
    this.gemWalletService = config?.gemWalletService ?? null;
    this.evmSigner = config?.evmSignerService ?? evmSignerService;
    this.demoMode = config?.demoMode ?? true;
    this.axelarEnvironment = config?.axelarEnvironment ?? 'mainnet';
  }

  /**
   * Set the EVM provider for real blockchain interactions
   * This allows late binding of the provider for dependency injection
   */
  setEVMProvider(provider: EVMProviderService): void {
    this.evmProvider = provider;
  }

  /**
   * Set the GemWallet service for XRPL transaction signing
   */
  setGemWalletService(service: GemWalletService): void {
    this.gemWalletService = service;
  }

  /**
   * Set the EVM signer service for EVM transaction signing
   */
  setEVMSignerService(service: EVMSignerService): void {
    this.evmSigner = service;
  }

  /**
   * Check if the service is running in demo mode
   */
  isDemoMode(): boolean {
    return this.demoMode;
  }

  /**
   * Enable or disable demo mode
   * When demo mode is disabled, real EVM provider, signer, and GemWallet must be set
   * Also validates that required contract addresses are not TBD placeholders
   *
   * @param enabled - Whether to enable demo mode
   * @throws Error if trying to disable demo mode with TBD addresses
   */
  setDemoMode(enabled: boolean): void {
    if (!enabled) {
      // Validate addresses before disabling demo mode
      validateAddressesForRealMode(this.axelarEnvironment, false);

      if (!this.evmProvider) {
        console.warn('[AxelarBridgeService] Disabling demo mode without EVM provider - EVM transactions will fail');
      }
      if (!this.evmSigner) {
        console.warn('[AxelarBridgeService] Disabling demo mode without EVM signer - EVM transactions will fail');
      }
      if (!this.gemWalletService) {
        console.warn('[AxelarBridgeService] Disabling demo mode without GemWallet - XRPL transactions will fail');
      }
    }
    this.demoMode = enabled;
  }

  /**
   * Get the current transaction store based on demo mode
   * @private
   */
  private getStore(): Map<string, BridgeTransaction> {
    return getTransactionStore(this.demoMode);
  }

  /**
   * Set Axelar environment (mainnet or testnet)
   */
  setAxelarEnvironment(environment: 'mainnet' | 'testnet'): void {
    this.axelarEnvironment = environment;
  }

  /**
   * Check EVM provider connection status
   * Returns null if no provider is configured
   */
  async checkEVMConnection(): Promise<{ connected: boolean; chainId: number | null } | null> {
    if (!this.evmProvider) {
      return null;
    }

    try {
      const status = await this.evmProvider.checkConnection();
      return {
        connected: status.connected,
        chainId: status.chainId,
      };
    } catch {
      return { connected: false, chainId: null };
    }
  }

  /**
   * Check if GemWallet is available for XRPL transactions
   */
  async checkGemWalletConnection(): Promise<boolean> {
    if (!this.gemWalletService) {
      return false;
    }

    try {
      return await this.gemWalletService.isInstalled();
    } catch {
      return false;
    }
  }

  /**
   * Bridge XRP from XRPL Mainnet to EVM Sidechain
   *
   * Flow (Real Mode):
   * 1. Get deposit address from Axelar SDK
   * 2. Use GemWallet to send XRP to deposit address
   * 3. Axelar validators confirm the deposit
   * 4. wXRP is minted on XRPL EVM Sidechain
   *
   * Flow (Demo Mode):
   * 1. Simulate deposit address generation
   * 2. Return mock transaction hash
   * 3. Simulate confirmation progress
   *
   * @param amount - Amount of XRP to bridge
   * @param fromXRPLAddress - Sender's XRPL address
   * @param toEVMAddress - Recipient's EVM address on sidechain
   */
  async bridgeToEVM(
    amount: string,
    fromXRPLAddress: string,
    toEVMAddress: string
  ): Promise<BridgeResult> {
    try {
      // Validate inputs
      if (!isValidXRPLAddress(fromXRPLAddress)) {
        return {
          success: false,
          txHash: null,
          error: 'Invalid XRPL address format',
        };
      }

      if (!isValidEVMAddress(toEVMAddress)) {
        return {
          success: false,
          txHash: null,
          error: 'Invalid EVM address format',
        };
      }

      const amountNum = parseFloat(amount);
      if (isNaN(amountNum) || amountNum <= 0) {
        return {
          success: false,
          txHash: null,
          error: 'Invalid amount',
        };
      }

      if (amountNum < parseFloat(BRIDGE_CONFIG.MINIMUM_AMOUNT)) {
        return {
          success: false,
          txHash: null,
          error: `Minimum bridge amount is ${BRIDGE_CONFIG.MINIMUM_AMOUNT} XRP`,
        };
      }

      // Real mode implementation
      if (!this.demoMode) {
        return await this.realBridgeToEVM(amount, fromXRPLAddress, toEVMAddress);
      }

      // Demo mode: Simulate network delay
      await simulateDelay(1000);

      // Simulate random failure (2% chance)
      if (Math.random() < BRIDGE_CONFIG.MOCK.FAILURE_RATE) {
        return {
          success: false,
          txHash: null,
          error: 'Bridge transaction failed: Network congestion',
        };
      }

      // Create mock transaction
      const txHash = generateMockTxHash('toEVM');
      const bridgeId = generateBridgeId();
      const mockDepositAddress = `rMock${Math.random().toString(36).substring(2, 12).toUpperCase()}`;

      const bridgeTx: BridgeTransaction = {
        id: bridgeId,
        direction: 'toEVM',
        amount,
        fromAddress: fromXRPLAddress,
        toAddress: toEVMAddress,
        status: 'pending',
        txHash,
        depositAddress: mockDepositAddress,
        startedAt: Date.now(),
        confirmations: 0,
      };

      this.getStore().set(txHash, bridgeTx);

      // Start mock confirmation simulation
      this.simulateConfirmations(txHash, 'toEVM');

      return {
        success: true,
        txHash,
        depositAddress: mockDepositAddress,
      };
    } catch (error) {
      console.error('bridgeToEVM failed:', error);
      return {
        success: false,
        txHash: null,
        error: error instanceof Error ? error.message : 'Unknown error occurred',
      };
    }
  }

  /**
   * Real implementation of bridgeToEVM using Axelar SDK
   *
   * This method requires:
   * - @axelar-network/axelarjs-sdk package installed
   * - GemWallet service configured
   *
   * Implementation notes:
   * - Uses direct deposit to Axelar's XRPL bridge address with destination in memo
   * - Uses GemWallet to sign and send XRP to the deposit address
   * - Deposit addresses expire after 24 hours
   */
  private async realBridgeToEVM(
    amount: string,
    fromXRPLAddress: string,
    toEVMAddress: string
  ): Promise<BridgeResult> {
    // Check GemWallet availability
    if (!this.gemWalletService) {
      return {
        success: false,
        txHash: null,
        error: 'GemWallet service not configured',
      };
    }

    const isGemWalletInstalled = await this.gemWalletService.isInstalled();
    if (!isGemWalletInstalled) {
      return {
        success: false,
        txHash: null,
        error: 'GemWallet extension not installed',
      };
    }

    try {
      // Get the Axelar bridge address for direct deposit
      // XRPL -> EVM bridging uses direct deposit to Axelar's XRPL multisig
      const addresses = getAddressesForEnvironment(this.axelarEnvironment);
      const depositAddress = addresses.XRPL_BRIDGE;

      console.log('[AxelarBridgeService] Using Axelar bridge address:', depositAddress);
      console.log('[AxelarBridgeService] Destination EVM address:', toEVMAddress);

      // Send XRP to Axelar bridge address with destination in memo
      // The memo contains the destination EVM address for Axelar validators
      console.log('[AxelarBridgeService] Sending XRP to bridge via GemWallet...');

      let paymentResult;
      try {
        // Format destination address correctly:
        // Axelar expects the raw hex address WITHOUT the 0x prefix
        const rawEVMAddress = toEVMAddress.startsWith('0x')
          ? toEVMAddress.slice(2).toLowerCase()
          : toEVMAddress.toLowerCase();

        // Calculate gas fee amount (in drops) - allocate a portion for EVM gas
        // Axelar requires this to cover gas costs on the destination chain
        // Using ~0.1 XRP (100000 drops) as a reasonable gas allocation
        const gasFeeDrops = '100000';

        paymentResult = await this.gemWalletService.sendPayment({
          amount,
          destination: depositAddress,
          memos: [
            {
              memo: {
                // REQUIRED: Transaction type identifier for Axelar relayer
                // Without this, Axelar doesn't know this is an interchain transfer
                memoType: stringToHex('type'),
                memoData: stringToHex('interchain_transfer'),
              },
            },
            {
              memo: {
                // Memo type: destination chain identifier
                memoType: stringToHex('destination_chain'),
                memoData: stringToHex('xrpl-evm'),
              },
            },
            {
              memo: {
                // Memo type: destination address on EVM
                // IMPORTANT: Axelar expects the address string to be HEX-ENCODED
                // The raw address (without 0x) must be converted to hex characters
                // e.g., '9ada...' -> hex('9ada...') = '39616461...'
                memoType: stringToHex('destination_address'),
                memoData: stringToHex(rawEVMAddress),
              },
            },
            {
              memo: {
                // REQUIRED: Gas fee amount for destination chain execution
                // This is deducted from the total amount to cover EVM gas costs
                memoType: stringToHex('gas_fee_amount'),
                memoData: stringToHex(gasFeeDrops),
              },
            },
          ],
        });
      } catch (paymentError) {
        // Re-throw with clear error message preserving XRPL error codes
        // This ensures terminal errors like tecUNFUNDED_PAYMENT are properly detected
        const errorMessage = paymentError instanceof Error
          ? paymentError.message
          : String(paymentError);
        console.error('[AxelarBridgeService] XRPL payment failed:', errorMessage);
        throw new Error(`XRPL payment failed: ${errorMessage}`);
      }

      console.log('[AxelarBridgeService] XRPL payment submitted:', paymentResult.hash);

      // Step 3: Store transaction for status tracking
      const bridgeId = generateBridgeId();
      const bridgeTx: BridgeTransaction = {
        id: bridgeId,
        direction: 'toEVM',
        amount,
        fromAddress: fromXRPLAddress,
        toAddress: toEVMAddress,
        status: 'pending',
        txHash: paymentResult.hash,
        depositAddress,
        startedAt: Date.now(),
        confirmations: 0,
      };

      this.getStore().set(paymentResult.hash, bridgeTx);

      // Step 4: Start status polling
      this.startStatusPolling(paymentResult.hash);

      return {
        success: true,
        txHash: paymentResult.hash,
        depositAddress,
      };
    } catch (error) {
      console.error('[AxelarBridgeService] Real bridgeToEVM failed:', error);
      return {
        success: false,
        txHash: null,
        error: error instanceof Error ? error.message : 'Bridge transaction failed',
      };
    }
  }

  /**
   * Bridge wXRP from EVM Sidechain back to XRPL Mainnet
   *
   * Flow (Real Mode):
   * 1. User calls ITS contract's interchainTransfer on EVM
   * 2. Axelar validators confirm the transfer
   * 3. XRP is released on XRPL Mainnet
   *
   * Flow (Demo Mode):
   * 1. Return mock transaction hash
   * 2. Simulate confirmation progress
   *
   * @param amount - Amount of wXRP to bridge
   * @param fromEVMAddress - Sender's EVM address on sidechain
   * @param toXRPLAddress - Recipient's XRPL address
   */
  async bridgeToXRPL(
    amount: string,
    fromEVMAddress: string,
    toXRPLAddress: string
  ): Promise<BridgeResult> {
    try {
      // Validate inputs
      if (!isValidEVMAddress(fromEVMAddress)) {
        return {
          success: false,
          txHash: null,
          error: 'Invalid EVM address format',
        };
      }

      if (!isValidXRPLAddress(toXRPLAddress)) {
        return {
          success: false,
          txHash: null,
          error: 'Invalid XRPL address format',
        };
      }

      const amountNum = parseFloat(amount);
      if (isNaN(amountNum) || amountNum <= 0) {
        return {
          success: false,
          txHash: null,
          error: 'Invalid amount',
        };
      }

      if (amountNum < parseFloat(BRIDGE_CONFIG.MINIMUM_AMOUNT)) {
        return {
          success: false,
          txHash: null,
          error: `Minimum bridge amount is ${BRIDGE_CONFIG.MINIMUM_AMOUNT} XRP`,
        };
      }

      // Real mode implementation
      if (!this.demoMode) {
        return await this.realBridgeToXRPL(amount, fromEVMAddress, toXRPLAddress);
      }

      // Demo mode: Simulate network delay
      await simulateDelay(1200);

      // Simulate random failure (2% chance)
      if (Math.random() < BRIDGE_CONFIG.MOCK.FAILURE_RATE) {
        return {
          success: false,
          txHash: null,
          error: 'Bridge transaction failed: Insufficient liquidity',
        };
      }

      // Create mock transaction
      const txHash = generateMockTxHash('toXRPL');
      const bridgeId = generateBridgeId();

      const bridgeTx: BridgeTransaction = {
        id: bridgeId,
        direction: 'toXRPL',
        amount,
        fromAddress: fromEVMAddress,
        toAddress: toXRPLAddress,
        status: 'pending',
        txHash,
        startedAt: Date.now(),
        confirmations: 0,
      };

      this.getStore().set(txHash, bridgeTx);

      // Start mock confirmation simulation
      this.simulateConfirmations(txHash, 'toXRPL');

      return {
        success: true,
        txHash,
      };
    } catch (error) {
      console.error('bridgeToXRPL failed:', error);
      return {
        success: false,
        txHash: null,
        error: error instanceof Error ? error.message : 'Unknown error occurred',
      };
    }
  }

  /**
   * Real implementation of bridgeToXRPL using EVM provider and Axelar ITS
   *
   * This method requires:
   * - EVM provider configured
   * - EVM signer service configured with a wallet
   *
   * Implementation notes:
   * - Calls the ITS contract's interchainTransfer method
   * - Uses the EVM signer service for signing transactions
   * - Transaction is sent using the signer's sendTransaction method
   * - Uses AxelarQueryAPI to estimate gas fees dynamically
   */
  private async realBridgeToXRPL(
    amount: string,
    fromEVMAddress: string,
    toXRPLAddress: string
  ): Promise<BridgeResult> {
    // Check EVM provider availability
    if (!this.evmProvider) {
      return {
        success: false,
        txHash: null,
        error: 'EVM provider not configured',
      };
    }

    const connStatus = await this.evmProvider.checkConnection();
    if (!connStatus.connected) {
      return {
        success: false,
        txHash: null,
        error: 'EVM provider not connected',
      };
    }

    // Check EVM signer availability
    if (!this.evmSigner) {
      return {
        success: false,
        txHash: null,
        error: 'EVM signer not configured',
      };
    }

    const hasWallet = await this.evmSigner.hasWallet();
    if (!hasWallet) {
      return {
        success: false,
        txHash: null,
        error: 'No EVM wallet found. Create or import a wallet first.',
      };
    }

    // Verify the signer address matches the expected from address
    const signerAddress = await this.evmSigner.getAddress();
    if (signerAddress?.toLowerCase() !== fromEVMAddress.toLowerCase()) {
      return {
        success: false,
        txHash: null,
        error: `Signer address mismatch. Expected ${fromEVMAddress}, got ${signerAddress}`,
      };
    }

    try {
      console.log('[AxelarBridgeService] Initiating bridge from EVM to XRPL...');

      // ITS Contract ABI for interchainTransfer
      // See: https://github.com/axelarnetwork/interchain-token-service
      // Get environment-specific ITS contract address
      const envAddresses = getAddressesForEnvironment(this.axelarEnvironment);
      const itsContractAddress = envAddresses.ITS_CONTRACT;

      const ITS_ABI = [
        'function interchainTransfer(bytes32 tokenId, string destinationChain, bytes destinationAddress, uint256 amount, bytes metadata, uint256 gasValue) external payable',
        'function interchainTokenId(address operator, bytes32 salt) external view returns (bytes32)',
      ];

      // Create contract interface for encoding the call data
      const itsContract = new Contract(
        itsContractAddress,
        ITS_ABI,
        this.evmProvider.getProvider()
      );

      // Encode the destination address for cross-chain transfer
      // For XRPL, the destination address is passed as bytes
      // Use browser-compatible stringToHex helper (not Node.js Buffer)
      const destinationAddressBytes = '0x' + stringToHex(toXRPLAddress);

      // XRP token ID on XRPL EVM Sidechain (registered with Axelar ITS)
      // Token Manager Type: NATIVE_INTERCHAIN_TOKEN (Type 4) - XRP is native gas token
      //
      // MAINNET (Chain ID: 1440000) - VERIFIED WORKING:
      //   - ITS: 0xB5FB4BE02232B1bBA4dC8f81dc24C26980dE9e3C
      //   - Token Manager: 0xdb0a778c57Bd31E401D52ba6cf936D06E1324aE8
      //   - xrpl chain: TRUSTED ✅
      //
      // TESTNET (Chain ID: 1449000) - BLOCKED:
      //   - ITS: 0x3b1ca8B18698409fF95e29c506ad7014980F0193
      //   - xrpl chain: NOT TRUSTED ❌ (UntrustedChain error)
      //
      // See: https://docs.xrplevm.org/pages/bridge/interchain-transfer
      const XRP_TOKEN_ID = '0xba5a21ca88ef6bba2bfff5088994f90e1077e2a1cc3dcc38bd261f00fce2824f';
      const WXRP_TOKEN_ID = XRP_TOKEN_ID;

      // Parse amount to wei (wXRP has 18 decimals)
      const amountWei = parseUnits(amount, 18);

      // Estimate gas fee for cross-chain execution
      // NOTE: The Axelar SDK's estimateGasFee doesn't support 'xrpl-evm' and 'xrpl' chains
      // as they were integrated via Amplifier, not the legacy gateway. The SDK may return
      // "Invalid chain identifier" errors - this is expected and we fall back to defaults.
      let gasValue = BigInt(0);
      try {
        const axelarQueryApi = new AxelarQueryAPI({
          environment: this.axelarEnvironment === 'mainnet' ? Environment.MAINNET : Environment.TESTNET,
        });

        // Try SDK estimation - may fail for Amplifier chains like XRPL
        const gasFeeEstimate = await axelarQueryApi.estimateGasFee(
          AXELAR_CHAIN_IDS.XRPL_EVM, // Source: XRPL EVM Sidechain
          AXELAR_CHAIN_IDS.XRPL,     // Destination: XRPL Mainnet (r-address)
          200000,                     // Gas limit for destination execution
          'auto',                     // Automatic gas multiplier
        );

        if (typeof gasFeeEstimate === 'string') {
          gasValue = BigInt(gasFeeEstimate);
          console.log('[AxelarBridgeService] Estimated gas fee:', gasFeeEstimate);
        }
      } catch (gasError) {
        // Expected for Amplifier chains - SDK doesn't have XRPL chain configs yet
        // Using conservative default: 0.01 XRP for cross-chain gas
        console.log('[AxelarBridgeService] Using default gas value (SDK does not support XRPL chains yet)');
        gasValue = parseUnits('0.01', 18); // 0.01 XRP in wei
      }

      // Encode the function call
      const callData = itsContract.interface.encodeFunctionData('interchainTransfer', [
        WXRP_TOKEN_ID,
        AXELAR_CHAIN_IDS.XRPL,
        destinationAddressBytes,
        amountWei,
        '0x', // Empty metadata
        gasValue, // Gas value for cross-chain execution
      ]);

      console.log('[AxelarBridgeService] Estimating transaction gas...');

      // Estimate gas for the transaction
      const gasEstimate = await this.evmProvider.getProvider().estimateGas({
        from: fromEVMAddress,
        to: itsContractAddress,
        data: callData,
        value: gasValue,
      });

      // Add 20% buffer to gas estimate
      const gasLimit = (gasEstimate * BigInt(120)) / BigInt(100);

      console.log('[AxelarBridgeService] Sending ITS transaction...');

      // Send the transaction using the signer
      const txResponse: TransactionResponse = await this.evmSigner.sendTransaction({
        to: itsContractAddress,
        data: callData,
        gasLimit,
        value: gasValue,
      });

      console.log('[AxelarBridgeService] Transaction submitted:', txResponse.hash);

      // Store transaction for status tracking
      const bridgeId = generateBridgeId();
      const bridgeTx: BridgeTransaction = {
        id: bridgeId,
        direction: 'toXRPL',
        amount,
        fromAddress: fromEVMAddress,
        toAddress: toXRPLAddress,
        status: 'pending',
        txHash: txResponse.hash,
        startedAt: Date.now(),
        confirmations: 0,
      };

      this.getStore().set(txResponse.hash, bridgeTx);

      // Start status polling
      this.startStatusPolling(txResponse.hash);

      return {
        success: true,
        txHash: txResponse.hash,
      };
    } catch (error) {
      console.error('[AxelarBridgeService] Real bridgeToXRPL failed:', error);
      return {
        success: false,
        txHash: null,
        error: error instanceof Error ? error.message : 'Bridge transaction failed',
      };
    }
  }

  /**
   * Get the status of a bridge transaction
   *
   * In real mode, queries Axelar's GMP API for transaction status.
   * In demo mode, returns status from local mock store.
   *
   * @param txHash - Transaction hash to check
   */
  async getBridgeStatus(txHash: string): Promise<BridgeStatus> {
    // Get transaction from the appropriate store based on mode
    const store = this.getStore();
    const tx = store.get(txHash);

    if (!tx) {
      return {
        status: 'failed',
        confirmations: 0,
        requiredConfirmations: 0,
        estimatedTimeRemaining: 0,
      };
    }

    // In real mode, also query Axelar API for fresh status
    if (!this.demoMode) {
      try {
        const axelarStatus = await this.queryAxelarStatus(txHash);
        if (axelarStatus) {
          const mappedStatus = mapAxelarStatusToBridgeStatus(axelarStatus.status);

          // Update local store with Axelar status
          tx.axelarStatus = axelarStatus.status;
          tx.status = mappedStatus;
          if (mappedStatus === 'complete') {
            tx.completedAt = Date.now();
          }
          store.set(txHash, tx);

          return {
            status: mappedStatus,
            confirmations: tx.confirmations,
            requiredConfirmations: BRIDGE_CONFIG.REQUIRED_CONFIRMATIONS[tx.direction],
            estimatedTimeRemaining: this.calculateEstimatedTime(tx),
            axelarStatus: axelarStatus.status,
            axelarScanUrl: getAxelarscanUrl(txHash, this.axelarEnvironment),
          };
        }
      } catch (error) {
        console.warn('[AxelarBridgeService] Failed to query Axelar status:', error);
        // Fall back to local status
      }
    }

    const requiredConfirmations = BRIDGE_CONFIG.REQUIRED_CONFIRMATIONS[tx.direction];
    const estimatedTime = BRIDGE_CONFIG.ESTIMATED_TIME[tx.direction];

    // Calculate estimated time remaining
    let estimatedTimeRemaining = 0;
    if (tx.status !== 'complete' && tx.status !== 'failed') {
      const elapsed = (Date.now() - tx.startedAt) / 1000;
      estimatedTimeRemaining = Math.max(0, estimatedTime - elapsed);
    }

    return {
      status: tx.status,
      confirmations: tx.confirmations,
      requiredConfirmations,
      estimatedTimeRemaining: Math.round(estimatedTimeRemaining),
      axelarStatus: tx.axelarStatus,
      axelarScanUrl: this.demoMode ? undefined : getAxelarscanUrl(txHash, this.axelarEnvironment),
    };
  }

  /**
   * Query Axelar GMP API for transaction status
   *
   * Uses AxelarRecoveryApi.queryTransactionStatus() for reliable status tracking.
   * Falls back to direct API call if SDK method fails.
   */
  private async queryAxelarStatus(txHash: string): Promise<AxelarStatusResponse | null> {
    try {
      // Primary: Use Axelar SDK's AxelarRecoveryApi
      console.log('[AxelarBridgeService] Querying transaction status via Axelar SDK...');

      const recoveryApi = new AxelarRecoveryApi({
        environment: this.axelarEnvironment === 'mainnet' ? Environment.MAINNET : Environment.TESTNET,
      });

      const statusResponse: GMPStatusResponse = await recoveryApi.queryTransactionStatus(txHash);

      console.log('[AxelarBridgeService] Status response:', statusResponse.status);

      // Map SDK GMPStatus to our AxelarGMPStatus type
      const mappedStatus = this.mapSDKStatusToAxelarGMPStatus(statusResponse.status as string);

      return {
        status: mappedStatus,
        gasPaidInfo: statusResponse.gasPaidInfo ? {
          status: statusResponse.gasPaidInfo.status as 'gas_unpaid' | 'gas_paid' | 'gas_paid_not_enough_gas' | 'gas_paid_enough_gas',
        } : undefined,
        error: statusResponse.error ? {
          message: statusResponse.error.message,
        } : undefined,
      };
    } catch (sdkError) {
      console.warn('[AxelarBridgeService] SDK status query failed, trying direct API:', sdkError);

      // Fallback: Direct API call
      try {
        const apiBase = this.axelarEnvironment === 'mainnet'
          ? AXELAR_API.MAINNET
          : AXELAR_API.TESTNET;

        const response = await fetch(`${apiBase}/gmp/${txHash}`);
        if (!response.ok) {
          return null;
        }

        const data = await response.json();
        return {
          status: data.status as AxelarGMPStatus,
          gasPaidInfo: data.gas_paid_info,
          error: data.error,
        };
      } catch (apiError) {
        console.warn('[AxelarBridgeService] Direct API query also failed:', apiError);
        return null;
      }
    }
  }

  /**
   * Map SDK GMPStatus enum values to our AxelarGMPStatus type
   * @param sdkStatus - Status string from Axelar SDK
   * @param strict - If true, throws error on unknown status (default: false)
   * @returns Mapped AxelarGMPStatus
   */
  private mapSDKStatusToAxelarGMPStatus(sdkStatus: string, strict: boolean = false): AxelarGMPStatus {
    // Map SDK status values to our internal type
    const statusMap: Record<string, AxelarGMPStatus> = {
      [GMPStatus.SRC_GATEWAY_CALLED]: 'source_gateway_called',
      [GMPStatus.DEST_GATEWAY_APPROVED]: 'destination_gateway_approved',
      [GMPStatus.DEST_EXECUTED]: 'destination_executed',
      [GMPStatus.EXPRESS_EXECUTED]: 'express_executed',
      [GMPStatus.DEST_EXECUTE_ERROR]: 'error',
      [GMPStatus.DEST_EXECUTING]: 'executing',
      [GMPStatus.APPROVING]: 'approving',
      [GMPStatus.SRC_GATEWAY_CONFIRMED]: 'confirmed',
      [GMPStatus.NOT_EXECUTED]: 'not_executed',
      [GMPStatus.NOT_EXECUTED_WITHOUT_GAS_PAID]: 'not_executed',
      [GMPStatus.INSUFFICIENT_FEE]: 'insufficient_fee',
      [GMPStatus.UNKNOWN_ERROR]: 'unknown_error',
      [GMPStatus.CANNOT_FETCH_STATUS]: 'cannot_fetch_status',
    };

    const mappedStatus = statusMap[sdkStatus];

    if (!mappedStatus) {
      // Log warning for unknown status values - helps debug SDK version mismatches
      console.warn(
        `[AxelarBridgeService] Unknown GMP status received: "${sdkStatus}". ` +
        `This may indicate an Axelar SDK version mismatch. ` +
        `Known statuses: ${Object.keys(statusMap).join(', ')}. ` +
        `Falling back to 'cannot_fetch_status'.`
      );

      // In strict mode, throw an error instead of silently falling back
      if (strict) {
        throw new Error(
          `Unknown Axelar GMP status: "${sdkStatus}". ` +
          `Consider updating the status mapping or Axelar SDK.`
        );
      }

      return 'cannot_fetch_status';
    }

    return mappedStatus;
  }

  /**
   * Calculate estimated time remaining for a transaction
   */
  private calculateEstimatedTime(tx: BridgeTransaction): number {
    if (tx.status === 'complete' || tx.status === 'failed') {
      return 0;
    }

    const estimatedTime = BRIDGE_CONFIG.ESTIMATED_TIME[tx.direction];
    const elapsed = (Date.now() - tx.startedAt) / 1000;
    return Math.max(0, Math.round(estimatedTime - elapsed));
  }

  /**
   * Get estimated bridge time and fees
   *
   * In real mode, queries Axelar's fee estimation API for accurate fee calculation.
   * Falls back to static 0.1% fee if SDK query fails.
   *
   * @param amount - Amount to bridge
   * @param direction - Bridge direction
   */
  async getEstimate(amount: string, direction: BridgeDirection): Promise<BridgeEstimate> {
    const estimatedTime = BRIDGE_CONFIG.ESTIMATED_TIME[direction];
    const minimumAmount = BRIDGE_CONFIG.MINIMUM_AMOUNT;

    // In demo mode, use static fee calculation
    if (this.demoMode) {
      return {
        fee: calculateFee(amount),
        estimatedTime,
        minimumAmount,
      };
    }

    // Real mode: Query Axelar for dynamic fee estimation
    try {
      console.log('[AxelarBridgeService] Fetching fee estimate from Axelar SDK...');

      const axelarQueryApi = new AxelarQueryAPI({
        environment: this.axelarEnvironment === 'mainnet' ? Environment.MAINNET : Environment.TESTNET,
      });

      const sourceChain = direction === 'toEVM' ? AXELAR_CHAIN_IDS.XRPL : AXELAR_CHAIN_IDS.XRPL_EVM;
      const destChain = direction === 'toEVM' ? AXELAR_CHAIN_IDS.XRPL_EVM : AXELAR_CHAIN_IDS.XRPL;

      // Try to get transfer fee from Axelar
      // Note: getTransferFee returns the fee in the asset's smallest unit
      const amountInDrops = Math.floor(parseFloat(amount) * 1_000_000); // Convert XRP to drops

      try {
        const transferFeeResponse = await axelarQueryApi.getTransferFee(
          sourceChain,
          destChain,
          'xrp',
          amountInDrops,
        );

        if (transferFeeResponse?.fee?.amount) {
          // Convert fee from drops back to XRP
          const feeInXRP = (parseInt(transferFeeResponse.fee.amount) / 1_000_000).toFixed(6);
          console.log('[AxelarBridgeService] Transfer fee from Axelar:', feeInXRP, 'XRP');

          return {
            fee: feeInXRP,
            estimatedTime,
            minimumAmount,
          };
        }
      } catch (transferFeeError) {
        console.warn('[AxelarBridgeService] getTransferFee failed, trying estimateGasFee:', transferFeeError);
      }

      // Alternative: Use gas fee estimation for cross-chain gas costs
      const gasFeeEstimate = await axelarQueryApi.estimateGasFee(
        sourceChain,
        destChain,
        200000, // Estimated gas limit
        'auto',
      );

      if (typeof gasFeeEstimate === 'string') {
        // Gas fee is in wei, convert to a more readable format
        const gasFeeXRP = (parseFloat(gasFeeEstimate) / 1e18).toFixed(6);
        // Combine with base percentage fee
        const baseFee = parseFloat(calculateFee(amount));
        const totalFee = (baseFee + parseFloat(gasFeeXRP)).toFixed(6);

        console.log('[AxelarBridgeService] Estimated total fee:', totalFee, 'XRP');

        return {
          fee: totalFee,
          estimatedTime,
          minimumAmount,
        };
      }

      // If we got a detailed fee response
      if (typeof gasFeeEstimate === 'object' && gasFeeEstimate.baseFee) {
        const baseFeeXRP = (parseFloat(gasFeeEstimate.baseFee) / 1e18).toFixed(6);
        const percentageFee = parseFloat(calculateFee(amount));
        const totalFee = (percentageFee + parseFloat(baseFeeXRP)).toFixed(6);

        console.log('[AxelarBridgeService] Estimated total fee:', totalFee, 'XRP');

        return {
          fee: totalFee,
          estimatedTime,
          minimumAmount,
        };
      }
    } catch (error) {
      console.warn('[AxelarBridgeService] Fee estimation failed, using static calculation:', error);
    }

    // Fallback to static fee calculation
    return {
      fee: calculateFee(amount),
      estimatedTime,
      minimumAmount,
    };
  }

  /**
   * Get bridge configuration including environment-specific addresses
   */
  getConfig() {
    const addresses = getAddressesForEnvironment(this.axelarEnvironment);
    return {
      chainId: XRPL_EVM_CHAIN_ID,
      feePercentage: BRIDGE_CONFIG.FEE_PERCENTAGE,
      minimumAmount: BRIDGE_CONFIG.MINIMUM_AMOUNT,
      addresses, // Environment-specific addresses
      allAddresses: AXELAR_ADDRESSES, // Full address configuration
      axelarChainIds: AXELAR_CHAIN_IDS,
      axelarEnvironment: this.axelarEnvironment,
      demoMode: this.demoMode,
    };
  }

  /**
   * Get the ITS contract address for the current environment
   */
  getITSContractAddress(): string {
    return getAddressesForEnvironment(this.axelarEnvironment).ITS_CONTRACT;
  }

  /**
   * Get the Axelar chain identifier for a given direction
   */
  getAxelarChainId(direction: BridgeDirection): { from: string; to: string } {
    if (direction === 'toEVM') {
      return {
        from: AXELAR_CHAIN_IDS.XRPL,
        to: AXELAR_CHAIN_IDS.XRPL_EVM,
      };
    }
    return {
      from: AXELAR_CHAIN_IDS.XRPL_EVM,
      to: AXELAR_CHAIN_IDS.XRPL,
    };
  }

  /**
   * Check if an address is valid for a given direction
   */
  validateAddress(address: string, type: 'xrpl' | 'evm'): boolean {
    if (type === 'xrpl') {
      return isValidXRPLAddress(address);
    }
    return isValidEVMAddress(address);
  }

  /**
   * Get a transaction by hash from the current mode's store
   */
  getTransaction(txHash: string): BridgeTransaction | undefined {
    return this.getStore().get(txHash);
  }

  /**
   * Get all pending transactions from the current mode's store
   */
  getPendingTransactions(): BridgeTransaction[] {
    return Array.from(this.getStore().values()).filter(
      (tx) => tx.status === 'pending' || tx.status === 'confirming'
    );
  }

  /**
   * Get all transactions from the current mode's store
   */
  getAllTransactions(): BridgeTransaction[] {
    return Array.from(this.getStore().values());
  }

  /**
   * Cleanup resources (stop all polling intervals and optionally clear stores)
   *
   * This method ensures proper cleanup of:
   * - All active polling intervals (prevents memory leaks)
   * - Transaction stores (optional, for full reset)
   *
   * @param clearStores - If true, also clears all transaction stores (default: false)
   */
  cleanup(clearStores: boolean = false): void {
    // Clear all polling intervals to prevent memory leaks
    const intervalCount = this.pollingIntervals.size;

    for (const [, interval] of this.pollingIntervals.entries()) {
      clearInterval(interval);
    }

    // Clear the intervals map after iterating
    this.pollingIntervals.clear();

    if (intervalCount > 0) {
      console.log(`[AxelarBridgeService] Cleaned up ${intervalCount} polling interval(s)`);
    }

    // Optionally clear transaction stores
    if (clearStores) {
      this.clearAllTransactions();
    }
  }

  /**
   * Dispose the service - full cleanup including stores
   * Call this when the service is being permanently destroyed
   */
  dispose(): void {
    this.cleanup(true);
    console.log('[AxelarBridgeService] Service disposed');
  }

  /**
   * Clear transactions from the current mode's store
   * Used for testing to reset state between tests
   */
  clearTransactions(): void {
    this.getStore().clear();
  }

  /**
   * Clear all transactions from both demo and real stores
   * Use with caution - this clears all transaction history
   */
  clearAllTransactions(): void {
    demoTransactions.clear();
    realTransactions.clear();
    console.log('[AxelarBridgeService] All transaction stores cleared');
  }

  /**
   * Get the count of active polling intervals
   * Useful for debugging and testing
   */
  getActivePollingCount(): number {
    return this.pollingIntervals.size;
  }

  // ===========================================================================
  // Private Methods
  // ===========================================================================

  /**
   * Start real status polling for a transaction
   */
  private startStatusPolling(txHash: string): void {
    const store = this.getStore();
    const interval = setInterval(async () => {
      const tx = store.get(txHash);
      if (!tx) {
        clearInterval(interval);
        this.pollingIntervals.delete(txHash);
        return;
      }

      // Check if terminal state
      if (tx.status === 'complete' || tx.status === 'failed') {
        clearInterval(interval);
        this.pollingIntervals.delete(txHash);
        return;
      }

      // Query Axelar for status update
      try {
        const axelarStatus = await this.queryAxelarStatus(txHash);
        if (axelarStatus) {
          const mappedStatus = mapAxelarStatusToBridgeStatus(axelarStatus.status);
          tx.axelarStatus = axelarStatus.status;
          tx.status = mappedStatus;

          if (mappedStatus === 'complete') {
            tx.completedAt = Date.now();
            tx.confirmations = BRIDGE_CONFIG.REQUIRED_CONFIRMATIONS[tx.direction];
          } else if (mappedStatus === 'confirming') {
            // Estimate confirmations based on status
            tx.confirmations = Math.ceil(
              BRIDGE_CONFIG.REQUIRED_CONFIRMATIONS[tx.direction] / 2
            );
          }

          store.set(txHash, tx);
        }
      } catch (error) {
        console.warn('[AxelarBridgeService] Status poll failed:', error);
      }
    }, BRIDGE_CONFIG.STATUS_POLL_INTERVAL);

    this.pollingIntervals.set(txHash, interval);
  }

  /**
   * Simulate confirmation progress for mock transactions
   */
  private simulateConfirmations(txHash: string, direction: BridgeDirection): void {
    const requiredConfirmations = BRIDGE_CONFIG.REQUIRED_CONFIRMATIONS[direction];
    const intervalMs = BRIDGE_CONFIG.MOCK.CONFIRMATION_INTERVAL_MS;
    const store = this.getStore();

    const interval = setInterval(() => {
      const tx = store.get(txHash);
      if (!tx) {
        clearInterval(interval);
        this.pollingIntervals.delete(txHash);
        return;
      }

      // Increment confirmations
      tx.confirmations += 1;

      // Update status based on confirmations
      if (tx.confirmations >= requiredConfirmations / 2 && tx.status === 'pending') {
        tx.status = 'confirming';
      }

      if (tx.confirmations >= requiredConfirmations) {
        tx.status = 'complete';
        tx.completedAt = Date.now();
        clearInterval(interval);
        this.pollingIntervals.delete(txHash);
      }

      store.set(txHash, tx);
    }, intervalMs);

    this.pollingIntervals.set(txHash, interval);
  }
}

// =============================================================================
// Export
// =============================================================================

// Export singleton instance
export const axelarBridgeService = new AxelarBridgeService();

// Export class for testing
export { AxelarBridgeService };

// Export utility functions for testing
export const bridgeUtils = {
  isValidXRPLAddress,
  isValidEVMAddress,
  calculateFee,
  generateMockTxHash,
  mapAxelarStatusToBridgeStatus,
  getAxelarscanUrl,
  isTBDAddress,
  validateAddressesForRealMode,
  getAddressesForEnvironment,
  getTransactionStore,
};

// Export constants
export { AXELAR_API, BRIDGE_CONFIG, AXELAR_ADDRESSES, AXELAR_ADDRESSES_LEGACY };
