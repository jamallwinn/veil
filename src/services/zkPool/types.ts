/**
 * ZK Privacy Pool Types
 *
 * TypeScript interfaces for the custom ZK privacy pool implementation
 * using Circom circuits and SnarkJS for proof generation.
 */

// =============================================================================
// Deposit Note Types
// =============================================================================

/**
 * A deposit note represents a single deposit into the privacy pool.
 * Contains all information needed to later withdraw the funds.
 *
 * SECURITY: The nullifier and secret MUST be kept private.
 * Only the commitment and nullifierHash are public.
 */
export interface DepositNote {
  /** Poseidon(nullifier, secret) - stored in Merkle tree */
  commitment: string;
  /** Random 31-byte field element (private) */
  nullifier: string;
  /** Random 31-byte field element (private) */
  secret: string;
  /** Poseidon(nullifier) - revealed during withdrawal to prevent double-spend */
  nullifierHash: string;
  /** Position in the Merkle tree (0-indexed) */
  leafIndex: number;
  /** Deposit amount in wei */
  amount: bigint;
  /** Unix timestamp when deposited */
  timestamp: number;
  /** Optional: transaction hash of the deposit */
  depositTxHash?: string;
  /** Optional: block number of the deposit */
  blockNumber?: number;
}

/**
 * Stored note data (serializable for secure storage)
 * BigInt is converted to string for JSON serialization
 */
export interface StoredDepositNote {
  commitment: string;
  nullifier: string;
  secret: string;
  nullifierHash: string;
  leafIndex: number;
  amount: string; // BigInt as string
  timestamp: number;
  depositTxHash?: string;
  blockNumber?: number;
}

// =============================================================================
// Proof Types
// =============================================================================

/**
 * Groth16 proof structure from SnarkJS
 */
export interface Groth16Proof {
  pi_a: [string, string, string];
  pi_b: [[string, string], [string, string], [string, string]];
  pi_c: [string, string, string];
  protocol: 'groth16';
  curve: 'bn128';
}

/**
 * Complete withdrawal proof with public signals
 */
export interface WithdrawProof {
  /** The ZK proof */
  proof: Groth16Proof;
  /** Public signals: [root, nullifierHash, recipient, relayer, fee, refund] */
  publicSignals: string[];
}

/**
 * Input for the withdrawal circuit (private and public inputs)
 */
export interface WithdrawCircuitInput {
  // Private inputs
  nullifier: string;
  secret: string;
  pathElements: string[];
  pathIndices: number[];
  // Public inputs
  root: string;
  nullifierHash: string;
  recipient: string;
  relayer: string;
  fee: string;
  refund: string;
}

/**
 * Calldata formatted for Solidity verifier contract
 */
export interface SolidityCalldata {
  a: [string, string];
  b: [[string, string], [string, string]];
  c: [string, string];
  input: string[];
}

// =============================================================================
// Merkle Tree Types
// =============================================================================

/**
 * Merkle proof for a leaf in the tree
 */
export interface MerkleProof {
  /** Sibling hashes along the path */
  pathElements: string[];
  /** Position indicators (0 = left, 1 = right) */
  pathIndices: number[];
  /** The computed root */
  root: string;
  /** Index of the leaf */
  leafIndex: number;
}

/**
 * Current state of the privacy pool
 */
export interface PoolState {
  /** Current Merkle root */
  root: string;
  /** Next available leaf position */
  nextIndex: number;
  /** All commitments in the tree */
  commitments: string[];
  /** Set of used nullifier hashes (to prevent double-spend) */
  usedNullifiers: Set<string>;
}

/**
 * Serializable pool state for storage
 */
export interface StoredPoolState {
  root: string;
  nextIndex: number;
  commitments: string[];
  usedNullifiers: string[];
}

// =============================================================================
// Service Types
// =============================================================================

/**
 * ZK Pool service configuration
 */
export interface ZKPoolConfig {
  /** Number of levels in the Merkle tree (20 = ~1M deposits) */
  treeLevels: number;
  /** Path to WASM circuit file */
  wasmPath: string;
  /** Path to final zkey file */
  zkeyPath: string;
  /** Path to verification key JSON */
  vkeyPath: string;
  /** Whether to run in demo mode (no real contract interaction) */
  demoMode: boolean;
  /** Privacy pool contract address on XRPL EVM */
  contractAddress?: string;
}

/**
 * Get ZK artifact paths based on environment
 * - Development (Vite dev server): /build/...
 * - Production (Cloud Run/nginx): /zk/...
 */
function getZKArtifactPaths() {
  // Check if running in production mode
  // In Vite: import.meta.env.PROD is true when built for production
  const isProduction = typeof import.meta !== 'undefined'
    && import.meta.env
    && import.meta.env.PROD;

  const basePath = isProduction ? '/zk' : '/build/withdraw_js';
  const buildPath = isProduction ? '/zk' : '/build';

  return {
    wasmPath: `${basePath}/withdraw.wasm`,
    zkeyPath: `${buildPath}/withdraw_final.zkey`,
    vkeyPath: `${buildPath}/verification_key.json`,
  };
}

/**
 * Default configuration values
 */
export const DEFAULT_ZK_POOL_CONFIG: ZKPoolConfig = {
  treeLevels: 20,
  ...getZKArtifactPaths(),
  demoMode: false, // Default to real mode (contract interactions)
  contractAddress: '0xf765F2A56EF0f6d09438E2113a2FC9932b9645bB', // XRPL EVM Mainnet - PrivacyPoolNative (1 XRP)
};

/**
 * Service status
 */
export type ZKPoolStatus =
  | 'uninitialized' // Service not yet initialized
  | 'initializing' // Loading circuit artifacts
  | 'ready' // Ready for use
  | 'error'; // Initialization failed

/**
 * Deposit result
 */
export interface DepositResult {
  success: boolean;
  note?: DepositNote;
  txHash?: string;
  error?: string;
}

/**
 * Withdrawal result
 */
export interface WithdrawResult {
  success: boolean;
  txHash?: string;
  proof?: WithdrawProof;
  error?: string;
}

// =============================================================================
// Error Types
// =============================================================================

/**
 * Error codes for the ZK Pool service
 */
export const ZK_POOL_ERROR_CODES = {
  NOT_INITIALIZED: 'NOT_INITIALIZED',
  CIRCUIT_LOAD_FAILED: 'CIRCUIT_LOAD_FAILED',
  PROOF_GENERATION_FAILED: 'PROOF_GENERATION_FAILED',
  PROOF_VERIFICATION_FAILED: 'PROOF_VERIFICATION_FAILED',
  INVALID_NOTE: 'INVALID_NOTE',
  NOTE_NOT_FOUND: 'NOTE_NOT_FOUND',
  NOTE_ALREADY_SPENT: 'NOTE_ALREADY_SPENT',
  MERKLE_PROOF_FAILED: 'MERKLE_PROOF_FAILED',
  INVALID_AMOUNT: 'INVALID_AMOUNT',
  INVALID_RECIPIENT: 'INVALID_RECIPIENT',
  STORAGE_ERROR: 'STORAGE_ERROR',
  CONTRACT_ERROR: 'CONTRACT_ERROR',
} as const;

export type ZKPoolErrorCode = (typeof ZK_POOL_ERROR_CODES)[keyof typeof ZK_POOL_ERROR_CODES];

/**
 * ZK Pool service error
 */
export class ZKPoolError extends Error {
  constructor(
    public readonly code: ZKPoolErrorCode,
    message: string,
    public readonly originalError?: unknown
  ) {
    super(message);
    this.name = 'ZKPoolError';
  }
}
