/**
 * Squid Router Bridge Service
 *
 * Provides cross-chain transfers using Squid Router API v2.
 *
 * IMPORTANT LIMITATION (as of 2026-01-30):
 * The Squid v2 public API does NOT currently support:
 * - XRPL EVM (chain ID 1440000) as source or destination
 * - XRPL mainnet as source or destination
 *
 * The bridge.xrplevm.org uses a custom/private Squid integration.
 * For XRPL EVM <-> XRPL bridging, use the Axelar ITS directly via
 * the axelarBridgeService (interchainTransfer method).
 *
 * This service can be used for:
 * - Cross-chain swaps between supported EVM chains (Ethereum, Arbitrum, Polygon, etc.)
 * - Future XRPL integration when Squid adds public support
 *
 * API Documentation: https://docs.squidrouter.com
 * Supported chains: ~91 chains (EVM + Cosmos + Sui), NOT including XRPL EVM
 *
 * Key Contracts (reference only - on unsupported XRPL EVM):
 * - SquidRouterProxy: 0xce16F69375520ab01377ce7B88f5BA8C48F8D666
 * - SquidRouter impl: 0xDC74A55C7F58a02FC3c25888790E6Ec6BCcB43D6
 *
 * @see https://docs.squidrouter.com/api-and-sdk-integration/key-concepts/get-supported-tokens-and-chains
 */

import { parseUnits, formatUnits, type TransactionResponse } from 'ethers';
import { evmSignerService, type EVMSignerService } from '@services/evm/signer';

// =============================================================================
// Types & Interfaces
// =============================================================================

export interface SquidRouteParams {
  /** Source chain ID */
  fromChain: string | number;
  /** Destination chain ID */
  toChain: string | number;
  /** Token address on source chain (use NATIVE_TOKEN_ADDRESS for native) */
  fromToken: string;
  /** Token address on destination chain */
  toToken: string;
  /** Amount in smallest unit (wei for EVM) */
  fromAmount: string;
  /** Sender address */
  fromAddress: string;
  /** Recipient address */
  toAddress: string;
  /** Slippage tolerance (1 = 1%) */
  slippage?: number;
  /** Only get quote without transaction data */
  quoteOnly?: boolean;
}

export interface SquidRouteResponse {
  /** Route details */
  route: {
    /** Estimated output amount */
    estimate: {
      fromAmount: string;
      toAmount: string;
      toAmountMin: string;
      toAmountUSD: string;
      fromAmountUSD: string;
      feeCosts: Array<{
        amount: string;
        amountUSD: string;
        description: string;
        name: string;
        token: {
          symbol: string;
          address: string;
          chainId: string;
        };
      }>;
      gasCosts: Array<{
        amount: string;
        amountUSD: string;
        token: {
          symbol: string;
          address: string;
          chainId: string;
        };
      }>;
      estimatedRouteDuration: number;
      exchangeRate: string;
      aggregatePriceImpact: string;
    };
    /** Transaction data for execution */
    transactionRequest?: {
      target: string;
      data: string;
      value: string;
      gasLimit: string;
      gasPrice: string;
    };
    params: SquidRouteParams;
  };
  /** Request ID for status tracking */
  requestId: string;
}

export interface SquidStatusParams {
  /** Transaction hash */
  transactionId: string;
  /** Request ID from route response */
  requestId: string;
  /** Source chain ID */
  fromChainId: string | number;
  /** Destination chain ID */
  toChainId: string | number;
}

export type SquidTransactionStatus =
  | 'SUCCESS'
  | 'NEEDS_GAS'
  | 'ONGOING'
  | 'PARTIAL_SUCCESS'
  | 'NOT_FOUND';

export interface SquidStatusResponse {
  /** Transaction ID */
  id: string;
  /** Overall status */
  status: SquidTransactionStatus;
  /** Detailed status info */
  squidTransactionStatus: SquidTransactionStatus;
  /** Route type */
  routeType: string[];
  /** Error message if any */
  error?: {
    message: string;
    errorType: string;
  };
  /** Source chain transaction */
  fromChain?: {
    transactionId: string;
    chainId: string;
    blockNumber: number;
    transactionUrl: string;
  };
  /** Destination chain transaction */
  toChain?: {
    transactionId: string;
    chainId: string;
    blockNumber: number;
    transactionUrl: string;
  };
}

export interface SquidBridgeResult {
  success: boolean;
  txHash: string | null;
  requestId?: string;
  error?: string;
  route?: SquidRouteResponse['route'];
}

export interface SquidServiceConfig {
  /** Squid API integrator ID */
  integratorId: string;
  /** EVM signer service */
  evmSignerService?: EVMSignerService;
  /** Enable debug logging */
  debug?: boolean;
}

// =============================================================================
// Constants
// =============================================================================

/**
 * Squid Router API endpoints
 */
export const SQUID_API = {
  /** Base URL for Squid API v2 */
  BASE_URL: 'https://v2.api.squidrouter.com',
  /** Alternative URL (sometimes more reliable) */
  ALT_URL: 'https://apiplus.squidrouter.com',
  /** Route endpoint */
  ROUTE: '/v2/route',
  /** Status endpoint */
  STATUS: '/v2/status',
  /** Chains endpoint */
  CHAINS: '/v2/chains',
  /** Tokens endpoint */
  TOKENS: '/v2/tokens',
} as const;

/**
 * Native token address (used by Squid for native assets)
 */
export const NATIVE_TOKEN_ADDRESS = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE';

/**
 * Squid chain identifiers
 * Note: Squid uses string identifiers for non-EVM chains
 */
export const SQUID_CHAIN_IDS = {
  /** XRPL EVM Mainnet */
  XRPL_EVM: '1440000',
  /** XRPL (non-EVM) - uses special format */
  XRPL: 'xrpl',
  /** Ethereum mainnet */
  ETHEREUM: '1',
  /** Arbitrum */
  ARBITRUM: '42161',
  /** Polygon */
  POLYGON: '137',
  /** Avalanche */
  AVALANCHE: '43114',
} as const;

/**
 * Default Squid configuration
 */
const SQUID_CONFIG = {
  /** Default slippage tolerance (1%) */
  DEFAULT_SLIPPAGE: 1,
  /** Status polling interval (ms) */
  STATUS_POLL_INTERVAL: 5000,
  /** Maximum status poll attempts */
  MAX_POLL_ATTEMPTS: 60,
  /** Request timeout (ms) */
  REQUEST_TIMEOUT: 30000,
} as const;

/**
 * Contract addresses on XRPL EVM Mainnet
 */
export const SQUID_CONTRACTS = {
  /** SquidRouterProxy on XRPL EVM */
  ROUTER_PROXY: '0xce16F69375520ab01377ce7B88f5BA8C48F8D666',
  /** SquidRouter implementation */
  ROUTER_IMPL: '0xDC74A55C7F58a02FC3c25888790E6Ec6BCcB43D6',
} as const;

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Validate EVM address format
 */
const isValidEVMAddress = (address: string): boolean => {
  return /^0x[a-fA-F0-9]{40}$/.test(address);
};

/**
 * Validate XRPL address format
 */
const isValidXRPLAddress = (address: string): boolean => {
  return /^r[1-9A-HJ-NP-Za-km-z]{24,34}$/.test(address);
};

/**
 * Format amount from wei to human readable
 */
const formatAmount = (amount: string, decimals: number = 18): string => {
  return formatUnits(amount, decimals);
};

// =============================================================================
// SquidRouterService Class
// =============================================================================

class SquidRouterService {
  private integratorId: string;
  private evmSigner: EVMSignerService | null;
  private debug: boolean;
  private baseUrl: string;

  constructor(config?: Partial<SquidServiceConfig>) {
    // Use a test integrator ID if none provided
    // In production, you should apply for one at https://docs.squidrouter.com
    this.integratorId = config?.integratorId || 'squid-swap-widget';
    this.evmSigner = config?.evmSignerService ?? evmSignerService;
    this.debug = config?.debug ?? false;
    this.baseUrl = SQUID_API.BASE_URL;
  }

  /**
   * Set the integrator ID
   */
  setIntegratorId(id: string): void {
    this.integratorId = id;
  }

  /**
   * Set the EVM signer service
   */
  setEVMSignerService(service: EVMSignerService): void {
    this.evmSigner = service;
  }

  /**
   * Toggle debug mode
   */
  setDebugMode(enabled: boolean): void {
    this.debug = enabled;
  }

  /**
   * Log message if debug mode is enabled
   */
  private log(...args: unknown[]): void {
    if (this.debug) {
      console.log('[SquidRouter]', ...args);
    }
  }

  /**
   * Make API request to Squid
   */
  private async apiRequest<T>(
    method: 'GET' | 'POST',
    endpoint: string,
    data?: unknown
  ): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;

    this.log(`${method} ${url}`);
    if (data) {
      this.log('Request body:', JSON.stringify(data, null, 2));
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(
      () => controller.abort(),
      SQUID_CONFIG.REQUEST_TIMEOUT
    );

    try {
      const options: RequestInit = {
        method,
        headers: {
          'x-integrator-id': this.integratorId,
          'Content-Type': 'application/json',
        },
        signal: controller.signal,
      };

      if (method === 'POST' && data) {
        options.body = JSON.stringify(data);
      }

      const response = await fetch(url, options);

      if (!response.ok) {
        const errorText = await response.text();
        this.log('API error:', response.status, errorText);
        throw new Error(`Squid API error (${response.status}): ${errorText}`);
      }

      const responseData = await response.json();
      const requestId = response.headers.get('x-request-id');

      this.log('Response received, requestId:', requestId);

      // Attach requestId to response if available
      if (requestId && typeof responseData === 'object') {
        responseData.requestId = requestId;
      }

      return responseData as T;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Get a route for cross-chain transfer
   *
   * @param params - Route parameters
   * @returns Route response with transaction data
   */
  async getRoute(params: SquidRouteParams): Promise<SquidRouteResponse> {
    this.log('Getting route:', params);

    // Validate addresses based on chain type
    const fromChainStr = String(params.fromChain);
    const toChainStr = String(params.toChain);

    // Validate source address
    if (fromChainStr === SQUID_CHAIN_IDS.XRPL) {
      if (!isValidXRPLAddress(params.fromAddress)) {
        throw new Error('Invalid XRPL source address');
      }
    } else {
      if (!isValidEVMAddress(params.fromAddress)) {
        throw new Error('Invalid EVM source address');
      }
    }

    // Validate destination address
    if (toChainStr === SQUID_CHAIN_IDS.XRPL) {
      if (!isValidXRPLAddress(params.toAddress)) {
        throw new Error('Invalid XRPL destination address');
      }
    } else {
      if (!isValidEVMAddress(params.toAddress)) {
        throw new Error('Invalid EVM destination address');
      }
    }

    const requestBody = {
      fromChain: fromChainStr,
      toChain: toChainStr,
      fromToken: params.fromToken,
      toToken: params.toToken,
      fromAmount: params.fromAmount,
      fromAddress: params.fromAddress,
      toAddress: params.toAddress,
      slippage: params.slippage ?? SQUID_CONFIG.DEFAULT_SLIPPAGE,
      slippageConfig: {
        autoMode: 1, // Use auto slippage
      },
      quoteOnly: params.quoteOnly ?? false,
    };

    return this.apiRequest<SquidRouteResponse>('POST', SQUID_API.ROUTE, requestBody);
  }

  /**
   * Execute a bridge transaction using the route data
   *
   * @param route - Route response from getRoute
   * @returns Bridge result with transaction hash
   */
  async executeBridge(route: SquidRouteResponse): Promise<SquidBridgeResult> {
    this.log('Executing bridge...');

    // Verify we have transaction data
    if (!route.route.transactionRequest) {
      return {
        success: false,
        txHash: null,
        error: 'No transaction data in route (quoteOnly mode?)',
      };
    }

    // Check signer availability
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

    try {
      const txRequest = route.route.transactionRequest;

      this.log('Sending transaction to:', txRequest.target);
      this.log('Value:', txRequest.value);
      this.log('Gas limit:', txRequest.gasLimit);

      // Send the transaction
      const txResponse: TransactionResponse = await this.evmSigner.sendTransaction({
        to: txRequest.target,
        data: txRequest.data,
        value: BigInt(txRequest.value),
        gasLimit: BigInt(txRequest.gasLimit),
        gasPrice: txRequest.gasPrice ? BigInt(txRequest.gasPrice) : undefined,
      });

      this.log('Transaction submitted:', txResponse.hash);

      // Wait for confirmation
      this.log('Waiting for confirmation...');
      const receipt = await txResponse.wait();

      if (receipt && receipt.status === 1) {
        this.log('Transaction confirmed in block:', receipt.blockNumber);
        return {
          success: true,
          txHash: txResponse.hash,
          requestId: route.requestId,
          route: route.route,
        };
      } else {
        return {
          success: false,
          txHash: txResponse.hash,
          error: 'Transaction reverted',
        };
      }
    } catch (error) {
      this.log('Bridge execution failed:', error);
      return {
        success: false,
        txHash: null,
        error: error instanceof Error ? error.message : 'Bridge execution failed',
      };
    }
  }

  /**
   * Get the status of a bridge transaction
   *
   * @param params - Status parameters
   * @returns Transaction status
   */
  async getStatus(params: SquidStatusParams): Promise<SquidStatusResponse> {
    this.log('Getting status for:', params.transactionId);

    const queryParams = new URLSearchParams({
      transactionId: params.transactionId,
      requestId: params.requestId,
      fromChainId: String(params.fromChainId),
      toChainId: String(params.toChainId),
    });

    const endpoint = `${SQUID_API.STATUS}?${queryParams.toString()}`;

    return this.apiRequest<SquidStatusResponse>('GET', endpoint);
  }

  /**
   * Poll for transaction status until complete or timeout
   *
   * @param params - Status parameters
   * @param onUpdate - Callback for status updates
   * @returns Final status
   */
  async waitForCompletion(
    params: SquidStatusParams,
    onUpdate?: (status: SquidStatusResponse) => void
  ): Promise<SquidStatusResponse> {
    this.log('Waiting for completion:', params.transactionId);

    let attempts = 0;
    const maxAttempts = SQUID_CONFIG.MAX_POLL_ATTEMPTS;

    while (attempts < maxAttempts) {
      attempts++;

      try {
        const status = await this.getStatus(params);

        this.log(`Status (attempt ${attempts}):`, status.squidTransactionStatus);

        if (onUpdate) {
          onUpdate(status);
        }

        // Check for terminal states
        if (status.squidTransactionStatus === 'SUCCESS') {
          this.log('Transaction completed successfully');
          return status;
        }

        if (
          status.squidTransactionStatus === 'NEEDS_GAS' ||
          status.squidTransactionStatus === 'PARTIAL_SUCCESS'
        ) {
          this.log('Transaction needs attention:', status.squidTransactionStatus);
          return status;
        }

        // NOT_FOUND is expected initially, continue polling
        if (
          status.squidTransactionStatus === 'NOT_FOUND' ||
          status.squidTransactionStatus === 'ONGOING'
        ) {
          await this.delay(SQUID_CONFIG.STATUS_POLL_INTERVAL);
          continue;
        }
      } catch (error) {
        this.log('Status check error:', error);
        // Continue polling on error
      }

      await this.delay(SQUID_CONFIG.STATUS_POLL_INTERVAL);
    }

    throw new Error(`Timeout waiting for transaction completion after ${maxAttempts} attempts`);
  }

  /**
   * Helper delay function
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Get supported chains from Squid API
   */
  async getChains(): Promise<unknown> {
    return this.apiRequest('GET', SQUID_API.CHAINS);
  }

  /**
   * Get supported tokens from Squid API
   */
  async getTokens(): Promise<unknown> {
    return this.apiRequest('GET', SQUID_API.TOKENS);
  }

  /**
   * Bridge XRP from XRPL EVM to XRPL mainnet
   *
   * Convenience method for the most common use case in Veil.
   *
   * @param amount - Amount in XRP (e.g., "1.5")
   * @param fromAddress - EVM address on XRPL EVM sidechain
   * @param toAddress - XRPL address on mainnet
   */
  async bridgeToXRPL(
    amount: string,
    fromAddress: string,
    toAddress: string
  ): Promise<SquidBridgeResult> {
    this.log('Bridge to XRPL:', amount, 'XRP');

    // Validate addresses
    if (!isValidEVMAddress(fromAddress)) {
      return {
        success: false,
        txHash: null,
        error: 'Invalid EVM address format',
      };
    }

    if (!isValidXRPLAddress(toAddress)) {
      return {
        success: false,
        txHash: null,
        error: 'Invalid XRPL address format',
      };
    }

    try {
      // Convert amount to wei
      const amountWei = parseUnits(amount, 18).toString();

      // Get route
      const routeParams: SquidRouteParams = {
        fromChain: SQUID_CHAIN_IDS.XRPL_EVM,
        toChain: SQUID_CHAIN_IDS.XRPL,
        fromToken: NATIVE_TOKEN_ADDRESS,
        toToken: NATIVE_TOKEN_ADDRESS,
        fromAmount: amountWei,
        fromAddress,
        toAddress,
        slippage: 1,
      };

      const route = await this.getRoute(routeParams);

      // Execute bridge
      return this.executeBridge(route);
    } catch (error) {
      this.log('bridgeToXRPL failed:', error);
      return {
        success: false,
        txHash: null,
        error: error instanceof Error ? error.message : 'Bridge failed',
      };
    }
  }

  /**
   * Get a quote for bridging (without executing)
   *
   * @param amount - Amount in XRP
   * @param fromChain - Source chain
   * @param toChain - Destination chain
   * @param fromAddress - Source address
   * @param toAddress - Destination address
   */
  async getQuote(
    amount: string,
    fromChain: string,
    toChain: string,
    fromAddress: string,
    toAddress: string
  ): Promise<{
    fromAmount: string;
    toAmount: string;
    toAmountMin: string;
    estimatedTime: number;
    fees: string;
  }> {
    const amountWei = parseUnits(amount, 18).toString();

    const route = await this.getRoute({
      fromChain,
      toChain,
      fromToken: NATIVE_TOKEN_ADDRESS,
      toToken: NATIVE_TOKEN_ADDRESS,
      fromAmount: amountWei,
      fromAddress,
      toAddress,
      quoteOnly: true,
    });

    const estimate = route.route.estimate;

    // Calculate total fees
    const totalFees = estimate.feeCosts.reduce(
      (sum, fee) => sum + parseFloat(fee.amountUSD || '0'),
      0
    );

    return {
      fromAmount: formatAmount(estimate.fromAmount),
      toAmount: formatAmount(estimate.toAmount),
      toAmountMin: formatAmount(estimate.toAmountMin),
      estimatedTime: estimate.estimatedRouteDuration,
      fees: totalFees.toFixed(2),
    };
  }

  /**
   * Get configuration info
   */
  getConfig() {
    return {
      integratorId: this.integratorId,
      baseUrl: this.baseUrl,
      chainIds: SQUID_CHAIN_IDS,
      contracts: SQUID_CONTRACTS,
      debug: this.debug,
    };
  }
}

// =============================================================================
// Export
// =============================================================================

// Export singleton instance
export const squidRouterService = new SquidRouterService();

// Export class for testing
export { SquidRouterService };
