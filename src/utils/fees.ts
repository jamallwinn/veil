/**
 * Fee Calculation Utilities
 *
 * Calculates fees for private XRP transactions:
 * - Bridge fees (Axelar): ~0.15 XRP each way (x2)
 * - Privacy pool fee: 0.5% of amount
 * - EVM gas fees: deposit (~150k gas) + withdraw (~280k gas)
 * - XRPL network fee: ~0.000012 XRP
 *
 * On XRPL EVM, gas is paid in native XRP, so bridged funds cover gas automatically.
 *
 * Gas prices are fetched dynamically from RPC with 30-second caching.
 * For synchronous calculations, use the fallback (25 gwei).
 */

import { getGasPrice, getDefaultGasPrice, GAS_PRICE_SAFETY_MULTIPLIER } from './gasEstimator';

export interface FeeBreakdown {
  bridge: number;     // Axelar bridge fee (both directions)
  privacy: number;    // Privacy pool fee (0.5%)
  evmGas: number;     // EVM gas costs (deposit + withdraw)
  network: number;    // XRPL network transaction fees
  total: number;      // Total fees
}

// Fee constants
const BRIDGE_FEE_PER_DIRECTION = 0.15; // XRP per bridge crossing

const PRIVACY_FEE_PERCENTAGE = 0.005;  // 0.5% of amount

// EVM gas estimates (in gas units)
// These are VERY conservative estimates for XRPL EVM privacy pool operations.
// Privacy pool deposit/withdraw involve Merkle tree updates, ZK proof verification,
// and state changes which are expensive operations.
// XRPL EVM has high gas prices (275-500 gwei) so we must be generous here.
const DEPOSIT_GAS = 350_000n;   // Privacy pool deposit (Merkle tree insert, event emission)
const WITHDRAW_GAS = 500_000n;  // Privacy pool withdraw (ZK proof verification is expensive)
const BRIDGE_CALL_GAS = 200_000n; // Axelar bridge call on EVM side (cross-chain messaging)

// XRPL network fee (very small)
const XRPL_NETWORK_FEE = 0.000012; // ~12 drops

/**
 * Minimum EVM gas buffer in XRP
 * This ensures we always have enough for gas even in worst case scenarios.
 *
 * XRPL EVM has VERY HIGH gas prices (275-500+ gwei) compared to other EVMs.
 * A full privacy transaction requires:
 * - Deposit: ~350k gas @ 400 gwei = 0.14 XRP
 * - Withdraw: ~500k gas @ 400 gwei = 0.20 XRP
 * - Bridge call: ~200k gas @ 400 gwei = 0.08 XRP
 * - Total: ~1.05M gas @ 400 gwei = ~0.42 XRP
 *
 * With 500 gwei spikes and safety margin, we need at least 1.0 XRP buffer.
 * We use 1.5 XRP to be safe against gas price volatility and failed txs.
 */
const MIN_EVM_GAS_BUFFER_XRP = 1.5;

/**
 * Calculate EVM gas cost in XRP (synchronous, uses fallback gas price)
 * XRPL EVM uses native XRP for gas (18 decimals)
 *
 * Applies safety multiplier to account for gas price spikes.
 * Returns at least MIN_EVM_GAS_BUFFER_XRP to ensure sufficient funds.
 *
 * For more accurate estimates, use calculateEvmGasCostAsync()
 */
function calculateEvmGasCost(): number {
  const totalGas = DEPOSIT_GAS + WITHDRAW_GAS + BRIDGE_CALL_GAS;
  const { wei: gasPriceWei } = getDefaultGasPrice();
  // Gas cost in wei: gas * gasPrice (wei)
  const gasCostWei = totalGas * gasPriceWei;
  // Convert to XRP (18 decimals) and apply safety multiplier
  const gasCostXRP = (Number(gasCostWei) / 1e18) * GAS_PRICE_SAFETY_MULTIPLIER;
  // Return at least the minimum buffer
  return Math.max(gasCostXRP, MIN_EVM_GAS_BUFFER_XRP);
}

/**
 * Calculate EVM gas cost in XRP using dynamic gas price from RPC
 * XRPL EVM uses native XRP for gas (18 decimals)
 *
 * Applies safety multiplier to account for gas price spikes.
 * Returns at least MIN_EVM_GAS_BUFFER_XRP to ensure sufficient funds.
 */
async function calculateEvmGasCostAsync(): Promise<number> {
  const totalGas = DEPOSIT_GAS + WITHDRAW_GAS + BRIDGE_CALL_GAS;
  const { gasPrice } = await getGasPrice();
  // Gas cost in wei: gas * gasPrice (wei)
  const gasCostWei = totalGas * gasPrice;
  // Convert to XRP (18 decimals) and apply safety multiplier
  const gasCostXRP = (Number(gasCostWei) / 1e18) * GAS_PRICE_SAFETY_MULTIPLIER;
  // Return at least the minimum buffer
  return Math.max(gasCostXRP, MIN_EVM_GAS_BUFFER_XRP);
}

/**
 * Calculate fees for a given amount (synchronous, uses fallback gas price)
 *
 * For accurate fees based on current network conditions, use calculateFeesAsync()
 */
export function calculateFees(amount: number): FeeBreakdown {
  const bridge = BRIDGE_FEE_PER_DIRECTION * 2;
  const privacy = amount * PRIVACY_FEE_PERCENTAGE;
  const evmGas = calculateEvmGasCost();
  const network = XRPL_NETWORK_FEE;
  const total = bridge + privacy + evmGas + network;

  return {
    bridge,
    privacy,
    evmGas,
    network,
    total,
  };
}

/**
 * Calculate fees for a given amount with dynamic gas price from RPC
 *
 * Uses cached gas price (30 second TTL) for efficiency.
 * Falls back to default gas price if RPC is unavailable.
 */
export async function calculateFeesAsync(amount: number): Promise<FeeBreakdown> {
  const bridge = BRIDGE_FEE_PER_DIRECTION * 2;
  const privacy = amount * PRIVACY_FEE_PERCENTAGE;
  const evmGas = await calculateEvmGasCostAsync();
  const network = XRPL_NETWORK_FEE;
  const total = bridge + privacy + evmGas + network;

  return {
    bridge,
    privacy,
    evmGas,
    network,
    total,
  };
}

/**
 * Calculate the amount recipient will receive after fees
 */
export function calculateReceivedAmount(amount: number): number {
  const fees = calculateFees(amount);
  return Math.max(0, amount - fees.total);
}

/**
 * Calculate minimum amount needed to send a specific value
 */
export function calculateRequiredAmount(targetReceived: number): number {
  // Solve for amount where: amount - fees(amount) = targetReceived
  // amount - (bridge + amount * 0.005 + evmGas + network) = targetReceived
  // amount * (1 - 0.005) = targetReceived + bridge + evmGas + network
  // amount = (targetReceived + fixedFees) / 0.995

  const bridge = BRIDGE_FEE_PER_DIRECTION * 2;
  const evmGas = calculateEvmGasCost();
  const network = XRPL_NETWORK_FEE;
  const fixedFees = bridge + evmGas + network;

  return (targetReceived + fixedFees) / (1 - PRIVACY_FEE_PERCENTAGE);
}

/**
 * Get the total amount to bridge (payment + all fees)
 * This is what gets sent from user's GemWallet to the internal EVM wallet
 */
export function calculateBridgeAmount(paymentAmount: number): number {
  const fees = calculateFees(paymentAmount);
  return paymentAmount + fees.total;
}

/**
 * Get detailed fee breakdown for display
 */
export function getFeeBreakdownDisplay(amount: number): {
  bridge: string;
  privacy: string;
  evmGas: string;
  network: string;
  total: string;
  bridgeAmount: string;
  recipientReceives: string;
} {
  const fees = calculateFees(amount);
  return {
    bridge: `${formatXRP(fees.bridge, 4)} XRP`,
    privacy: `${formatXRP(fees.privacy, 4)} XRP (0.5%)`,
    evmGas: `${formatXRP(fees.evmGas, 4)} XRP`,
    network: `${formatXRP(fees.network, 6)} XRP`,
    total: `${formatXRP(fees.total, 4)} XRP`,
    bridgeAmount: `${formatXRP(amount + fees.total, 4)} XRP`,
    recipientReceives: `${formatXRP(amount, 4)} XRP`,
  };
}

/**
 * Format XRP amount for display
 */
export function formatXRP(amount: number, decimals: number = 2): string {
  return amount.toFixed(decimals);
}

/**
 * Parse XRP amount from string
 */
export function parseXRP(value: string): number {
  const parsed = parseFloat(value);
  return isNaN(parsed) ? 0 : parsed;
}
