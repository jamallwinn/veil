/**
 * Merkle Tree Implementation
 *
 * Poseidon-based Merkle tree for the ZK privacy pool.
 * Uses circomlibjs Poseidon for circuit-compatible hashing.
 *
 * Key properties:
 * - 20 levels (supports ~1 million deposits)
 * - Uses circomlibjs Poseidon hash (matches Circom circuits)
 * - ZERO_VALUE = keccak256("veil") % FIELD_PRIME (matches contract)
 */

import { ethers } from 'ethers';
import type { MerkleProof, PoolState, StoredPoolState } from './types';

// =============================================================================
// Constants
// =============================================================================

/**
 * Field prime for BN128 curve (used by Circom)
 * p = 21888242871839275222246405745257275088548364400416034343698204186575808495617
 */
export const FIELD_PRIME = BigInt(
  '21888242871839275222246405745257275088548364400416034343698204186575808495617'
);

/**
 * Zero value for empty leaves: keccak256("veil") % FIELD_PRIME
 * MUST match the contract's ZERO_VALUE!
 */
export const ZERO_VALUE = BigInt(ethers.keccak256(ethers.toUtf8Bytes('veil'))) % FIELD_PRIME;

/** Default tree levels (matches contract) */
export const DEFAULT_TREE_LEVELS = 20;

// =============================================================================
// Poseidon Hash (circomlibjs)
// =============================================================================

/**
 * Poseidon hash function instance from circomlibjs
 */
let poseidonFn: ((inputs: bigint[]) => bigint) | null = null;
let poseidonInitialized = false;
let poseidonInitializing = false;
let poseidonInitPromise: Promise<void> | null = null;

/**
 * Initialize Poseidon hash function
 */
export async function initPoseidon(): Promise<void> {
  if (poseidonInitialized) return;

  if (poseidonInitializing && poseidonInitPromise) {
    await poseidonInitPromise;
    return;
  }

  poseidonInitializing = true;

  poseidonInitPromise = (async () => {
    try {
      const circomlibjs = await import('circomlibjs');
      const poseidon = await circomlibjs.buildPoseidon();

      poseidonFn = (inputs: bigint[]): bigint => {
        const hash = poseidon(inputs);
        return poseidon.F.toObject(hash);
      };

      poseidonInitialized = true;
      console.log('[MerkleTree] Poseidon initialized from circomlibjs');
    } catch (error) {
      console.error('[MerkleTree] Failed to load circomlibjs:', error);
      throw new Error('Failed to initialize Poseidon hash function');
    }
  })();

  await poseidonInitPromise;
}

/**
 * Check if Poseidon is initialized
 */
export function isPoseidonInitialized(): boolean {
  return poseidonInitialized;
}

/**
 * Poseidon hash wrapper (1 or 2 inputs)
 * Returns string representation of the hash
 */
export function poseidonHash(inputs: string[]): string {
  if (!poseidonFn) {
    throw new Error('Poseidon not initialized. Call initPoseidon() first.');
  }

  const bigInputs = inputs.map((x) => BigInt(x));
  const result = poseidonFn(bigInputs);
  return result.toString();
}

/**
 * Hash two values (for Merkle tree nodes)
 */
export function hashLeftRight(left: string, right: string): string {
  return poseidonHash([left, right]);
}

/**
 * Poseidon hash returning BigInt (for internal use)
 */
export function poseidonHashBigInt(inputs: bigint[]): bigint {
  if (!poseidonFn) {
    throw new Error('Poseidon not initialized. Call initPoseidon() first.');
  }
  return poseidonFn(inputs);
}

// =============================================================================
// Zero Values Computation
// =============================================================================

let zeroValuesCache: string[] | null = null;

/**
 * Compute zero values for each level of the tree
 * zeros[0] = ZERO_VALUE (empty leaf)
 * zeros[i] = Poseidon(zeros[i-1], zeros[i-1])
 */
function computeZeroValues(levels: number): string[] {
  if (zeroValuesCache && zeroValuesCache.length > levels) {
    return zeroValuesCache.slice(0, levels + 1);
  }

  const zeros: string[] = new Array(levels + 1);
  zeros[0] = ZERO_VALUE.toString();

  for (let i = 1; i <= levels; i++) {
    zeros[i] = hashLeftRight(zeros[i - 1], zeros[i - 1]);
  }

  zeroValuesCache = zeros;
  return zeros;
}

// =============================================================================
// Merkle Tree Class
// =============================================================================

/**
 * Merkle Tree for the ZK Privacy Pool
 *
 * Implements a sparse Merkle tree where:
 * - Leaves are commitments (Poseidon(nullifier, secret))
 * - Non-inserted leaves use precomputed "zero" values
 * - Tree is append-only (new leaves added at nextIndex)
 *
 * IMPORTANT: Call initPoseidon() before using this class!
 */
export class MerkleTree {
  private readonly levels: number;
  private zeroValues: string[];
  private readonly nodes: Map<string, string>;
  private commitments: string[];
  private nextIndex: number;

  constructor(levels: number = DEFAULT_TREE_LEVELS) {
    if (levels < 1 || levels > 32) {
      throw new Error('MerkleTree: levels must be between 1 and 32');
    }

    this.levels = levels;
    this.zeroValues = [];
    this.nodes = new Map();
    this.commitments = [];
    this.nextIndex = 0;

    // Initialize zeros if Poseidon is ready
    if (poseidonInitialized) {
      this.zeroValues = computeZeroValues(levels);
    }
  }

  /**
   * Ensure Poseidon is initialized and zero values are computed
   */
  private ensureInitialized(): void {
    if (!poseidonInitialized) {
      throw new Error('MerkleTree: Poseidon not initialized. Call initPoseidon() first.');
    }
    if (this.zeroValues.length === 0) {
      this.zeroValues = computeZeroValues(this.levels);
    }
  }

  /**
   * Get the current root of the tree
   */
  getRoot(): string {
    this.ensureInitialized();
    return this.getNode(this.levels, 0);
  }

  /**
   * Get the next available leaf index
   */
  getNextIndex(): number {
    return this.nextIndex;
  }

  /**
   * Get all commitments in the tree
   */
  getCommitments(): string[] {
    return [...this.commitments];
  }

  /**
   * Get the maximum number of leaves
   */
  getCapacity(): number {
    return 2 ** this.levels;
  }

  /**
   * Check if the tree is full
   */
  isFull(): boolean {
    return this.nextIndex >= this.getCapacity();
  }

  /**
   * Insert a new commitment (leaf) into the tree
   * @returns The leaf index where the commitment was inserted
   */
  insert(commitment: string): number {
    this.ensureInitialized();

    if (this.isFull()) {
      throw new Error('MerkleTree: tree is full');
    }

    const leafIndex = this.nextIndex;
    this.commitments.push(commitment);

    // Set the leaf node
    this.setNode(0, leafIndex, commitment);

    // Update path to root
    let currentIndex = leafIndex;
    for (let level = 0; level < this.levels; level++) {
      const isRightChild = currentIndex % 2 === 1;
      const siblingIndex = isRightChild ? currentIndex - 1 : currentIndex + 1;

      const left = isRightChild ? this.getNode(level, siblingIndex) : this.getNode(level, currentIndex);
      const right = isRightChild ? this.getNode(level, currentIndex) : this.getNode(level, siblingIndex);

      const parentIndex = Math.floor(currentIndex / 2);
      const parentHash = hashLeftRight(left, right);
      this.setNode(level + 1, parentIndex, parentHash);

      currentIndex = parentIndex;
    }

    this.nextIndex++;
    return leafIndex;
  }

  /**
   * Insert a commitment at a specific index (for rebuilding from events)
   */
  insertAt(commitment: string, leafIndex: number): void {
    this.ensureInitialized();

    // Ensure array is large enough
    while (this.commitments.length <= leafIndex) {
      this.commitments.push(ZERO_VALUE.toString());
    }

    this.commitments[leafIndex] = commitment;
    this.setNode(0, leafIndex, commitment);

    // Update path to root
    let currentIndex = leafIndex;
    for (let level = 0; level < this.levels; level++) {
      const isRightChild = currentIndex % 2 === 1;
      const siblingIndex = isRightChild ? currentIndex - 1 : currentIndex + 1;

      const left = isRightChild ? this.getNode(level, siblingIndex) : this.getNode(level, currentIndex);
      const right = isRightChild ? this.getNode(level, currentIndex) : this.getNode(level, siblingIndex);

      const parentIndex = Math.floor(currentIndex / 2);
      const parentHash = hashLeftRight(left, right);
      this.setNode(level + 1, parentIndex, parentHash);

      currentIndex = parentIndex;
    }

    if (leafIndex >= this.nextIndex) {
      this.nextIndex = leafIndex + 1;
    }
  }

  /**
   * Generate a Merkle proof for a leaf at the given index
   */
  getProof(leafIndex: number): MerkleProof {
    this.ensureInitialized();

    if (leafIndex < 0 || leafIndex >= this.nextIndex) {
      throw new Error(`MerkleTree: invalid leaf index ${leafIndex}`);
    }

    const pathElements: string[] = [];
    const pathIndices: number[] = [];

    let currentIndex = leafIndex;
    for (let level = 0; level < this.levels; level++) {
      const isRightChild = currentIndex % 2 === 1;
      const siblingIndex = isRightChild ? currentIndex - 1 : currentIndex + 1;

      pathElements.push(this.getNode(level, siblingIndex));
      pathIndices.push(isRightChild ? 1 : 0);

      currentIndex = Math.floor(currentIndex / 2);
    }

    return {
      pathElements,
      pathIndices,
      root: this.getRoot(),
      leafIndex,
    };
  }

  /**
   * Verify that a commitment exists at the given index
   */
  verify(commitment: string, proof: MerkleProof): boolean {
    this.ensureInitialized();

    let currentHash = commitment;

    for (let i = 0; i < this.levels; i++) {
      const sibling = proof.pathElements[i];
      const isRight = proof.pathIndices[i] === 1;

      if (isRight) {
        currentHash = hashLeftRight(sibling, currentHash);
      } else {
        currentHash = hashLeftRight(currentHash, sibling);
      }
    }

    return currentHash === proof.root;
  }

  /**
   * Get pool state for serialization
   */
  getPoolState(): PoolState {
    return {
      root: this.getRoot(),
      nextIndex: this.nextIndex,
      commitments: [...this.commitments],
      usedNullifiers: new Set(),
    };
  }

  /**
   * Restore tree state from stored data
   */
  static fromStoredState(state: StoredPoolState, levels: number = DEFAULT_TREE_LEVELS): MerkleTree {
    const tree = new MerkleTree(levels);

    // Re-insert all commitments to rebuild the tree
    for (const commitment of state.commitments) {
      tree.insert(commitment);
    }

    return tree;
  }

  /**
   * Export tree state for storage
   */
  toStoredState(usedNullifiers: Set<string> = new Set()): StoredPoolState {
    return {
      root: this.getRoot(),
      nextIndex: this.nextIndex,
      commitments: [...this.commitments],
      usedNullifiers: Array.from(usedNullifiers),
    };
  }

  // =========================================================================
  // Private Methods
  // =========================================================================

  /**
   * Get a node value at the specified level and index
   */
  private getNode(level: number, index: number): string {
    const key = `${level}-${index}`;
    const stored = this.nodes.get(key);
    if (stored !== undefined) {
      return stored;
    }
    // Return zero value for this level if not set
    return this.zeroValues[level];
  }

  /**
   * Set a node value at the specified level and index
   */
  private setNode(level: number, index: number, value: string): void {
    const key = `${level}-${index}`;
    this.nodes.set(key, value);
  }
}

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Generate random field element (31 bytes to stay within field)
 */
export function randomFieldElement(): string {
  const bytes = new Uint8Array(31);
  crypto.getRandomValues(bytes);

  // Convert to BigInt
  let value = BigInt(0);
  for (let i = 0; i < bytes.length; i++) {
    value = (value << BigInt(8)) | BigInt(bytes[i]);
  }

  // Ensure it's within the field
  return (value % FIELD_PRIME).toString();
}

/**
 * Compute commitment from nullifier and secret
 * commitment = Poseidon(nullifier, secret)
 */
export function computeCommitment(nullifier: string, secret: string): string {
  return poseidonHash([nullifier, secret]);
}

/**
 * Compute nullifier hash from nullifier
 * nullifierHash = Poseidon(nullifier)
 */
export function computeNullifierHash(nullifier: string): string {
  return poseidonHash([nullifier]);
}
