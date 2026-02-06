/**
 * Dynamic Gas Price Estimation
 *
 * Fetches current gas prices from XRPL EVM RPC with caching to avoid
 * excessive RPC calls. Falls back to a reasonable default if RPC fails.
 *
 * Cache duration: 30 seconds (suitable for EVM where gas prices are stable)
 */

import { evmProviderService } from '@services/evm/provider';

// =============================================================================
// Types
// =============================================================================

export interface GasPriceResult {
  gasPrice: bigint;       // Gas price in wei
  gasPriceGwei: bigint;   // Gas price in gwei for convenience
  timestamp: number;      // When this price was fetched
  isFromCache: boolean;   // Whether this is a cached value
  isFallback: boolean;    // Whether this is a fallback (RPC failed)
}

// =============================================================================
// Constants
// =============================================================================

/** Cache duration in milliseconds (30 seconds) */
const CACHE_DURATION_MS = 30_000;

/**
 * Default gas price in gwei if RPC fails
 * XRPL EVM typically runs at 275-500 gwei (much higher than Ethereum mainnet)
 * We use 400 gwei as a conservative default to avoid insufficient funds errors.
 * During high activity, prices can spike above 500 gwei.
 */
const DEFAULT_GAS_PRICE_GWEI = 400n;

/** Default gas price in wei */
const DEFAULT_GAS_PRICE_WEI = DEFAULT_GAS_PRICE_GWEI * 1_000_000_000n;

/**
 * Gas price safety multiplier for buffer against price spikes
 * Applied to both cached and fallback gas prices in fee calculations.
 *
 * XRPL EVM gas prices are volatile (275-500+ gwei) and can spike during
 * high network activity. A 2x multiplier ensures we have sufficient
 * buffer even when gas prices double between estimation and execution.
 */
export const GAS_PRICE_SAFETY_MULTIPLIER = 2.0;

// =============================================================================
// Cache State
// =============================================================================

let cachedGasPrice: bigint | null = null;
let cacheTimestamp: number = 0;

// =============================================================================
// Functions
// =============================================================================

/**
 * Get current gas price with caching
 *
 * Fetches gas price from XRPL EVM RPC, caching the result for 30 seconds.
 * Falls back to a reasonable default (25 gwei) if RPC call fails.
 *
 * @returns Gas price information including wei value, gwei value, and metadata
 */
export async function getGasPrice(): Promise<GasPriceResult> {
  const now = Date.now();

  // Return cached value if valid
  if (cachedGasPrice !== null && (now - cacheTimestamp) < CACHE_DURATION_MS) {
    return {
      gasPrice: cachedGasPrice,
      gasPriceGwei: cachedGasPrice / 1_000_000_000n,
      timestamp: cacheTimestamp,
      isFromCache: true,
      isFallback: false,
    };
  }

  // Fetch fresh gas price from RPC
  try {
    const provider = evmProviderService.getProvider();
    const feeData = await provider.getFeeData();

    const gasPrice = feeData.gasPrice ?? DEFAULT_GAS_PRICE_WEI;

    // Update cache
    cachedGasPrice = gasPrice;
    cacheTimestamp = now;

    return {
      gasPrice,
      gasPriceGwei: gasPrice / 1_000_000_000n,
      timestamp: now,
      isFromCache: false,
      isFallback: false,
    };
  } catch (error) {
    console.warn('[GasEstimator] Failed to fetch gas price from RPC, using fallback:', error);

    // Return fallback without caching (so we retry on next call)
    return {
      gasPrice: DEFAULT_GAS_PRICE_WEI,
      gasPriceGwei: DEFAULT_GAS_PRICE_GWEI,
      timestamp: now,
      isFromCache: false,
      isFallback: true,
    };
  }
}

/**
 * Get gas price in wei (simple version)
 *
 * Convenience function that just returns the gas price as a bigint.
 * Uses the same caching as getGasPrice().
 */
export async function getGasPriceWei(): Promise<bigint> {
  const result = await getGasPrice();
  return result.gasPrice;
}

/**
 * Get gas price in gwei (simple version)
 *
 * Convenience function that returns gas price in gwei as a bigint.
 */
export async function getGasPriceGwei(): Promise<bigint> {
  const result = await getGasPrice();
  return result.gasPriceGwei;
}

/**
 * Clear the gas price cache
 *
 * Useful for testing or when you need to force a fresh fetch.
 */
export function clearGasPriceCache(): void {
  cachedGasPrice = null;
  cacheTimestamp = 0;
}

/**
 * Get default gas price (fallback value)
 *
 * Returns the fallback gas price without making any RPC calls.
 * Useful for synchronous calculations or when offline.
 */
export function getDefaultGasPrice(): { wei: bigint; gwei: bigint } {
  return {
    wei: DEFAULT_GAS_PRICE_WEI,
    gwei: DEFAULT_GAS_PRICE_GWEI,
  };
}

/**
 * Check if the cache is valid
 *
 * @returns true if cache has a value that hasn't expired
 */
export function isCacheValid(): boolean {
  if (cachedGasPrice === null) return false;
  return (Date.now() - cacheTimestamp) < CACHE_DURATION_MS;
}
