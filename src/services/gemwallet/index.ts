/**
 * GemWallet Service
 *
 * Provides integration with the GemWallet browser extension for XRPL.
 * Handles wallet detection, connection, balance fetching, and transaction signing.
 */

import {
  isInstalled as gemIsInstalled,
  getNetwork as gemGetNetwork,
  getAddress as gemGetAddress,
  sendPayment as gemSendPayment,
} from '@gemwallet/api';

export interface SendPaymentParams {
  amount: string; // XRP amount (e.g., "5.5" for 5.5 XRP)
  destination: string; // XRPL address
  destinationTag?: number;
  memos?: Array<{
    memo: {
      memoType?: string;
      memoData?: string;
    };
  }>;
}

export interface SendUSDCPaymentParams {
  amount: string; // USDC amount (human-readable, e.g., "3")
  destination: string; // XRPL destination address
  destinationTag?: number;
  memos?: Array<{
    memo: {
      memoType?: string;
      memoData?: string;
    };
  }>;
}

/**
 * Convert XRP amount to drops (1 XRP = 1,000,000 drops)
 * GemWallet V3 API expects amounts in drops as a string
 */
const xrpToDrops = (xrpAmount: string): string => {
  const xrp = parseFloat(xrpAmount);
  if (isNaN(xrp)) {
    throw new Error(`Invalid XRP amount: ${xrpAmount}`);
  }
  // Use Math.floor to avoid floating point issues
  const drops = Math.floor(xrp * 1_000_000);
  return drops.toString();
};

export interface SendPaymentResult {
  hash: string;
  status: 'success' | 'pending' | 'failed';
}

class GemWalletService {
  private connectionTimeout = 3000; // ms for detection (increased for reliability)

  /**
   * Check if GemWallet extension is installed
   */
  async isInstalled(): Promise<boolean> {
    try {
      // First check if window.gemWallet is already set
      console.log('[GemWallet] window.gemWallet before check:', typeof (window as unknown as { gemWallet?: boolean }).gemWallet);

      console.log('[GemWallet] Checking if installed...');
      const response = await Promise.race([
        gemIsInstalled(),
        new Promise<{ result: { isInstalled: boolean } }>((resolve) =>
          setTimeout(() => resolve({ result: { isInstalled: false } }), this.connectionTimeout)
        ),
      ]);
      console.log('[GemWallet] isInstalled response:', response.result.isInstalled);
      console.log('[GemWallet] window.gemWallet after check:', typeof (window as unknown as { gemWallet?: boolean }).gemWallet);
      return response.result.isInstalled;
    } catch (error) {
      console.error('[GemWallet] isInstalled error:', error);
      return false;
    }
  }

  /**
   * Get current network (mainnet/testnet)
   */
  async getNetwork(): Promise<'mainnet' | 'testnet' | null> {
    try {
      console.log('[GemWallet] Getting network...');
      const response = await Promise.race([
        gemGetNetwork(),
        new Promise<{ result?: { network?: string } }>((resolve) =>
          setTimeout(() => {
            console.log('[GemWallet] getNetwork timed out');
            resolve({ result: undefined });
          }, this.connectionTimeout)
        ),
      ]);
      console.log('[GemWallet] Network response:', response.result?.network);
      if (response.result?.network) {
        return response.result.network.toLowerCase() as 'mainnet' | 'testnet';
      }
      return null;
    } catch (error) {
      console.error('[GemWallet] getNetwork error:', error);
      return null;
    }
  }

  /**
   * Connect to wallet and get address
   */
  async connect(): Promise<string | null> {
    try {
      console.log('[GemWallet] Requesting address (waiting for user approval)...');
      // Note: This may take longer as user needs to approve - use longer timeout
      const response = await Promise.race([
        gemGetAddress(),
        new Promise<{ result?: { address?: string } }>((resolve) =>
          setTimeout(() => {
            console.log('[GemWallet] connect timed out (user may not have approved)');
            resolve({ result: undefined });
          }, 30000) // 30 second timeout for user approval
        ),
      ]);
      console.log('[GemWallet] Connect response:', response.result?.address ? 'Got address' : 'No address');
      return response.result?.address ?? null;
    } catch (error) {
      console.error('[GemWallet] Connect error:', error);
      return null;
    }
  }

  /**
   * Get current connected address (with timeout to prevent hang on page refresh)
   */
  async getAddress(): Promise<string | null> {
    try {
      const response = await Promise.race([
        gemGetAddress(),
        new Promise<{ result?: { address?: string } }>((resolve) =>
          setTimeout(() => {
            console.log('[GemWallet] getAddress timed out');
            resolve({ result: undefined });
          }, this.connectionTimeout)
        ),
      ]);
      return response.result?.address ?? null;
    } catch {
      return null;
    }
  }

  /**
   * Get XRP balance for an address
   */
  async getBalance(address: string): Promise<string | null> {
    try {
      // GemWallet doesn't have a direct balance API, so we use XRPL client
      // For now, return a placeholder - will be implemented with xrpl.js
      const response = await fetch(
        `https://xrplcluster.com/`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            method: 'account_info',
            params: [{ account: address, ledger_index: 'validated' }],
          }),
        }
      );

      const data = await response.json();
      if (data.result?.account_data?.Balance) {
        // Convert drops to XRP
        const drops = BigInt(data.result.account_data.Balance);
        const xrp = Number(drops) / 1_000_000;
        return xrp.toFixed(2);
      }
      return null;
    } catch (error) {
      console.error('Failed to fetch balance:', error);
      return null;
    }
  }

  /**
   * Send XRP payment (for bridge transactions)
   *
   * Note: GemWallet V3 API expects amounts in drops (1 XRP = 1,000,000 drops)
   * This method accepts XRP and converts to drops internally.
   */
  async sendPayment(params: SendPaymentParams): Promise<SendPaymentResult> {
    try {
      // Convert XRP amount to drops for GemWallet V3 API
      const amountInDrops = xrpToDrops(params.amount);

      console.log('[GemWallet] sendPayment - XRP:', params.amount, '-> Drops:', amountInDrops);
      console.log('[GemWallet] sendPayment - Destination:', params.destination);
      console.log('[GemWallet] sendPayment - Memos:', JSON.stringify(params.memos, null, 2));

      const response = await gemSendPayment({
        amount: amountInDrops, // Amount in drops (string)
        destination: params.destination,
        destinationTag: params.destinationTag,
        memos: params.memos,
      });

      console.log('[GemWallet] sendPayment response:', JSON.stringify(response, null, 2));

      if (response.result?.hash) {
        return {
          hash: response.result.hash,
          status: 'success',
        };
      }

      // Check if user rejected the transaction
      if ((response as { type?: string }).type === 'reject') {
        throw new Error('Transaction rejected by user');
      }

      throw new Error('Transaction failed - no hash returned');
    } catch (error) {
      console.error('[GemWallet] Payment failed:', error);
      throw error;
    }
  }

  /**
   * Send USDC (IOU) payment via GemWallet
   *
   * Unlike XRP which uses drops, USDC uses IOU format with currency/value/issuer.
   * USDC on XRPL uses the hex-encoded currency code and Circle's issuer address.
   *
   * @param params - Payment parameters including amount and destination
   * @returns Payment result with transaction hash and status
   */
  async sendUSDCPayment(params: SendUSDCPaymentParams): Promise<SendPaymentResult> {
    try {
      // USDC on XRPL uses hex-encoded currency code (40 hex chars)
      // "USDC" = 0x55534443 padded with zeros
      const USDC_CURRENCY_HEX = '5553444300000000000000000000000000000000';
      const USDC_ISSUER = 'rGm7WCVp9gb4jZHWTEtGUr4dd74z2XuWhE';

      console.log('[GemWallet] sendUSDCPayment - Amount:', params.amount, 'USDC');
      console.log('[GemWallet] sendUSDCPayment - Destination:', params.destination);
      console.log('[GemWallet] sendUSDCPayment - Memos:', JSON.stringify(params.memos, null, 2));

      // IOU amount format for GemWallet - uses object with currency/value/issuer
      const iouAmount = {
        currency: USDC_CURRENCY_HEX,
        value: params.amount,
        issuer: USDC_ISSUER,
      };

      console.log('[GemWallet] sendUSDCPayment - IOU Amount:', JSON.stringify(iouAmount));

      const response = await gemSendPayment({
        amount: iouAmount, // IOU object, not drops string
        destination: params.destination,
        destinationTag: params.destinationTag,
        memos: params.memos,
      });

      console.log('[GemWallet] sendUSDCPayment response:', JSON.stringify(response, null, 2));

      if (response.result?.hash) {
        return {
          hash: response.result.hash,
          status: 'success',
        };
      }

      // Check if user rejected the transaction
      if ((response as { type?: string }).type === 'reject') {
        throw new Error('Transaction rejected by user');
      }

      throw new Error('USDC transaction failed - no hash returned');
    } catch (error) {
      console.error('[GemWallet] USDC Payment failed:', error);
      throw error;
    }
  }

  /**
   * Validate XRPL address format
   */
  isValidAddress(address: string): boolean {
    // XRPL addresses start with 'r' and are 25-35 characters
    const xrplAddressRegex = /^r[1-9A-HJ-NP-Za-km-z]{24,34}$/;
    return xrplAddressRegex.test(address);
  }

  /**
   * Get trustline balance for a specific token (e.g., USDC)
   * @param address - The XRPL account address
   * @param currency - The currency code (e.g., "USD" for USDC)
   * @param issuer - The issuer address
   * @returns The balance as a string, or null if not found
   */
  async getTrustlineBalance(
    address: string,
    currency: string,
    issuer: string
  ): Promise<string | null> {
    try {
      const response = await fetch(
        `https://xrplcluster.com/`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            method: 'account_lines',
            params: [{ account: address, ledger_index: 'validated' }],
          }),
        }
      );

      const data = await response.json();

      if (data.result?.lines) {
        // Find the matching trustline
        const trustline = data.result.lines.find(
          (line: { currency: string; account: string; balance: string }) =>
            line.currency === currency && line.account === issuer
        );

        if (trustline) {
          console.log(`[GemWallet] Found ${currency} trustline balance:`, trustline.balance);
          return trustline.balance;
        }
      }

      console.log(`[GemWallet] No ${currency} trustline found for issuer ${issuer}`);
      return '0';
    } catch (error) {
      console.error('[GemWallet] Failed to fetch trustline balance:', error);
      return null;
    }
  }

  /**
   * Get USDC balance for an address (convenience method)
   * Uses Circle's USDC issuer on XRPL: rGm7WCVp9gb4jZHWTEtGUr4dd74z2XuWhE
   *
   * Note: USDC on XRPL uses hex-encoded currency code "USDC" (not "USD")
   * "USDC" in hex = 55534443, padded to 40 chars = 5553444300000000000000000000000000000000
   */
  async getUSDCBalance(address: string): Promise<string | null> {
    // USDC on XRPL uses hex-encoded currency code (40 hex chars)
    // "USDC" = 0x55534443 padded with zeros
    const USDC_CURRENCY_HEX = '5553444300000000000000000000000000000000';
    const USDC_ISSUER = 'rGm7WCVp9gb4jZHWTEtGUr4dd74z2XuWhE';

    return this.getTrustlineBalance(address, USDC_CURRENCY_HEX, USDC_ISSUER);
  }

  /**
   * Check if an XRPL address has a USDC trustline
   *
   * XRPL requires recipients to have a trustline set up BEFORE they can receive IOUs.
   * This method checks if the specified address has a USDC trustline to the Circle issuer.
   *
   * @param address - XRPL r-address to check
   * @returns true if has trustline, false otherwise
   */
  async checkUSDCTrustline(address: string): Promise<boolean> {
    try {
      // USDC on XRPL uses hex-encoded currency code (40 hex chars)
      // "USDC" = 0x55534443 padded with zeros
      const USDC_CURRENCY_HEX = '5553444300000000000000000000000000000000';
      const USDC_ISSUER = 'rGm7WCVp9gb4jZHWTEtGUr4dd74z2XuWhE';

      console.log('[GemWallet] Checking USDC trustline for address:', address);

      const response = await fetch(
        'https://xrplcluster.com/',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            method: 'account_lines',
            params: [{ account: address, ledger_index: 'validated' }],
          }),
        }
      );

      const data = await response.json();

      // Check for account not found error (account doesn't exist or has no trustlines)
      if (data.result?.error === 'actNotFound') {
        console.log('[GemWallet] Account not found or has no trustlines:', address);
        return false;
      }

      if (data.result?.lines) {
        // Find the USDC trustline
        const usdcTrustline = data.result.lines.find(
          (line: { currency: string; account: string }) =>
            line.currency === USDC_CURRENCY_HEX && line.account === USDC_ISSUER
        );

        if (usdcTrustline) {
          console.log('[GemWallet] Found USDC trustline for address:', address);
          return true;
        }
      }

      console.log('[GemWallet] No USDC trustline found for address:', address);
      return false;
    } catch (error) {
      console.error('[GemWallet] Failed to check USDC trustline:', error);
      // Return false on error to be safe - better to prevent than allow failed transfers
      return false;
    }
  }

  /**
   * Get transaction details from XRPL ledger
   *
   * Used to verify a transaction was validated on the ledger.
   * This is particularly useful when Axelar's GMP API returns 'cannot_fetch_status'
   * for XRPL native transactions.
   *
   * @param txHash - The XRPL transaction hash
   * @returns Transaction info including validated status, or null if not found
   */
  async getTransaction(txHash: string): Promise<{
    hash: string;
    validated: boolean;
    result?: string;
    ledgerIndex?: number;
  } | null> {
    try {
      const response = await fetch(
        `https://xrplcluster.com/`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            method: 'tx',
            params: [{ transaction: txHash }],
          }),
        }
      );

      const data = await response.json();

      if (data.result?.hash) {
        return {
          hash: data.result.hash,
          validated: data.result.validated === true,
          result: data.result.meta?.TransactionResult,
          ledgerIndex: data.result.ledger_index,
        };
      }

      return null;
    } catch (error) {
      console.error('[GemWallet] Failed to fetch transaction:', error);
      return null;
    }
  }
}

// Export singleton instance
export const gemWalletService = new GemWalletService();

// Export class for testing
export { GemWalletService };
