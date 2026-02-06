/**
 * RAILGUN Service Types
 *
 * TypeScript types for the RAILGUN privacy protocol integration.
 * RAILGUN provides zero-knowledge proof-based privacy for EVM transactions.
 *
 * RESEARCH STATUS (January 2026):
 * ==============================
 * RAILGUN is NOT deployed on XRPL EVM Sidechain.
 * See /docs/RAILGUN_RESEARCH.md for comprehensive research findings.
 *
 * RAILGUN only supports: Ethereum, Polygon, BSC, Arbitrum
 * XRPL EVM (chain ID 1440002/1440000) is NOT supported.
 *
 * These types remain for future integration if RAILGUN expands to XRPL EVM.
 */

// =============================================================================
// Wallet Types
// =============================================================================

/**
 * RAILGUN wallet information
 * The 0zk address is the shielded address that can receive private transfers
 */
export interface RailgunWallet {
  /** Unique wallet identifier */
  id: string;
  /** RAILGUN 0zk address (shielded address for receiving) */
  zkAddress: string;
  /** Timestamp when wallet was created */
  createdAt: number;
  /** Whether the wallet is currently loaded/active */
  isLoaded: boolean;
}

/**
 * Stored wallet data (encrypted in secure storage)
 */
export interface StoredWalletData {
  /** Wallet ID */
  id: string;
  /** Encrypted mnemonic (encrypted by user's encryption key) */
  encryptedMnemonic: string;
  /** RAILGUN 0zk address */
  zkAddress: string;
  /** Creation timestamp */
  createdAt: number;
}

// =============================================================================
// Balance Types
// =============================================================================

/**
 * Shielded token balance
 */
export interface ShieldedBalance {
  /** Token contract address (native token uses zero address) */
  tokenAddress: string;
  /** Token symbol (e.g., "wXRP") */
  symbol: string;
  /** Balance in smallest unit (wei for wXRP) */
  balance: bigint;
  /** Formatted balance string */
  formattedBalance: string;
  /** Token decimals */
  decimals: number;
}

/**
 * UTXO (Unspent Transaction Output) in RAILGUN
 * Each UTXO represents a note in the privacy pool
 */
export interface RailgunUTXO {
  /** Unique identifier for this UTXO */
  id: string;
  /** Token address */
  tokenAddress: string;
  /** Amount in this UTXO */
  amount: bigint;
  /** Block number when UTXO was created */
  blockNumber: number;
  /** Whether this UTXO has been spent */
  spent: boolean;
}

// =============================================================================
// Shield Operation Types
// =============================================================================

/**
 * Parameters for shielding tokens (depositing to privacy pool)
 */
export interface ShieldParams {
  /** Token contract address to shield (wXRP on XRPL EVM) */
  tokenAddress: string;
  /** Amount to shield in smallest unit (wei) */
  amount: bigint;
  /** Recipient's RAILGUN 0zk address */
  recipientAddress: string;
  /** Optional: Encryption key for the note */
  encryptionKey?: string;
}

/**
 * Result of a shield operation
 */
export interface ShieldResult {
  /** Whether the operation succeeded */
  success: boolean;
  /** Transaction hash if successful */
  txHash: string | null;
  /** Block number where transaction was mined */
  blockNumber?: number;
  /** Error message if failed */
  error?: string;
  /** Gas used by the transaction */
  gasUsed?: bigint;
}

/**
 * Shield transaction status
 */
export type ShieldStatus =
  | 'pending'      // Transaction submitted, waiting for confirmation
  | 'confirming'   // Transaction confirmed, waiting for finality
  | 'complete'     // Shield operation complete, balance updated
  | 'failed';      // Shield operation failed

/**
 * Shield transaction tracking
 */
export interface ShieldTransaction {
  /** Transaction hash */
  txHash: string;
  /** Current status */
  status: ShieldStatus;
  /** Token being shielded */
  tokenAddress: string;
  /** Amount being shielded */
  amount: bigint;
  /** Recipient 0zk address */
  recipientAddress: string;
  /** Number of confirmations */
  confirmations: number;
  /** Required confirmations (typically 12 for XRPL EVM) */
  requiredConfirmations: number;
  /** Timestamp when transaction was submitted */
  submittedAt: number;
  /** Timestamp when transaction completed (if complete) */
  completedAt?: number;
  /** Error message if failed */
  error?: string;
}

// =============================================================================
// Unshield Operation Types (for future implementation)
// =============================================================================

/**
 * Parameters for unshielding tokens (withdrawing from privacy pool)
 */
export interface UnshieldParams {
  /** Token contract address to unshield */
  tokenAddress: string;
  /** Amount to unshield in smallest unit */
  amount: bigint;
  /** Recipient's public EVM address */
  toAddress: string;
}

/**
 * Result of an unshield operation
 */
export interface UnshieldResult {
  /** Whether the operation succeeded */
  success: boolean;
  /** Transaction hash if successful */
  txHash: string | null;
  /** Error message if failed */
  error?: string;
}

// =============================================================================
// Transfer Operation Types (for future implementation)
// =============================================================================

/**
 * Parameters for private transfers between RAILGUN wallets
 */
export interface PrivateTransferParams {
  /** Token contract address */
  tokenAddress: string;
  /** Amount to transfer */
  amount: bigint;
  /** Recipient's RAILGUN 0zk address */
  recipientZkAddress: string;
}

/**
 * Result of a private transfer
 */
export interface PrivateTransferResult {
  /** Whether the operation succeeded */
  success: boolean;
  /** Transaction hash if successful */
  txHash: string | null;
  /** Error message if failed */
  error?: string;
}

// =============================================================================
// Engine & Configuration Types
// =============================================================================

/**
 * RAILGUN engine initialization status
 */
export type EngineStatus =
  | 'uninitialized'  // Engine not yet initialized
  | 'initializing'   // Engine is being initialized
  | 'ready'          // Engine is ready for use
  | 'error';         // Initialization failed

/**
 * RAILGUN network configuration
 */
export interface RailgunNetworkConfig {
  /** Chain ID (1440002 for XRPL EVM Sidechain) */
  chainId: number;
  /** Network name */
  networkName: string;
  /** RAILGUN Proxy contract address */
  proxyContractAddress: string;
  /** RAILGUN Relay Adapt contract address */
  relayAdaptContractAddress: string;
  /** Token addresses used in the network */
  tokenAddresses: {
    /** Wrapped XRP contract address */
    WXRP: string;
  };
}

/**
 * Service configuration
 */
export interface RailgunServiceConfig {
  /** Network configuration */
  network: RailgunNetworkConfig;
  /** Whether debug mode is enabled */
  debugMode: boolean;
  /** Polling interval for balance updates (ms) */
  pollingInterval: number;
  /** Required confirmations for shield transactions */
  requiredConfirmations: number;
}

// =============================================================================
// Error Types
// =============================================================================

/**
 * RAILGUN service error codes
 */
export const RAILGUN_ERROR_CODES = {
  ENGINE_NOT_INITIALIZED: 'ENGINE_NOT_INITIALIZED',
  WALLET_NOT_LOADED: 'WALLET_NOT_LOADED',
  INVALID_ZK_ADDRESS: 'INVALID_ZK_ADDRESS',
  INVALID_TOKEN_ADDRESS: 'INVALID_TOKEN_ADDRESS',
  INSUFFICIENT_BALANCE: 'INSUFFICIENT_BALANCE',
  SHIELD_FAILED: 'SHIELD_FAILED',
  UNSHIELD_FAILED: 'UNSHIELD_FAILED',
  PROOF_GENERATION_FAILED: 'PROOF_GENERATION_FAILED',
  NETWORK_ERROR: 'NETWORK_ERROR',
  ENCRYPTION_ERROR: 'ENCRYPTION_ERROR',
  STORAGE_ERROR: 'STORAGE_ERROR',
  CONTRACT_NOT_DEPLOYED: 'CONTRACT_NOT_DEPLOYED',
} as const;

export type RailgunErrorCode = typeof RAILGUN_ERROR_CODES[keyof typeof RAILGUN_ERROR_CODES];

/**
 * RAILGUN service error
 */
export interface RailgunServiceError {
  /** Error code */
  code: RailgunErrorCode;
  /** Human-readable error message */
  message: string;
  /** Original error if available */
  originalError?: unknown;
}

// =============================================================================
// Proof Types (for future ZK proof generation)
// =============================================================================

/**
 * Zero-knowledge proof for shield/unshield operations
 */
export interface ZKProof {
  /** Proof type */
  type: 'shield' | 'unshield' | 'transfer';
  /** Proof data (Groth16 proof) */
  proof: {
    a: [string, string];
    b: [[string, string], [string, string]];
    c: [string, string];
  };
  /** Public inputs for verification */
  publicInputs: string[];
  /** Timestamp when proof was generated */
  generatedAt: number;
}

// =============================================================================
// Scanning Types
// =============================================================================

/**
 * Balance scan status
 */
export type ScanStatus =
  | 'idle'       // No scan in progress
  | 'scanning'   // Scan in progress
  | 'complete'   // Scan completed successfully
  | 'error';     // Scan failed

/**
 * Balance scan progress
 */
export interface ScanProgress {
  /** Current scan status */
  status: ScanStatus;
  /** Progress percentage (0-100) */
  progress: number;
  /** Last scanned block number */
  lastScannedBlock: number;
  /** Current chain tip block number */
  currentBlock: number;
  /** Error message if scan failed */
  error?: string;
}
