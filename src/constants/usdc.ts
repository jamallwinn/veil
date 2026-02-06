/**
 * USDC Constants for Veil Private Payments
 *
 * Configuration for USDC.xrpl token on XRPL EVM and cross-chain bridging via Axelar ITS.
 *
 * USDC.xrpl is Circle's bridged USDC on XRPL, which can be bridged to XRPL EVM
 * via Axelar's Interchain Token Service (ITS).
 *
 * Chain: XRPL EVM Mainnet (Chain ID: 1440000)
 * Token: USDC.xrpl (15 decimals on EVM, 6 decimals on native XRPL)
 *
 * @see https://docs.axelar.dev/dev/reference/mainnet-contract-addresses/
 * @see https://docs.xrplevm.org/pages/bridge/interchain-transfer
 */

// =============================================================================
// USDC Token Configuration
// =============================================================================

/**
 * USDC.xrpl ERC-20 contract address on XRPL EVM Mainnet
 * This is the ITS-wrapped USDC token bridged via Axelar
 */
export const USDC_TOKEN_ADDRESS = '0xDaF4556169c4F3f2231d8ab7BC8772Ddb7D4c84C';

/**
 * USDC.xrpl decimals on XRPL EVM
 * Note: USDC has 6 decimals on XRPL native, but 15 decimals on XRPL EVM
 * This matches the ITS token specification
 */
export const USDC_DECIMALS = 15;

/**
 * USDC.xrpl ITS Token ID
 * Used for interchainTransfer() calls to Axelar ITS
 * This identifies the USDC token in Axelar's Interchain Token Service
 */
export const USDC_TOKEN_ID = '0x73c6c46c441ee16932b99375a35d2d42c5a41054b86901fb86e285d6b9128154';

/**
 * USDC.xrpl Token Manager address on XRPL EVM
 * Manages the USDC token on the EVM side for Axelar ITS
 */
export const USDC_TOKEN_MANAGER = '0x17858374d82efdd0998c9845dc9af4c23578f5a7';

/**
 * USDC issuer address on XRPL native
 * This is Circle's issuer account for USDC on XRPL
 */
export const USDC_ISSUER_XRPL = 'rGm7WCVp9gb4jZHWTEtGUr4dd74z2XuWhE';

/**
 * Axelar ITS Contract address on XRPL EVM Mainnet
 * Standard across all Axelar-supported EVM chains
 */
export const ITS_CONTRACT = '0xB5FB4BE02232B1bBA4dC8f81dc24C26980dE9e3C';

// =============================================================================
// Privacy Pool Configuration for USDC
// =============================================================================

/**
 * Pool denomination for USDC privacy pool
 * 3 USDC with 15 decimals = 3 * 10^15 = 3000000000000000
 */
export const USDC_POOL_DENOMINATION = BigInt('3000000000000000'); // 3 USDC (15 decimals)

/**
 * Human-readable denomination
 */
export const USDC_POOL_DENOMINATION_HUMAN = '3'; // 3 USDC

// =============================================================================
// Fee Configuration
// =============================================================================

/**
 * Bridge fee percentage (0.1%)
 */
export const USDC_BRIDGE_FEE_PERCENTAGE = 0.001;

/**
 * Minimum bridge amount in USDC
 * Note: Must be >= pool denomination (3 USDC) for single-deposit transactions
 * Set to 3 to match USDC_POOL_DENOMINATION for simplicity
 */
export const USDC_MINIMUM_BRIDGE_AMOUNT = '3'; // 3 USDC (matches pool denomination)

/**
 * Privacy pool fee percentage (0.1%)
 */
export const USDC_POOL_FEE_PERCENTAGE = 0.001;

// =============================================================================
// Contract Addresses (to be deployed)
// =============================================================================

/**
 * USDC Privacy Pool contract address on XRPL EVM Mainnet
 * Will be deployed via deploy-usdc-pool.ts script
 */
export const USDC_PRIVACY_POOL_ADDRESS = '0xFCafF9d4Ae430b3c4585b711868E807957804D69';

/**
 * Existing Groth16Verifier contract (same verifier works for any denomination)
 * Deployed during XRP pool setup
 */
export const GROTH16_VERIFIER_ADDRESS = '0x8EAd4fb6e3fEA46c22a39f2da02E65E916D2Cd13';

// =============================================================================
// Network Configuration
// =============================================================================

export const USDC_NETWORK_CONFIG = {
  MAINNET: {
    chainId: 1440000,
    rpcUrl: 'https://rpc.xrplevm.org',
    explorerUrl: 'https://explorer.xrplevm.org',
    tokenAddress: USDC_TOKEN_ADDRESS,
    tokenId: USDC_TOKEN_ID,
    tokenManager: USDC_TOKEN_MANAGER,
    itsContract: ITS_CONTRACT,
    poolAddress: USDC_PRIVACY_POOL_ADDRESS,
    verifierAddress: GROTH16_VERIFIER_ADDRESS,
  },
  TESTNET: {
    chainId: 1449000,
    rpcUrl: 'https://rpc.testnet.xrplevm.org',
    explorerUrl: 'https://explorer.testnet.xrplevm.org',
    // Testnet addresses TBD - may differ from mainnet
    tokenAddress: USDC_TOKEN_ADDRESS, // Placeholder - verify on testnet
    tokenId: USDC_TOKEN_ID, // Placeholder - verify on testnet
    tokenManager: USDC_TOKEN_MANAGER, // Placeholder - verify on testnet
    itsContract: '0x3b1ca8B18698409fF95e29c506ad7014980F0193', // ITS testnet address
    poolAddress: '0x0000000000000000000000000000000000000000', // TBD
    verifierAddress: GROTH16_VERIFIER_ADDRESS,
  },
} as const;

// =============================================================================
// Axelar Chain Identifiers
// =============================================================================

export const USDC_AXELAR_CONFIG = {
  sourceChain: 'xrpl',
  destinationChain: 'xrpl-evm',
  tokenSymbol: 'USDC',
  tokenDenom: 'usdc',
} as const;

// =============================================================================
// ERC-20 ABI (minimal for USDC operations)
// =============================================================================

export const USDC_ERC20_ABI = [
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
  'function totalSupply() view returns (uint256)',
  'function balanceOf(address account) view returns (uint256)',
  'function transfer(address to, uint256 amount) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function transferFrom(address from, address to, uint256 amount) returns (bool)',
  'event Transfer(address indexed from, address indexed to, uint256 value)',
  'event Approval(address indexed owner, address indexed spender, uint256 value)',
];

// =============================================================================
// Type Exports
// =============================================================================

export interface USDCConfig {
  tokenAddress: string;
  tokenId: string;
  tokenManager: string;
  itsContract: string;
  poolAddress: string;
  verifierAddress: string;
  chainId: number;
  rpcUrl: string;
  decimals: number;
  denomination: bigint;
}

/**
 * Get USDC configuration for a specific network
 */
export function getUSDCConfig(network: 'mainnet' | 'testnet' = 'mainnet'): USDCConfig {
  const networkConfig = network === 'mainnet'
    ? USDC_NETWORK_CONFIG.MAINNET
    : USDC_NETWORK_CONFIG.TESTNET;

  return {
    tokenAddress: networkConfig.tokenAddress,
    tokenId: networkConfig.tokenId,
    tokenManager: networkConfig.tokenManager,
    itsContract: networkConfig.itsContract,
    poolAddress: networkConfig.poolAddress,
    verifierAddress: networkConfig.verifierAddress,
    chainId: networkConfig.chainId,
    rpcUrl: networkConfig.rpcUrl,
    decimals: USDC_DECIMALS,
    denomination: USDC_POOL_DENOMINATION,
  };
}
