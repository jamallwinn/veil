/**
 * Axelar USDC Bridge Service
 *
 * Provides integration with Axelar ITS for USDC cross-chain transfers between
 * XRPL Mainnet and XRPL EVM Sidechain.
 *
 * Key Differences from XRP Bridge:
 * - Uses USDC.xrpl token (ERC-20) instead of native XRP
 * - Requires ERC-20 approval before ITS calls
 * - Uses specific USDC Token ID for ITS interchainTransfer
 * - 15 decimals on EVM (vs 6 on native XRPL)
 *
 * Implementation Status:
 * - Demo mode: Full mock implementation for development/testing
 * - Real mode: Full integration with Axelar ITS for USDC
 *
 * @see https://docs.axelar.dev/dev/axelarjs-sdk/intro
 * @see https://docs.xrplevm.org/pages/bridge/interchain-transfer
 */

import { type EVMProviderService } from '@services/evm/provider';
import { type GemWalletService } from '@services/gemwallet';
import {
  evmSignerService,
  type EVMSignerService,
} from '@services/evm/signer';
import { parseUnits, Contract, type TransactionResponse } from 'ethers';
import {
  AxelarQueryAPI,
  Environment,
} from '@axelar-network/axelarjs-sdk';
import {
  AxelarRecoveryApi,
  GMPStatus,
  type GMPStatusResponse,
} from '@axelar-network/axelarjs-sdk/dist/src/libs/TransactionRecoveryApi/AxelarRecoveryApi';

import {
  USDC_TOKEN_ID,
  USDC_DECIMALS,
  USDC_MINIMUM_BRIDGE_AMOUNT,
  USDC_BRIDGE_FEE_PERCENTAGE,
  USDC_ERC20_ABI,
  USDC_NETWORK_CONFIG,
} from '@constants/usdc';

// =============================================================================
// Types & Interfaces
// =============================================================================

export type USDCBridgeDirection = 'toEVM' | 'toXRPL';

export type USDCBridgeStatusType = 'pending' | 'confirming' | 'complete' | 'failed';

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

export interface USDCBridgeResult {
  success: boolean;
  txHash: string | null;
  depositAddress?: string;
  error?: string;
}

export interface USDCBridgeStatus {
  status: USDCBridgeStatusType;
  confirmations: number;
  requiredConfirmations: number;
  estimatedTimeRemaining?: number;
  axelarStatus?: AxelarGMPStatus;
  axelarScanUrl?: string;
}

export interface USDCBridgeEstimate {
  fee: string; // Fee in USDC
  estimatedTime: number; // seconds
  minimumAmount: string; // Minimum USDC amount
}

export interface USDCBridgeTransaction {
  id: string;
  direction: USDCBridgeDirection;
  amount: string;
  fromAddress: string;
  toAddress: string;
  status: USDCBridgeStatusType;
  txHash: string;
  depositAddress?: string;
  startedAt: number;
  completedAt?: number;
  confirmations: number;
  axelarStatus?: AxelarGMPStatus;
}

export interface USDCBridgeServiceConfig {
  evmProvider?: EVMProviderService;
  gemWalletService?: GemWalletService;
  evmSignerService?: EVMSignerService;
  demoMode?: boolean;
  axelarEnvironment?: 'mainnet' | 'testnet';
}

// =============================================================================
// Constants
// =============================================================================

const AXELAR_CHAIN_IDS = {
  XRPL: 'xrpl',
  XRPL_EVM: 'xrpl-evm',
} as const;

// Axelar ITS deposit address on XRPL for bridging to EVM
const AXELAR_XRPL_BRIDGE = 'rfmS3zqrQrka8wVyhXifEeyTwe8AMz2Yhw';

const AXELAR_API = {
  MAINNET: 'https://api.axelarscan.io',
  TESTNET: 'https://testnet.api.axelarscan.io',
  AXELARSCAN_MAINNET: 'https://axelarscan.io',
  AXELARSCAN_TESTNET: 'https://testnet.axelarscan.io',
} as const;

const BRIDGE_CONFIG = {
  FEE_PERCENTAGE: USDC_BRIDGE_FEE_PERCENTAGE,
  MINIMUM_AMOUNT: USDC_MINIMUM_BRIDGE_AMOUNT,
  REQUIRED_CONFIRMATIONS: {
    toEVM: 6,
    toXRPL: 12,
  },
  ESTIMATED_TIME: {
    toEVM: 25,
    toXRPL: 30,
  },
  MOCK: {
    CONFIRMATION_INTERVAL_MS: 2000,
    FAILURE_RATE: 0.02,
  },
  STATUS_POLL_INTERVAL: 3000,
};

// ITS ABI for interchain transfers
const ITS_ABI = [
  'function interchainTransfer(bytes32 tokenId, string destinationChain, bytes destinationAddress, uint256 amount, bytes metadata, uint256 gasValue) external payable',
  'function interchainTokenId(address operator, bytes32 salt) external view returns (bytes32)',
];

// =============================================================================
// Transaction Stores
// =============================================================================

const demoTransactions = new Map<string, USDCBridgeTransaction>();
const realTransactions = new Map<string, USDCBridgeTransaction>();

const getTransactionStore = (demoMode: boolean): Map<string, USDCBridgeTransaction> => {
  return demoMode ? demoTransactions : realTransactions;
};

// =============================================================================
// Utility Functions
// =============================================================================

const generateMockTxHash = (direction: USDCBridgeDirection): string => {
  const prefix = direction === 'toEVM' ? '0x' : '';
  const randomPart = Math.random().toString(36).substring(2, 15) +
    Math.random().toString(36).substring(2, 15);
  return `${prefix}${randomPart.toUpperCase().padEnd(64, '0')}`;
};

const generateBridgeId = (): string => {
  return `USDC-BRG-${Date.now()}-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
};

const calculateFee = (amount: string): string => {
  const amountNum = parseFloat(amount);
  if (isNaN(amountNum) || amountNum <= 0) {
    return '0';
  }
  const fee = amountNum * BRIDGE_CONFIG.FEE_PERCENTAGE;
  return fee.toFixed(6);
};

const isValidXRPLAddress = (address: string): boolean => {
  const xrplAddressRegex = /^r[1-9A-HJ-NP-Za-km-z]{24,34}$/;
  return xrplAddressRegex.test(address);
};

const isValidEVMAddress = (address: string): boolean => {
  const evmAddressRegex = /^0x[a-fA-F0-9]{40}$/;
  return evmAddressRegex.test(address);
};

const simulateDelay = (baseMs: number, varianceMs: number = 500): Promise<void> => {
  const delay = baseMs + Math.random() * varianceMs;
  return new Promise((resolve) => setTimeout(resolve, delay));
};

const stringToHex = (str: string): string => {
  return Array.from(new TextEncoder().encode(str))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
};

const mapAxelarStatusToBridgeStatus = (axelarStatus: AxelarGMPStatus): USDCBridgeStatusType => {
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
    case 'error':
    case 'unknown_error':
    case 'insufficient_fee':
      return 'failed';
    case 'cannot_fetch_status':
      return 'pending';
    default:
      return 'pending';
  }
};

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
// AxelarUSDCBridgeService Class
// =============================================================================

class AxelarUSDCBridgeService {
  private pollingIntervals: Map<string, NodeJS.Timeout> = new Map();
  private evmProvider: EVMProviderService | null = null;
  private gemWalletService: GemWalletService | null = null;
  private evmSigner: EVMSignerService | null = null;
  private demoMode: boolean = true;
  private axelarEnvironment: 'mainnet' | 'testnet' = 'mainnet';

  constructor(config?: USDCBridgeServiceConfig) {
    this.evmProvider = config?.evmProvider ?? null;
    this.gemWalletService = config?.gemWalletService ?? null;
    this.evmSigner = config?.evmSignerService ?? evmSignerService;
    this.demoMode = config?.demoMode ?? true;
    this.axelarEnvironment = config?.axelarEnvironment ?? 'mainnet';
  }

  // ===========================================================================
  // Configuration Methods
  // ===========================================================================

  setEVMProvider(provider: EVMProviderService): void {
    this.evmProvider = provider;
  }

  setGemWalletService(service: GemWalletService): void {
    this.gemWalletService = service;
  }

  setEVMSignerService(service: EVMSignerService): void {
    this.evmSigner = service;
  }

  isDemoMode(): boolean {
    return this.demoMode;
  }

  setDemoMode(enabled: boolean): void {
    if (!enabled) {
      if (!this.evmProvider) {
        console.warn('[AxelarUSDCBridgeService] Disabling demo mode without EVM provider');
      }
      if (!this.evmSigner) {
        console.warn('[AxelarUSDCBridgeService] Disabling demo mode without EVM signer');
      }
    }
    this.demoMode = enabled;
  }

  private getStore(): Map<string, USDCBridgeTransaction> {
    return getTransactionStore(this.demoMode);
  }

  setAxelarEnvironment(environment: 'mainnet' | 'testnet'): void {
    this.axelarEnvironment = environment;
  }

  // ===========================================================================
  // Connection Checks
  // ===========================================================================

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

  // ===========================================================================
  // Bridge Operations
  // ===========================================================================

  /**
   * Bridge USDC from XRPL Mainnet to EVM Sidechain
   *
   * Flow:
   * 1. User sends USDC to Axelar's ITS deposit address on XRPL
   * 2. Axelar validators confirm the deposit
   * 3. USDC.xrpl is minted on XRPL EVM Sidechain
   */
  async bridgeToEVM(
    amount: string,
    fromXRPLAddress: string,
    toEVMAddress: string
  ): Promise<USDCBridgeResult> {
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
          error: `Minimum bridge amount is ${BRIDGE_CONFIG.MINIMUM_AMOUNT} USDC`,
        };
      }

      // Real mode implementation
      if (!this.demoMode) {
        return await this.realBridgeUSDCToEVM(amount, fromXRPLAddress, toEVMAddress);
      }

      // Demo mode
      await simulateDelay(1000);

      if (Math.random() < BRIDGE_CONFIG.MOCK.FAILURE_RATE) {
        return {
          success: false,
          txHash: null,
          error: 'Bridge transaction failed: Network congestion',
        };
      }

      const txHash = generateMockTxHash('toEVM');
      const bridgeId = generateBridgeId();
      const mockDepositAddress = `rMock${Math.random().toString(36).substring(2, 12).toUpperCase()}`;

      const bridgeTx: USDCBridgeTransaction = {
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
      this.simulateConfirmations(txHash, 'toEVM');

      return {
        success: true,
        txHash,
        depositAddress: mockDepositAddress,
      };
    } catch (error) {
      console.error('[AxelarUSDCBridgeService] bridgeToEVM failed:', error);
      return {
        success: false,
        txHash: null,
        error: error instanceof Error ? error.message : 'Unknown error occurred',
      };
    }
  }

  /**
   * Real USDC bridge to EVM using GemWallet for XRPL payment
   */
  private async realBridgeUSDCToEVM(
    amount: string,
    fromXRPLAddress: string,
    toEVMAddress: string
  ): Promise<USDCBridgeResult> {
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
      // For USDC bridging via ITS, the user needs to send USDC to Axelar's bridge
      // The memo contains destination chain and address info
      console.log('[AxelarUSDCBridgeService] Sending USDC via ITS...');
      console.log('[AxelarUSDCBridgeService] Destination EVM address:', toEVMAddress);
      console.log('[AxelarUSDCBridgeService] Axelar bridge address:', AXELAR_XRPL_BRIDGE);

      const rawEVMAddress = toEVMAddress.startsWith('0x')
        ? toEVMAddress.slice(2).toLowerCase()
        : toEVMAddress.toLowerCase();

      // Gas fee amount in USDC (same token being transferred)
      // Per Axelar docs: "gas fee is denominated in the same token being transferred"
      // Using 0.2 USDC (~$0.20) as gas allocation for EVM execution
      const gasFeeUSDC = '0.2';

      // Send USDC payment with ITS memo format (4 required memos)
      // Per https://github.com/axelarnetwork/axelar-contract-deployments/blob/main/xrpl/README.md
      const paymentResult = await this.gemWalletService.sendUSDCPayment({
        amount: amount,
        destination: AXELAR_XRPL_BRIDGE, // Axelar ITS deposit address on XRPL
        memos: [
          {
            memo: {
              // Memo 1: Type (required)
              memoType: stringToHex('type'),
              memoData: stringToHex('interchain_transfer'),
            },
          },
          {
            memo: {
              // Memo 2: Destination chain (required)
              memoType: stringToHex('destination_chain'),
              memoData: stringToHex('xrpl-evm'),
            },
          },
          {
            memo: {
              // Memo 3: Destination address (required) - without 0x prefix
              memoType: stringToHex('destination_address'),
              memoData: stringToHex(rawEVMAddress),
            },
          },
          {
            memo: {
              // Memo 4: Gas fee amount in USDC (required)
              memoType: stringToHex('gas_fee_amount'),
              memoData: stringToHex(gasFeeUSDC),
            },
          },
        ],
      });

      console.log('[AxelarUSDCBridgeService] XRPL payment submitted:', paymentResult.hash);

      const bridgeId = generateBridgeId();
      const bridgeTx: USDCBridgeTransaction = {
        id: bridgeId,
        direction: 'toEVM',
        amount,
        fromAddress: fromXRPLAddress,
        toAddress: toEVMAddress,
        status: 'pending',
        txHash: paymentResult.hash,
        startedAt: Date.now(),
        confirmations: 0,
      };

      this.getStore().set(paymentResult.hash, bridgeTx);
      this.startStatusPolling(paymentResult.hash);

      return {
        success: true,
        txHash: paymentResult.hash,
      };
    } catch (error) {
      console.error('[AxelarUSDCBridgeService] Real bridgeToEVM failed:', error);
      return {
        success: false,
        txHash: null,
        error: error instanceof Error ? error.message : 'Bridge transaction failed',
      };
    }
  }

  /**
   * Bridge USDC from EVM Sidechain back to XRPL Mainnet
   *
   * Flow:
   * 1. Approve USDC for ITS contract (ERC-20 approval)
   * 2. Call ITS interchainTransfer with USDC Token ID
   * 3. Axelar validators confirm the transfer
   * 4. USDC is released on XRPL Mainnet
   */
  async bridgeToXRPL(
    amount: string,
    fromEVMAddress: string,
    toXRPLAddress: string
  ): Promise<USDCBridgeResult> {
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
          error: `Minimum bridge amount is ${BRIDGE_CONFIG.MINIMUM_AMOUNT} USDC`,
        };
      }

      // Real mode implementation
      if (!this.demoMode) {
        return await this.realBridgeUSDCToXRPL(amount, fromEVMAddress, toXRPLAddress);
      }

      // Demo mode
      await simulateDelay(1200);

      if (Math.random() < BRIDGE_CONFIG.MOCK.FAILURE_RATE) {
        return {
          success: false,
          txHash: null,
          error: 'Bridge transaction failed: Insufficient liquidity',
        };
      }

      const txHash = generateMockTxHash('toXRPL');
      const bridgeId = generateBridgeId();

      const bridgeTx: USDCBridgeTransaction = {
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
      this.simulateConfirmations(txHash, 'toXRPL');

      return {
        success: true,
        txHash,
      };
    } catch (error) {
      console.error('[AxelarUSDCBridgeService] bridgeToXRPL failed:', error);
      return {
        success: false,
        txHash: null,
        error: error instanceof Error ? error.message : 'Unknown error occurred',
      };
    }
  }

  /**
   * Real USDC bridge to XRPL using EVM signer
   * KEY DIFFERENCE: Requires ERC-20 approval before ITS call
   */
  private async realBridgeUSDCToXRPL(
    amount: string,
    fromEVMAddress: string,
    toXRPLAddress: string
  ): Promise<USDCBridgeResult> {
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

    const signerAddress = await this.evmSigner.getAddress();
    if (signerAddress?.toLowerCase() !== fromEVMAddress.toLowerCase()) {
      return {
        success: false,
        txHash: null,
        error: `Signer address mismatch. Expected ${fromEVMAddress}, got ${signerAddress}`,
      };
    }

    try {
      console.log('[AxelarUSDCBridgeService] Initiating USDC bridge from EVM to XRPL...');

      const networkConfig = this.axelarEnvironment === 'mainnet'
        ? USDC_NETWORK_CONFIG.MAINNET
        : USDC_NETWORK_CONFIG.TESTNET;

      const itsContractAddress = networkConfig.itsContract;
      const usdcTokenAddress = networkConfig.tokenAddress;

      // Parse amount with USDC decimals (15 on EVM)
      const amountWei = parseUnits(amount, USDC_DECIMALS);

      // Step 1: Check and approve USDC for ITS contract
      console.log('[AxelarUSDCBridgeService] Checking USDC allowance...');

      const usdcContract = new Contract(
        usdcTokenAddress,
        USDC_ERC20_ABI,
        this.evmProvider.getProvider()
      ) as Contract & {
        allowance: (owner: string, spender: string) => Promise<bigint>;
        approve: (spender: string, amount: bigint) => Promise<TransactionResponse>;
      };

      const currentAllowance = await usdcContract.allowance(fromEVMAddress, itsContractAddress);
      console.log('[AxelarUSDCBridgeService] Current allowance:', currentAllowance.toString());

      if (BigInt(currentAllowance) < amountWei) {
        console.log('[AxelarUSDCBridgeService] Approving USDC for ITS...');

        const signer = await this.evmSigner.getSigner();
        if (!signer) {
          throw new Error('Failed to get EVM signer');
        }

        const usdcWithSigner = usdcContract.connect(signer) as Contract & {
          approve: (spender: string, amount: bigint) => Promise<TransactionResponse>;
        };
        const approveTx = await usdcWithSigner.approve(itsContractAddress, amountWei);
        console.log('[AxelarUSDCBridgeService] Approval tx:', approveTx.hash);

        await approveTx.wait();
        console.log('[AxelarUSDCBridgeService] Approval confirmed');
      }

      // Step 2: Call ITS interchainTransfer
      const itsContract = new Contract(
        itsContractAddress,
        ITS_ABI,
        this.evmProvider.getProvider()
      );

      // Encode destination address for cross-chain
      const destinationAddressBytes = '0x' + stringToHex(toXRPLAddress);

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
          console.log('[AxelarUSDCBridgeService] Estimated gas fee:', gasFeeEstimate);
        }
      } catch (gasError) {
        // Expected for Amplifier chains - SDK doesn't have XRPL chain configs yet
        // Using conservative default: 0.01 XRP for cross-chain gas
        console.log('[AxelarUSDCBridgeService] Using default gas value (SDK does not support XRPL chains yet)');
        gasValue = parseUnits('0.01', 18); // 0.01 XRP in wei
      }

      // Encode ITS call
      const callData = itsContract.interface.encodeFunctionData('interchainTransfer', [
        USDC_TOKEN_ID,
        AXELAR_CHAIN_IDS.XRPL,
        destinationAddressBytes,
        amountWei,
        '0x', // Empty metadata
        gasValue,
      ]);

      console.log('[AxelarUSDCBridgeService] Sending ITS transaction...');

      const gasEstimate = await this.evmProvider.getProvider().estimateGas({
        from: fromEVMAddress,
        to: itsContractAddress,
        data: callData,
        value: gasValue,
      });

      const gasLimit = (gasEstimate * BigInt(120)) / BigInt(100);

      const txResponse: TransactionResponse = await this.evmSigner.sendTransaction({
        to: itsContractAddress,
        data: callData,
        gasLimit,
        value: gasValue,
      });

      console.log('[AxelarUSDCBridgeService] Transaction submitted:', txResponse.hash);

      const bridgeId = generateBridgeId();
      const bridgeTx: USDCBridgeTransaction = {
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
      this.startStatusPolling(txResponse.hash);

      return {
        success: true,
        txHash: txResponse.hash,
      };
    } catch (error) {
      console.error('[AxelarUSDCBridgeService] Real bridgeToXRPL failed:', error);
      return {
        success: false,
        txHash: null,
        error: error instanceof Error ? error.message : 'Bridge transaction failed',
      };
    }
  }

  // ===========================================================================
  // Status Methods
  // ===========================================================================

  async getBridgeStatus(txHash: string): Promise<USDCBridgeStatus> {
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

    if (!this.demoMode) {
      try {
        const axelarStatus = await this.queryAxelarStatus(txHash);
        if (axelarStatus) {
          const mappedStatus = mapAxelarStatusToBridgeStatus(axelarStatus.status);
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
        console.warn('[AxelarUSDCBridgeService] Failed to query Axelar status:', error);
      }
    }

    const requiredConfirmations = BRIDGE_CONFIG.REQUIRED_CONFIRMATIONS[tx.direction];
    const estimatedTime = BRIDGE_CONFIG.ESTIMATED_TIME[tx.direction];

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

  private async queryAxelarStatus(txHash: string): Promise<{ status: AxelarGMPStatus } | null> {
    try {
      const recoveryApi = new AxelarRecoveryApi({
        environment: this.axelarEnvironment === 'mainnet' ? Environment.MAINNET : Environment.TESTNET,
      });

      const statusResponse: GMPStatusResponse = await recoveryApi.queryTransactionStatus(txHash);
      const mappedStatus = this.mapSDKStatusToAxelarGMPStatus(statusResponse.status as string);

      return { status: mappedStatus };
    } catch (error) {
      console.warn('[AxelarUSDCBridgeService] Status query failed:', error);
      return null;
    }
  }

  private mapSDKStatusToAxelarGMPStatus(sdkStatus: string): AxelarGMPStatus {
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

    return statusMap[sdkStatus] || 'cannot_fetch_status';
  }

  private calculateEstimatedTime(tx: USDCBridgeTransaction): number {
    if (tx.status === 'complete' || tx.status === 'failed') {
      return 0;
    }
    const estimatedTime = BRIDGE_CONFIG.ESTIMATED_TIME[tx.direction];
    const elapsed = (Date.now() - tx.startedAt) / 1000;
    return Math.max(0, Math.round(estimatedTime - elapsed));
  }

  // ===========================================================================
  // Estimation
  // ===========================================================================

  async getEstimate(amount: string, direction: USDCBridgeDirection): Promise<USDCBridgeEstimate> {
    const estimatedTime = BRIDGE_CONFIG.ESTIMATED_TIME[direction];
    const minimumAmount = BRIDGE_CONFIG.MINIMUM_AMOUNT;

    return {
      fee: calculateFee(amount),
      estimatedTime,
      minimumAmount,
    };
  }

  // ===========================================================================
  // Configuration
  // ===========================================================================

  getConfig() {
    const networkConfig = this.axelarEnvironment === 'mainnet'
      ? USDC_NETWORK_CONFIG.MAINNET
      : USDC_NETWORK_CONFIG.TESTNET;

    return {
      chainId: networkConfig.chainId,
      feePercentage: BRIDGE_CONFIG.FEE_PERCENTAGE,
      minimumAmount: BRIDGE_CONFIG.MINIMUM_AMOUNT,
      tokenAddress: networkConfig.tokenAddress,
      tokenId: USDC_TOKEN_ID,
      itsContract: networkConfig.itsContract,
      decimals: USDC_DECIMALS,
      axelarChainIds: AXELAR_CHAIN_IDS,
      axelarEnvironment: this.axelarEnvironment,
      demoMode: this.demoMode,
    };
  }

  getITSContractAddress(): string {
    const networkConfig = this.axelarEnvironment === 'mainnet'
      ? USDC_NETWORK_CONFIG.MAINNET
      : USDC_NETWORK_CONFIG.TESTNET;
    return networkConfig.itsContract;
  }

  getTokenAddress(): string {
    const networkConfig = this.axelarEnvironment === 'mainnet'
      ? USDC_NETWORK_CONFIG.MAINNET
      : USDC_NETWORK_CONFIG.TESTNET;
    return networkConfig.tokenAddress;
  }

  validateAddress(address: string, type: 'xrpl' | 'evm'): boolean {
    if (type === 'xrpl') {
      return isValidXRPLAddress(address);
    }
    return isValidEVMAddress(address);
  }

  // ===========================================================================
  // Transaction Management
  // ===========================================================================

  getTransaction(txHash: string): USDCBridgeTransaction | undefined {
    return this.getStore().get(txHash);
  }

  getPendingTransactions(): USDCBridgeTransaction[] {
    return Array.from(this.getStore().values()).filter(
      (tx) => tx.status === 'pending' || tx.status === 'confirming'
    );
  }

  getAllTransactions(): USDCBridgeTransaction[] {
    return Array.from(this.getStore().values());
  }

  // ===========================================================================
  // Cleanup
  // ===========================================================================

  cleanup(clearStores: boolean = false): void {
    for (const [, interval] of this.pollingIntervals.entries()) {
      clearInterval(interval);
    }
    this.pollingIntervals.clear();

    if (clearStores) {
      this.clearAllTransactions();
    }
  }

  dispose(): void {
    this.cleanup(true);
    console.log('[AxelarUSDCBridgeService] Service disposed');
  }

  clearTransactions(): void {
    this.getStore().clear();
  }

  clearAllTransactions(): void {
    demoTransactions.clear();
    realTransactions.clear();
  }

  getActivePollingCount(): number {
    return this.pollingIntervals.size;
  }

  // ===========================================================================
  // Private Methods
  // ===========================================================================

  private startStatusPolling(txHash: string): void {
    const store = this.getStore();
    const interval = setInterval(async () => {
      const tx = store.get(txHash);
      if (!tx || tx.status === 'complete' || tx.status === 'failed') {
        clearInterval(interval);
        this.pollingIntervals.delete(txHash);
        return;
      }

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
            tx.confirmations = Math.ceil(
              BRIDGE_CONFIG.REQUIRED_CONFIRMATIONS[tx.direction] / 2
            );
          }

          store.set(txHash, tx);
        }
      } catch (error) {
        console.warn('[AxelarUSDCBridgeService] Status poll failed:', error);
      }
    }, BRIDGE_CONFIG.STATUS_POLL_INTERVAL);

    this.pollingIntervals.set(txHash, interval);
  }

  private simulateConfirmations(txHash: string, direction: USDCBridgeDirection): void {
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

      tx.confirmations += 1;

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

export const axelarUSDCBridgeService = new AxelarUSDCBridgeService();

export { AxelarUSDCBridgeService };

export const usdcBridgeUtils = {
  isValidXRPLAddress,
  isValidEVMAddress,
  calculateFee,
  generateMockTxHash,
  mapAxelarStatusToBridgeStatus,
  getAxelarscanUrl,
  getTransactionStore,
};

export { BRIDGE_CONFIG as USDC_BRIDGE_CONFIG, AXELAR_CHAIN_IDS as USDC_AXELAR_CHAIN_IDS };
