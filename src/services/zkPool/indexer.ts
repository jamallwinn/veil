/**
 * Event Indexer Service
 *
 * Indexes Deposit events from the PrivacyPool contract to maintain
 * a local copy of the Merkle tree state. This allows generating
 * valid Merkle proofs for withdrawals.
 *
 * Features:
 * - Syncs historical Deposit events on startup
 * - Subscribes to live Deposit events
 * - Rebuilds Merkle tree from events
 * - Provides Merkle proofs for withdrawal
 */

import { ethers } from 'ethers';
import type { MerkleProof } from './types';

// =============================================================================
// Constants
// =============================================================================

/** XRPL EVM Mainnet configuration */
const XRPL_EVM_CONFIG = {
  chainId: 1440000,
  rpcUrl: 'https://rpc.xrplevm.org',
  // PrivacyPoolNative contract - accepts native XRP (1 XRP denomination)
  // Must match the address in src/services/contracts/privacyPool.ts
  privacyPoolAddress: '0xf765F2A56EF0f6d09438E2113a2FC9932b9645bB',
  // Contract deployment block - must be BEFORE first deposit
  // Deposits found at blocks 4303189, 4303288
  deploymentBlock: 4300000,
};

/** Merkle tree levels (must match contract) */
const TREE_LEVELS = 20;

/** BN128 field prime (for Poseidon) */
const FIELD_PRIME = BigInt(
  '21888242871839275222246405745257275088548364400416034343698204186575808495617'
);

/** Zero value for empty leaves (keccak256("veil") % FIELD_PRIME) - matches contract */
const ZERO_VALUE = BigInt(ethers.keccak256(ethers.toUtf8Bytes('veil'))) % FIELD_PRIME;

/** PrivacyPool ABI (only what we need) */
const PRIVACY_POOL_ABI = [
  'event Deposit(uint256 indexed commitment, uint32 indexed leafIndex, uint256 timestamp)',
  'function currentRoot() external view returns (uint256)',
  'function nextLeafIndex() external view returns (uint32)',
  'function isKnownRoot(uint256 _root) external view returns (bool)',
  'function getRoot() external view returns (uint256)',
  'function getLeafCount() external view returns (uint32)',
];

// =============================================================================
// Types
// =============================================================================

interface DepositEvent {
  commitment: string;
  leafIndex: number;
  timestamp: number;
  blockNumber: number;
  transactionHash: string;
}

interface IndexerState {
  commitments: string[];
  lastBlockSynced: number;
  root: string;
}

type DepositCallback = (event: DepositEvent) => void;

// =============================================================================
// Poseidon Hash (using circomlibjs)
// =============================================================================

let poseidonInstance: ((inputs: bigint[]) => bigint) | null = null;

/**
 * Initialize Poseidon hash function from circomlibjs
 */
async function initPoseidon(): Promise<void> {
  if (poseidonInstance) return;

  try {
    // Dynamic import circomlibjs
    const circomlibjs = await import('circomlibjs');
    const poseidon = await circomlibjs.buildPoseidon();

    // Wrapper that returns BigInt
    poseidonInstance = (inputs: bigint[]): bigint => {
      const hash = poseidon(inputs);
      // poseidon returns F element, convert to BigInt
      return poseidon.F.toObject(hash);
    };

    console.log('[Indexer] Poseidon initialized from circomlibjs');
  } catch (error) {
    console.error('[Indexer] Failed to load circomlibjs:', error);
    throw new Error('Failed to initialize Poseidon hash function');
  }
}

/**
 * Poseidon hash of two values (for Merkle tree nodes)
 */
function poseidonHash2(left: bigint, right: bigint): bigint {
  if (!poseidonInstance) {
    throw new Error('Poseidon not initialized. Call initPoseidon() first.');
  }
  return poseidonInstance([left, right]);
}

// =============================================================================
// Merkle Tree (Indexer's Local Copy)
// =============================================================================

/**
 * Compute zero values for each level of the tree
 * zeros[0] = ZERO_VALUE (empty leaf)
 * zeros[i] = Poseidon(zeros[i-1], zeros[i-1])
 */
function computeZeroValues(): bigint[] {
  const zeros: bigint[] = new Array(TREE_LEVELS + 1);
  zeros[0] = ZERO_VALUE;

  for (let i = 1; i <= TREE_LEVELS; i++) {
    zeros[i] = poseidonHash2(zeros[i - 1], zeros[i - 1]);
  }

  return zeros;
}

/**
 * IndexerMerkleTree - mirrors the on-chain Merkle tree
 */
class IndexerMerkleTree {
  private zeros: bigint[];
  private nodes: Map<string, bigint>;
  private commitments: bigint[];
  private nextIndex: number;

  constructor() {
    this.zeros = [];
    this.nodes = new Map();
    this.commitments = [];
    this.nextIndex = 0;
  }

  /**
   * Initialize tree (must call after Poseidon is ready)
   */
  initialize(): void {
    this.zeros = computeZeroValues();
    this.nodes = new Map();
    this.commitments = [];
    this.nextIndex = 0;
  }

  /**
   * Insert a commitment at a specific index
   */
  insert(commitment: bigint, leafIndex: number): void {
    // Ensure array is large enough
    while (this.commitments.length <= leafIndex) {
      this.commitments.push(ZERO_VALUE);
    }

    this.commitments[leafIndex] = commitment;
    this.setNode(0, leafIndex, commitment);

    // Update path to root
    let currentIndex = leafIndex;
    for (let level = 0; level < TREE_LEVELS; level++) {
      const isRightChild = currentIndex % 2 === 1;
      const siblingIndex = isRightChild ? currentIndex - 1 : currentIndex + 1;

      const left = isRightChild ? this.getNode(level, siblingIndex) : this.getNode(level, currentIndex);
      const right = isRightChild ? this.getNode(level, currentIndex) : this.getNode(level, siblingIndex);

      const parentIndex = Math.floor(currentIndex / 2);
      const parentHash = poseidonHash2(left, right);
      this.setNode(level + 1, parentIndex, parentHash);

      currentIndex = parentIndex;
    }

    if (leafIndex >= this.nextIndex) {
      this.nextIndex = leafIndex + 1;
    }
  }

  /**
   * Get current root
   */
  getRoot(): bigint {
    return this.getNode(TREE_LEVELS, 0);
  }

  /**
   * Get root as string
   */
  getRootString(): string {
    return this.getRoot().toString();
  }

  /**
   * Get Merkle proof for a leaf
   */
  getMerkleProof(leafIndex: number): MerkleProof {
    if (leafIndex < 0 || leafIndex >= this.nextIndex) {
      throw new Error(`Invalid leaf index: ${leafIndex}`);
    }

    const pathElements: string[] = [];
    const pathIndices: number[] = [];

    let currentIndex = leafIndex;
    for (let level = 0; level < TREE_LEVELS; level++) {
      const isRightChild = currentIndex % 2 === 1;
      const siblingIndex = isRightChild ? currentIndex - 1 : currentIndex + 1;

      pathElements.push(this.getNode(level, siblingIndex).toString());
      pathIndices.push(isRightChild ? 1 : 0);

      currentIndex = Math.floor(currentIndex / 2);
    }

    return {
      pathElements,
      pathIndices,
      root: this.getRootString(),
      leafIndex,
    };
  }

  /**
   * Get number of leaves
   */
  getLeafCount(): number {
    return this.nextIndex;
  }

  /**
   * Get all commitments
   */
  getCommitments(): string[] {
    return this.commitments.map((c) => c.toString());
  }

  private getNode(level: number, index: number): bigint {
    const key = `${level}-${index}`;
    const stored = this.nodes.get(key);
    if (stored !== undefined) {
      return stored;
    }
    return this.zeros[level];
  }

  private setNode(level: number, index: number, value: bigint): void {
    const key = `${level}-${index}`;
    this.nodes.set(key, value);
  }
}

// =============================================================================
// Event Indexer Service
// =============================================================================

/**
 * EventIndexerService
 *
 * Maintains local Merkle tree state by indexing on-chain Deposit events.
 */
class EventIndexerService {
  private provider: ethers.JsonRpcProvider | null = null;
  private contract: ethers.Contract | null = null;
  private tree: IndexerMerkleTree;
  private depositCallbacks: DepositCallback[] = [];
  private lastBlockSynced: number = 0;
  private initialized: boolean = false;
  private syncing: boolean = false;
  /** Re-subscription retry state */
  private subscriptionActive: boolean = false;
  private resubscribeTimeout: ReturnType<typeof setTimeout> | null = null;
  private resubscribeAttempts: number = 0;
  private static readonly MAX_RESUBSCRIBE_ATTEMPTS = 5;

  constructor() {
    this.tree = new IndexerMerkleTree();
  }

  /**
   * Initialize the indexer
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      console.log('[Indexer] Already initialized');
      return;
    }

    try {
      console.log('[Indexer] Initializing...');

      // Initialize Poseidon
      await initPoseidon();

      // Initialize tree
      this.tree.initialize();

      // Connect to XRPL EVM
      this.provider = new ethers.JsonRpcProvider(XRPL_EVM_CONFIG.rpcUrl);

      // Verify connection
      const network = await this.provider.getNetwork();
      console.log(`[Indexer] Connected to chain ${network.chainId}`);

      // Create contract instance
      this.contract = new ethers.Contract(
        XRPL_EVM_CONFIG.privacyPoolAddress,
        PRIVACY_POOL_ABI,
        this.provider
      );

      this.initialized = true;
      console.log('[Indexer] Initialized successfully');
    } catch (error) {
      console.error('[Indexer] Initialization failed:', error);
      throw error;
    }
  }

  /**
   * Check if initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Sync all historical Deposit events from chain
   */
  async syncFromChain(): Promise<void> {
    if (!this.initialized || !this.contract || !this.provider) {
      throw new Error('Indexer not initialized');
    }

    if (this.syncing) {
      console.log('[Indexer] Already syncing...');
      return;
    }

    this.syncing = true;

    try {
      console.log('[Indexer] Starting sync from chain...');

      // Get current block
      const currentBlock = await this.provider.getBlockNumber();

      // Query all Deposit events from contract creation
      // Start from deployment block to avoid scanning millions of blocks
      // XRPL EVM requires block height > 0
      const fromBlock = this.lastBlockSynced || XRPL_EVM_CONFIG.deploymentBlock;

      console.log(`[Indexer] Querying events from block ${fromBlock} to ${currentBlock}`);

      // Query in chunks to avoid RPC limits
      const CHUNK_SIZE = 10000;
      let start = fromBlock;

      while (start <= currentBlock) {
        const end = Math.min(start + CHUNK_SIZE - 1, currentBlock);

        const filter = this.contract.filters.Deposit();
        const events = await this.contract.queryFilter(filter, start, end);

        for (const event of events) {
          const log = event as ethers.EventLog;
          const commitment = log.args[0].toString();
          const leafIndex = Number(log.args[1]);
          const timestamp = Number(log.args[2]);

          // Insert into local tree
          this.tree.insert(BigInt(commitment), leafIndex);

          // Notify callbacks
          const depositEvent: DepositEvent = {
            commitment,
            leafIndex,
            timestamp,
            blockNumber: log.blockNumber,
            transactionHash: log.transactionHash,
          };

          this.depositCallbacks.forEach((cb) => cb(depositEvent));
        }

        if (events.length > 0) {
          console.log(`[Indexer] Processed ${events.length} events from blocks ${start}-${end}`);
        }

        start = end + 1;
      }

      this.lastBlockSynced = currentBlock;

      // Verify root matches on-chain
      const onChainRoot = await this.contract.getRoot();
      const localRoot = this.tree.getRoot();

      if (onChainRoot.toString() !== localRoot.toString()) {
        console.warn('[Indexer] Root mismatch!');
        console.warn(`[Indexer] On-chain: ${onChainRoot.toString()}`);
        console.warn(`[Indexer] Local: ${localRoot.toString()}`);
      } else {
        console.log(`[Indexer] Root verified: ${localRoot.toString().slice(0, 20)}...`);
      }

      console.log(`[Indexer] Sync complete. ${this.tree.getLeafCount()} deposits indexed.`);
    } finally {
      this.syncing = false;
    }
  }

  /** Polling interval for manual event polling (5 minutes - before filter expires) */
  private static readonly POLL_INTERVAL_MS = 4 * 60 * 1000; // 4 minutes
  private pollInterval: ReturnType<typeof setInterval> | null = null;

  /**
   * Subscribe to live Deposit events with automatic re-subscription on filter expiration
   *
   * XRPL EVM RPC nodes expire event filters after ~5 minutes of inactivity.
   * Instead of relying on ethers.js event subscriptions (which use filters that expire),
   * we use manual polling to check for new events periodically.
   */
  subscribeToDeposits(): void {
    if (!this.initialized || !this.contract) {
      throw new Error('Indexer not initialized');
    }

    // Prevent duplicate subscriptions
    if (this.subscriptionActive) {
      console.log('[Indexer] Already subscribed to Deposit events');
      return;
    }

    this.subscriptionActive = true;
    this.resubscribeAttempts = 0;
    this.setupDepositPolling();
  }

  /**
   * Set up polling-based event watching
   *
   * ethers.js v6 JsonRpcProvider uses eth_newFilter + eth_getFilterChanges for event
   * subscriptions. XRPL EVM nodes expire these filters after ~5 minutes, causing
   * "filter not found" errors. The provider.on('error') handler never receives these
   * errors because they occur inside the polling loop and are only logged.
   *
   * Solution: Use manual polling with queryFilter instead of event subscriptions.
   * This avoids filter creation entirely and is more reliable for HTTP JSON-RPC.
   */
  private setupDepositPolling(): void {
    if (!this.contract || !this.provider) {
      console.error('[Indexer] Cannot setup polling: contract or provider not available');
      return;
    }

    console.log('[Indexer] Setting up Deposit event polling...');

    // Poll for new events periodically
    this.pollInterval = setInterval(async () => {
      await this.pollForNewDeposits();
    }, EventIndexerService.POLL_INTERVAL_MS);

    // Also poll immediately once
    this.pollForNewDeposits().catch((error) => {
      console.error('[Indexer] Initial poll failed:', error);
    });

    console.log(`[Indexer] Polling for Deposit events every ${EventIndexerService.POLL_INTERVAL_MS / 1000}s`);
  }

  /**
   * Poll for new deposit events since last synced block
   */
  private async pollForNewDeposits(): Promise<void> {
    if (!this.contract || !this.provider) {
      return;
    }

    try {
      const currentBlock = await this.provider.getBlockNumber();

      // Only query if there are new blocks
      if (currentBlock <= this.lastBlockSynced) {
        return;
      }

      const fromBlock = this.lastBlockSynced + 1;
      console.log(`[Indexer] Polling for deposits from block ${fromBlock} to ${currentBlock}`);

      const filter = this.contract.filters.Deposit();
      const events = await this.contract.queryFilter(filter, fromBlock, currentBlock);

      for (const event of events) {
        const log = event as ethers.EventLog;
        const commitment = log.args[0];
        const leafIndex = Number(log.args[1]);
        const timestamp = Number(log.args[2]);

        console.log(`[Indexer] New deposit: index=${leafIndex}, commitment=${commitment.toString().slice(0, 20)}...`);

        // Insert into local tree
        this.tree.insert(commitment, leafIndex);

        // Notify callbacks
        const depositEvent: DepositEvent = {
          commitment: commitment.toString(),
          leafIndex,
          timestamp,
          blockNumber: log.blockNumber,
          transactionHash: log.transactionHash,
        };

        this.depositCallbacks.forEach((cb) => cb(depositEvent));
      }

      this.lastBlockSynced = currentBlock;

      // Reset retry counter on successful poll
      this.resubscribeAttempts = 0;

      if (events.length > 0) {
        console.log(`[Indexer] Processed ${events.length} new deposit(s)`);
      }
    } catch (error) {
      console.error('[Indexer] Poll failed:', error);
      this.handlePollError(error);
    }
  }

  /**
   * Handle polling errors with retry logic
   */
  private handlePollError(_error: unknown): void {
    this.resubscribeAttempts++;

    if (this.resubscribeAttempts >= EventIndexerService.MAX_RESUBSCRIBE_ATTEMPTS) {
      console.error(`[Indexer] Max poll retry attempts (${EventIndexerService.MAX_RESUBSCRIBE_ATTEMPTS}) reached`);
      // Stop polling but allow manual restart
      if (this.pollInterval) {
        clearInterval(this.pollInterval);
        this.pollInterval = null;
      }
      this.subscriptionActive = false;
    }
  }

  /**
   * Restart polling after failure
   * Uses exponential backoff for retry delays
   */
  restartPolling(): void {
    if (this.subscriptionActive) {
      console.log('[Indexer] Polling already active');
      return;
    }

    console.log('[Indexer] Restarting deposit polling...');
    this.subscriptionActive = true;
    this.resubscribeAttempts = 0;
    this.setupDepositPolling();
  }

  /**
   * Register callback for deposit events
   */
  onDeposit(callback: DepositCallback): void {
    this.depositCallbacks.push(callback);
  }

  /**
   * Remove deposit callback
   */
  offDeposit(callback: DepositCallback): void {
    const index = this.depositCallbacks.indexOf(callback);
    if (index !== -1) {
      this.depositCallbacks.splice(index, 1);
    }
  }

  /**
   * Insert a commitment into the local Merkle tree
   *
   * This should be called when we receive a deposit event directly (e.g., from
   * our own transaction) rather than waiting for the next poll cycle.
   *
   * @param commitment - The commitment to insert (as string or bigint)
   * @param leafIndex - The leaf index from the Deposit event
   */
  insertCommitment(commitment: string | bigint, leafIndex: number): void {
    if (!this.initialized) {
      throw new Error('Indexer not initialized');
    }

    const commitmentBigInt = typeof commitment === 'string' ? BigInt(commitment) : commitment;
    this.tree.insert(commitmentBigInt, leafIndex);

    console.log(`[Indexer] Inserted commitment at index ${leafIndex}: ${commitmentBigInt.toString().slice(0, 20)}...`);
  }

  /**
   * Get Merkle proof for a leaf
   */
  getMerkleProof(leafIndex: number): MerkleProof {
    if (!this.initialized) {
      throw new Error('Indexer not initialized');
    }
    return this.tree.getMerkleProof(leafIndex);
  }

  /**
   * Get current Merkle root
   */
  getRoot(): string {
    if (!this.initialized) {
      throw new Error('Indexer not initialized');
    }
    return this.tree.getRootString();
  }

  /**
   * Get leaf count
   */
  getLeafCount(): number {
    if (!this.initialized) {
      return 0;
    }
    return this.tree.getLeafCount();
  }

  /**
   * Get all commitments
   */
  getCommitments(): string[] {
    if (!this.initialized) {
      return [];
    }
    return this.tree.getCommitments();
  }

  /**
   * Check if a root is valid (by querying contract)
   */
  async isKnownRoot(root: string): Promise<boolean> {
    if (!this.contract) {
      throw new Error('Indexer not initialized');
    }
    return this.contract.isKnownRoot(root);
  }

  /**
   * Get indexer state for persistence
   */
  getState(): IndexerState {
    return {
      commitments: this.tree.getCommitments(),
      lastBlockSynced: this.lastBlockSynced,
      root: this.tree.getRootString(),
    };
  }

  /**
   * Restore state from persistence
   */
  restoreState(state: IndexerState): void {
    if (!this.initialized) {
      throw new Error('Indexer not initialized');
    }

    // Re-insert all commitments
    for (let i = 0; i < state.commitments.length; i++) {
      this.tree.insert(BigInt(state.commitments[i]), i);
    }

    this.lastBlockSynced = state.lastBlockSynced;

    console.log(`[Indexer] Restored ${state.commitments.length} commitments from state`);
  }

  /**
   * Get provider for external use
   */
  getProvider(): ethers.JsonRpcProvider | null {
    return this.provider;
  }

  /**
   * Get contract address
   */
  getContractAddress(): string {
    return XRPL_EVM_CONFIG.privacyPoolAddress;
  }

  /**
   * Cleanup
   */
  cleanup(): void {
    // Clear polling interval
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }

    // Clear re-subscribe timeout
    if (this.resubscribeTimeout) {
      clearTimeout(this.resubscribeTimeout);
      this.resubscribeTimeout = null;
    }

    // Remove all listeners (in case any were attached)
    if (this.contract) {
      this.contract.removeAllListeners();
    }
    if (this.provider) {
      this.provider.removeAllListeners();
    }

    // Reset state
    this.depositCallbacks = [];
    this.initialized = false;
    this.subscriptionActive = false;
    this.resubscribeAttempts = 0;
    console.log('[Indexer] Cleanup complete');
  }
}

// =============================================================================
// Exports
// =============================================================================

/** Singleton instance */
export const indexerService = new EventIndexerService();

/** Export class for testing */
export { EventIndexerService };

/** Export types */
export type { DepositEvent, IndexerState, DepositCallback };

/** Export constants for use elsewhere */
export { ZERO_VALUE, TREE_LEVELS, FIELD_PRIME, XRPL_EVM_CONFIG };

/** Export Poseidon utilities */
export { initPoseidon, poseidonHash2 };
