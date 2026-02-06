/**
 * ZK Privacy Pool Service
 *
 * Custom ZK privacy pool implementation using Circom circuits and SnarkJS.
 * Replaces the mock RAILGUN implementation with a real ZK-based privacy system.
 *
 * Architecture:
 * - Deposits: Create commitment = Poseidon(nullifier, secret), add to Merkle tree
 * - Withdrawals: Generate ZK proof of commitment ownership, reveal nullifierHash
 * - Privacy: Which commitment was spent is hidden; only nullifierHash is revealed
 *
 * Components:
 * - merkleTree.ts: Poseidon-based Merkle tree (20 levels, ~1M deposits)
 * - prover.ts: SnarkJS proof generation (Groth16)
 * - noteStorage.ts: Secure deposit note storage (Tauri keychain)
 * - indexer.ts: Event indexer for syncing on-chain state
 */

import type { Signer } from 'ethers';
import type {
  DepositNote,
  WithdrawProof,
  WithdrawCircuitInput,
  PoolState,
  ZKPoolConfig,
  ZKPoolStatus,
  DepositResult,
  WithdrawResult,
  SolidityCalldata,
} from './types';
import { ZKPoolError, ZK_POOL_ERROR_CODES, DEFAULT_ZK_POOL_CONFIG } from './types';
import {
  MerkleTree,
  randomFieldElement,
  computeCommitment,
  computeNullifierHash,
  poseidonHash,
  initPoseidon,
} from './merkleTree';
import { proverService, addressToFieldElement, amountToFieldElement } from './prover';
import { noteStorageService } from './noteStorage';
import { indexerService } from './indexer';
import {
  privacyPoolContractService,
  POOL_DENOMINATION,
} from '@services/contracts/privacyPool';

// =============================================================================
// Re-exports
// =============================================================================

export * from './types';
export { MerkleTree, poseidonHash, computeCommitment, computeNullifierHash, initPoseidon } from './merkleTree';
export { proverService, addressToFieldElement, amountToFieldElement } from './prover';
export { noteStorageService } from './noteStorage';
export { indexerService } from './indexer';
export {
  privacyPoolContractService,
  POOL_DENOMINATION,
  type PrivacyPoolConfig,
  type DepositEvent,
  type WithdrawalEvent,
  type PoolInfo,
} from '@services/contracts/privacyPool';

// =============================================================================
// ZK Pool Service
// =============================================================================

/**
 * ZK Privacy Pool Service
 *
 * Main service for interacting with the ZK privacy pool.
 * Coordinates between Merkle tree, prover, and note storage.
 */
class ZKPoolService {
  private config: ZKPoolConfig;
  private status: ZKPoolStatus = 'uninitialized';
  private merkleTree: MerkleTree;
  private usedNullifiers: Set<string> = new Set();
  private demoMode: boolean = false; // Default to real mode
  private signer: Signer | null = null;

  constructor(config?: Partial<ZKPoolConfig>) {
    this.config = { ...DEFAULT_ZK_POOL_CONFIG, ...config };
    this.merkleTree = new MerkleTree(this.config.treeLevels);
    this.demoMode = this.config.demoMode;
  }

  /**
   * Set the signer for contract interactions
   */
  setSigner(signer: Signer): void {
    this.signer = signer;
    console.log('[ZKPool] Signer set');
  }

  /**
   * Get the current signer
   */
  getSigner(): Signer | null {
    return this.signer;
  }

  // ===========================================================================
  // Initialization
  // ===========================================================================

  /**
   * Initialize the ZK Pool service
   *
   * Loads circuit artifacts, restores pool state from storage,
   * initializes contract connection, and prepares the service for use.
   */
  async initialize(): Promise<void> {
    if (this.status === 'ready') {
      console.log('[ZKPool] Already initialized');
      return;
    }

    this.status = 'initializing';

    try {
      console.log('[ZKPool] Initializing...');
      console.log(`[ZKPool] Demo mode: ${this.demoMode}`);

      // Initialize Poseidon hash function first (required for Merkle tree)
      console.log('[ZKPool] Initializing Poseidon hash function...');
      await initPoseidon();

      // Set demo mode on sub-services
      proverService.setDemoMode(this.demoMode);
      noteStorageService.setDemoMode(this.demoMode);

      // Initialize the prover
      await proverService.initialize();

      // Initialize contract service and indexer (for real mode)
      if (!this.demoMode) {
        console.log('[ZKPool] Initializing contract service...');
        await privacyPoolContractService.initialize();

        // Initialize indexer for on-chain event syncing
        console.log('[ZKPool] Initializing event indexer...');
        await indexerService.initialize();
        await indexerService.syncFromChain();
        indexerService.subscribeToDeposits();

        // Sync with on-chain state
        await this.syncWithContract();
      }

      // Restore pool state from storage
      await this.restorePoolState();

      this.status = 'ready';
      console.log('[ZKPool] Initialized successfully');
      console.log(`[ZKPool] Pool state: ${this.merkleTree.getNextIndex()} deposits, root: ${this.merkleTree.getRoot().slice(0, 16)}...`);
    } catch (error) {
      this.status = 'error';
      throw new ZKPoolError(
        ZK_POOL_ERROR_CODES.NOT_INITIALIZED,
        `Failed to initialize ZK Pool: ${error instanceof Error ? error.message : 'Unknown error'}`,
        error
      );
    }
  }

  /**
   * Sync local state with on-chain contract state
   */
  private async syncWithContract(): Promise<void> {
    try {
      const poolInfo = await privacyPoolContractService.getPoolInfo();
      console.log(`[ZKPool] On-chain state: ${poolInfo.leafCount} deposits, root: ${poolInfo.root.toString().slice(0, 16)}...`);
      console.log(`[ZKPool] Denomination: ${poolInfo.denomination / BigInt(10 ** 18)} XRP`);
    } catch (error) {
      console.warn('[ZKPool] Could not sync with contract:', error);
    }
  }

  /**
   * Get current service status
   */
  getStatus(): ZKPoolStatus {
    return this.status;
  }

  /**
   * Check if service is ready
   */
  isReady(): boolean {
    return this.status === 'ready';
  }

  // ===========================================================================
  // Demo Mode
  // ===========================================================================

  /**
   * Enable or disable demo mode
   */
  setDemoMode(enabled: boolean): void {
    this.demoMode = enabled;
    this.config.demoMode = enabled;
    proverService.setDemoMode(enabled);
    noteStorageService.setDemoMode(enabled);
    console.log(`[ZKPool] Demo mode: ${enabled ? 'enabled' : 'disabled'}`);
  }

  /**
   * Check if running in demo mode
   */
  isDemoMode(): boolean {
    return this.demoMode;
  }

  // ===========================================================================
  // Deposit Operations
  // ===========================================================================

  /**
   * Create a new deposit note
   *
   * Generates random nullifier and secret, computes commitment.
   * The note should be stored securely after on-chain deposit confirms.
   *
   * @param amount - Amount to deposit (in wei)
   * @returns The generated deposit note (not yet added to tree)
   */
  async createDepositNote(amount: bigint): Promise<DepositNote> {
    this.ensureReady();

    if (amount <= 0n) {
      throw new ZKPoolError(
        ZK_POOL_ERROR_CODES.INVALID_AMOUNT,
        'Deposit amount must be positive'
      );
    }

    // Generate random secrets
    const nullifier = randomFieldElement();
    const secret = randomFieldElement();

    // Compute commitment and nullifier hash
    const commitment = computeCommitment(nullifier, secret);
    const nullifierHash = computeNullifierHash(nullifier);

    const note: DepositNote = {
      commitment,
      nullifier,
      secret,
      nullifierHash,
      leafIndex: -1, // Not yet inserted
      amount,
      timestamp: Date.now(),
    };

    console.log(`[ZKPool] Created deposit note: ${commitment.slice(0, 16)}...`);
    return note;
  }

  /**
   * Confirm a deposit after on-chain transaction succeeds
   *
   * Adds the commitment to the Merkle tree and stores the note securely.
   *
   * @param note - The deposit note to confirm
   * @param txHash - Transaction hash of the deposit
   * @param blockNumber - Block number of the deposit
   * @returns The updated note with leaf index
   */
  async confirmDeposit(
    note: DepositNote,
    txHash?: string,
    blockNumber?: number
  ): Promise<DepositNote> {
    this.ensureReady();

    if (this.merkleTree.isFull()) {
      throw new ZKPoolError(
        ZK_POOL_ERROR_CODES.CONTRACT_ERROR,
        'Merkle tree is full, cannot accept more deposits'
      );
    }

    // Insert commitment into local Merkle tree
    // In real mode (leafIndex >= 0): use the on-chain index from Deposit event
    // In demo mode (leafIndex = -1): use next available index
    let leafIndex: number;
    if (note.leafIndex >= 0) {
      // Real mode: insert at the specific on-chain index
      this.merkleTree.insertAt(note.commitment, note.leafIndex);
      leafIndex = note.leafIndex;
    } else {
      // Demo mode: append at next available index
      leafIndex = this.merkleTree.insert(note.commitment);
    }

    // Update note with leaf index and tx info
    const confirmedNote: DepositNote = {
      ...note,
      leafIndex,
      depositTxHash: txHash,
      blockNumber,
    };

    // Store the note securely
    await noteStorageService.storeNote(confirmedNote);

    // Persist pool state
    await this.savePoolState();

    console.log(`[ZKPool] Confirmed deposit at index ${leafIndex}`);
    console.log(`[ZKPool] New root: ${this.merkleTree.getRoot().slice(0, 16)}...`);

    return confirmedNote;
  }

  /**
   * Perform a complete deposit (create note + on-chain deposit + confirm)
   *
   * In demo mode, this simulates the full deposit flow.
   * In real mode, this performs an actual on-chain deposit.
   *
   * @param amount - Amount to deposit (must match pool denomination)
   * @returns Deposit result with the created note
   */
  async deposit(amount: bigint): Promise<DepositResult> {
    try {
      // Validate amount matches denomination
      if (!this.demoMode && amount !== POOL_DENOMINATION) {
        throw new ZKPoolError(
          ZK_POOL_ERROR_CODES.INVALID_AMOUNT,
          `Deposit amount must be exactly ${POOL_DENOMINATION / BigInt(10 ** 18)} XRP (${POOL_DENOMINATION} wei)`
        );
      }

      // Create the deposit note
      const note = await this.createDepositNote(amount);

      if (this.demoMode) {
        // In demo mode, immediately confirm the deposit
        const confirmedNote = await this.confirmDeposit(
          note,
          `0x${Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join('')}`,
          Math.floor(Date.now() / 1000)
        );

        return {
          success: true,
          note: confirmedNote,
          txHash: confirmedNote.depositTxHash,
        };
      }

      // Real mode: perform on-chain deposit
      if (!this.signer) {
        throw new ZKPoolError(
          ZK_POOL_ERROR_CODES.CONTRACT_ERROR,
          'No signer set. Call setSigner() before depositing.'
        );
      }

      console.log('[ZKPool] Executing real deposit...');

      // Convert commitment to bigint for contract
      const commitmentBigInt = BigInt(note.commitment);

      // Call contract deposit
      const tx = await privacyPoolContractService.deposit(this.signer, commitmentBigInt);
      console.log(`[ZKPool] Deposit transaction sent: ${tx.hash}`);

      // Wait for confirmation
      console.log('[ZKPool] Waiting for confirmation...');
      const receipt = await tx.wait();

      if (!receipt) {
        throw new ZKPoolError(
          ZK_POOL_ERROR_CODES.CONTRACT_ERROR,
          'Transaction failed - no receipt'
        );
      }

      console.log(`[ZKPool] Deposit confirmed in block ${receipt.blockNumber}`);

      // Parse the Deposit event to get leafIndex
      let leafIndex = -1;
      for (const log of receipt.logs) {
        try {
          const parsed = privacyPoolContractService
            .getContractWithSigner(this.signer)
            .interface.parseLog({ topics: [...log.topics], data: log.data });
          if (parsed?.name === 'Deposit') {
            leafIndex = Number(parsed.args.leafIndex);
            console.log(`[ZKPool] Deposit event: leafIndex=${leafIndex}`);
            break;
          }
        } catch {
          // Not a Deposit event, continue
        }
      }

      // Immediately update the indexer's Merkle tree with the new commitment
      // This ensures getMerkleProof() works without waiting for the next poll cycle
      if (leafIndex >= 0 && indexerService.isInitialized()) {
        indexerService.insertCommitment(note.commitment, leafIndex);
      }

      // Confirm the deposit with real tx data
      const confirmedNote = await this.confirmDeposit(
        { ...note, leafIndex },
        tx.hash,
        receipt.blockNumber
      );

      return {
        success: true,
        note: confirmedNote,
        txHash: tx.hash,
      };
    } catch (error) {
      console.error('[ZKPool] Deposit failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Deposit failed',
      };
    }
  }

  // ===========================================================================
  // Withdrawal Operations
  // ===========================================================================

  /**
   * Generate a withdrawal proof for a deposit note
   *
   * @param note - The deposit note to withdraw
   * @param recipient - EVM address to receive the funds (0x-prefixed, 40 hex chars)
   * @param relayer - Relayer EVM address (use '0' for self-relay)
   * @param fee - Fee for relayer (in wei)
   * @param refund - Refund amount for gas (in wei)
   * @returns The withdrawal proof
   */
  async generateWithdrawProof(
    note: DepositNote,
    recipient: string,
    relayer: string = '0',
    fee: bigint = 0n,
    refund: bigint = 0n
  ): Promise<WithdrawProof> {
    this.ensureReady();

    // Validate recipient address (must be valid EVM address)
    if (!this.isValidEVMAddress(recipient)) {
      throw new ZKPoolError(
        ZK_POOL_ERROR_CODES.INVALID_RECIPIENT,
        `Invalid recipient address: "${recipient}". Must be a valid EVM address (0x followed by 40 hex characters).`
      );
    }

    // Validate relayer address (if not '0', must be valid EVM address)
    if (relayer !== '0' && !this.isValidEVMAddress(relayer)) {
      throw new ZKPoolError(
        ZK_POOL_ERROR_CODES.INVALID_RECIPIENT,
        `Invalid relayer address: "${relayer}". Must be '0' for self-relay or a valid EVM address.`
      );
    }

    // Validate note
    if (note.leafIndex < 0) {
      throw new ZKPoolError(
        ZK_POOL_ERROR_CODES.INVALID_NOTE,
        'Note has not been deposited (no leaf index)'
      );
    }

    // Check if already spent
    if (this.usedNullifiers.has(note.nullifierHash)) {
      throw new ZKPoolError(
        ZK_POOL_ERROR_CODES.NOTE_ALREADY_SPENT,
        'This note has already been withdrawn'
      );
    }

    // Get Merkle proof - use indexer in real mode for on-chain state
    let merkleProof;
    if (!this.demoMode && indexerService.isInitialized()) {
      console.log('[ZKPool] Getting Merkle proof from indexer (on-chain state)...');
      merkleProof = indexerService.getMerkleProof(note.leafIndex);
    } else {
      merkleProof = this.merkleTree.getProof(note.leafIndex);
    }

    // Verify the proof locally
    const isValidProof = this.merkleTree.verify(note.commitment, merkleProof);
    if (!isValidProof) {
      // In real mode, the local tree may be out of sync - try syncing
      if (!this.demoMode && indexerService.isInitialized()) {
        console.log('[ZKPool] Local proof verification failed, syncing from chain...');
        await indexerService.syncFromChain();
        merkleProof = indexerService.getMerkleProof(note.leafIndex);
      } else {
        throw new ZKPoolError(
          ZK_POOL_ERROR_CODES.MERKLE_PROOF_FAILED,
          'Merkle proof verification failed'
        );
      }
    }

    // Prepare circuit input
    const input: WithdrawCircuitInput = {
      // Private inputs
      nullifier: note.nullifier,
      secret: note.secret,
      pathElements: merkleProof.pathElements,
      pathIndices: merkleProof.pathIndices,
      // Public inputs
      root: merkleProof.root,
      nullifierHash: note.nullifierHash,
      recipient: addressToFieldElement(recipient),
      relayer: addressToFieldElement(relayer),
      fee: amountToFieldElement(fee),
      refund: amountToFieldElement(refund),
    };

    // Generate the ZK proof
    const proof = await proverService.generateWithdrawProof(input);

    console.log(`[ZKPool] Generated withdrawal proof for note ${note.commitment.slice(0, 16)}...`);
    return proof;
  }

  /**
   * Verify a withdrawal proof locally
   *
   * @param proof - The proof to verify
   * @returns True if the proof is valid
   */
  async verifyProof(proof: WithdrawProof): Promise<boolean> {
    this.ensureReady();

    // Verify using the prover service
    const isValid = await proverService.verifyProof(proof);

    // Also check that the root exists in our tree history
    const proofRoot = proof.publicSignals[0];
    const currentRoot = this.merkleTree.getRoot();

    // In production, we'd check against historical roots
    // For now, just check against current root
    const rootValid = proofRoot === currentRoot;

    if (!rootValid) {
      console.warn('[ZKPool] Proof root does not match current tree root');
    }

    return isValid && rootValid;
  }

  /**
   * Mark a nullifier as used (after successful withdrawal)
   *
   * @param nullifierHash - The nullifier hash to mark as used
   */
  async markNullifierUsed(nullifierHash: string): Promise<void> {
    this.usedNullifiers.add(nullifierHash);
    await this.savePoolState();
    console.log(`[ZKPool] Marked nullifier as used: ${nullifierHash.slice(0, 16)}...`);
  }

  /**
   * Check if a nullifier has been used
   *
   * @param nullifierHash - The nullifier hash to check
   * @returns True if the nullifier has been used
   */
  isNullifierUsed(nullifierHash: string): boolean {
    return this.usedNullifiers.has(nullifierHash);
  }

  /**
   * Perform a complete withdrawal (generate proof + on-chain withdrawal)
   *
   * In demo mode, this simulates the full withdrawal flow.
   * In real mode, this performs an actual on-chain withdrawal.
   *
   * @param note - The deposit note to withdraw
   * @param recipient - EVM address to receive the funds
   * @returns Withdrawal result with the proof
   */
  async withdraw(note: DepositNote, recipient: string): Promise<WithdrawResult> {
    try {
      // Generate the withdrawal proof
      const proof = await this.generateWithdrawProof(note, recipient);

      if (this.demoMode) {
        // In demo mode, immediately process the withdrawal
        await this.markNullifierUsed(note.nullifierHash);

        return {
          success: true,
          proof,
          txHash: `0x${Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join('')}`,
        };
      }

      // Real mode: perform on-chain withdrawal
      if (!this.signer) {
        throw new ZKPoolError(
          ZK_POOL_ERROR_CODES.CONTRACT_ERROR,
          'No signer set. Call setSigner() before withdrawing.'
        );
      }

      console.log('[ZKPool] Executing real withdrawal...');

      // Export proof to Solidity calldata format
      const calldata = await this.exportSolidityCalldata(proof);

      // Prepare proof struct for contract
      // IMPORTANT: Convert string values to BigInt for ethers.js to properly encode
      // as uint256 values. The contract expects uint256[2], uint256[2][2], uint256[2]
      const proofCalldata = {
        a: [BigInt(calldata.a[0]), BigInt(calldata.a[1])] as [bigint, bigint],
        b: [
          [BigInt(calldata.b[0][0]), BigInt(calldata.b[0][1])] as [bigint, bigint],
          [BigInt(calldata.b[1][0]), BigInt(calldata.b[1][1])] as [bigint, bigint],
        ] as [[bigint, bigint], [bigint, bigint]],
        c: [BigInt(calldata.c[0]), BigInt(calldata.c[1])] as [bigint, bigint],
      };

      // Get public inputs
      const root = BigInt(proof.publicSignals[0]);
      const nullifierHash = BigInt(proof.publicSignals[1]);

      // Call contract withdraw
      const tx = await privacyPoolContractService.withdraw(
        this.signer,
        proofCalldata,
        root,
        nullifierHash,
        recipient,
        '0x0000000000000000000000000000000000000000', // No relayer
        0n, // No fee
        0n  // No refund
      );

      console.log(`[ZKPool] Withdrawal transaction sent: ${tx.hash}`);

      // Wait for confirmation
      console.log('[ZKPool] Waiting for confirmation...');
      const receipt = await tx.wait();

      if (!receipt) {
        throw new ZKPoolError(
          ZK_POOL_ERROR_CODES.CONTRACT_ERROR,
          'Withdrawal transaction failed - no receipt'
        );
      }

      console.log(`[ZKPool] Withdrawal confirmed in block ${receipt.blockNumber}`);

      // Mark nullifier as used locally
      await this.markNullifierUsed(note.nullifierHash);

      return {
        success: true,
        proof,
        txHash: tx.hash,
      };
    } catch (error) {
      console.error('[ZKPool] Withdrawal failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Withdrawal failed',
      };
    }
  }

  /**
   * Export proof as Solidity calldata
   *
   * @param proof - The proof to export
   * @returns Solidity-compatible calldata
   */
  async exportSolidityCalldata(proof: WithdrawProof): Promise<SolidityCalldata> {
    return proverService.exportSolidityCalldata(proof);
  }

  // ===========================================================================
  // Pool State
  // ===========================================================================

  /**
   * Get current pool state
   */
  getPoolState(): PoolState {
    return {
      ...this.merkleTree.getPoolState(),
      usedNullifiers: new Set(this.usedNullifiers),
    };
  }

  /**
   * Get current Merkle root
   */
  getRoot(): string {
    return this.merkleTree.getRoot();
  }

  /**
   * Get next available leaf index
   */
  getNextIndex(): number {
    return this.merkleTree.getNextIndex();
  }

  /**
   * Get all commitments in the tree
   */
  getCommitments(): string[] {
    return this.merkleTree.getCommitments();
  }

  /**
   * Get tree capacity (max deposits)
   */
  getCapacity(): number {
    return this.merkleTree.getCapacity();
  }

  // ===========================================================================
  // Note Management
  // ===========================================================================

  /**
   * Get all stored deposit notes
   */
  async getAllNotes(): Promise<DepositNote[]> {
    return noteStorageService.getAllNotes();
  }

  /**
   * Get a specific note by commitment
   */
  async getNote(commitment: string): Promise<DepositNote | null> {
    return noteStorageService.getNote(commitment);
  }

  /**
   * Get unspent notes (not yet withdrawn)
   */
  async getUnspentNotes(): Promise<DepositNote[]> {
    const allNotes = await this.getAllNotes();
    return allNotes.filter((note) => !this.usedNullifiers.has(note.nullifierHash));
  }

  /**
   * Get spent notes (already withdrawn)
   */
  async getSpentNotes(): Promise<DepositNote[]> {
    const allNotes = await this.getAllNotes();
    return allNotes.filter((note) => this.usedNullifiers.has(note.nullifierHash));
  }

  /**
   * Get total balance across all unspent notes
   */
  async getTotalBalance(): Promise<bigint> {
    const unspent = await this.getUnspentNotes();
    return unspent.reduce((sum, note) => sum + note.amount, 0n);
  }

  // ===========================================================================
  // Cleanup
  // ===========================================================================

  /**
   * Clear all data and reset to initial state
   *
   * WARNING: This is destructive!
   */
  async reset(): Promise<void> {
    await noteStorageService.clearAll();
    this.merkleTree = new MerkleTree(this.config.treeLevels);
    this.usedNullifiers.clear();
    console.log('[ZKPool] Service reset');
  }

  /**
   * Cleanup resources
   */
  cleanup(): void {
    indexerService.cleanup();
    privacyPoolContractService.removeAllListeners();
    this.status = 'uninitialized';
    console.log('[ZKPool] Cleanup complete');
  }

  // ===========================================================================
  // Private Methods
  // ===========================================================================

  /**
   * Ensure service is ready
   */
  private ensureReady(): void {
    if (this.status !== 'ready') {
      throw new ZKPoolError(
        ZK_POOL_ERROR_CODES.NOT_INITIALIZED,
        'ZK Pool service not initialized. Call initialize() first.'
      );
    }
  }

  /**
   * Validate EVM address format
   * @param address - Address to validate
   * @returns True if valid EVM address (0x followed by 40 hex chars)
   */
  private isValidEVMAddress(address: string): boolean {
    if (!address || typeof address !== 'string') {
      return false;
    }
    // EVM address: 0x followed by exactly 40 hexadecimal characters
    const evmAddressRegex = /^0x[a-fA-F0-9]{40}$/;
    return evmAddressRegex.test(address);
  }

  /**
   * Restore pool state from storage
   */
  private async restorePoolState(): Promise<void> {
    const storedState = await noteStorageService.getPoolState();

    if (storedState) {
      // Restore Merkle tree
      this.merkleTree = MerkleTree.fromStoredState(storedState, this.config.treeLevels);

      // Restore used nullifiers
      this.usedNullifiers = new Set(storedState.usedNullifiers);

      console.log(`[ZKPool] Restored pool state with ${storedState.commitments.length} deposits`);
    } else {
      console.log('[ZKPool] No stored pool state, starting fresh');
    }
  }

  /**
   * Save pool state to storage
   */
  private async savePoolState(): Promise<void> {
    const state = this.merkleTree.toStoredState(this.usedNullifiers);
    await noteStorageService.storePoolState(state);
  }
}

// =============================================================================
// Export
// =============================================================================

/** Singleton instance */
export const zkPoolService = new ZKPoolService();

/** Export class for testing */
export { ZKPoolService };

// =============================================================================
// Utility Exports
// =============================================================================

export const zkPoolUtils = {
  /**
   * Compute commitment from nullifier and secret
   */
  computeCommitment,

  /**
   * Compute nullifier hash from nullifier
   */
  computeNullifierHash,

  /**
   * Generate random field element
   */
  randomFieldElement,

  /**
   * Convert address to field element for circuit input
   */
  addressToFieldElement,

  /**
   * Convert amount to field element for circuit input
   */
  amountToFieldElement,

  /**
   * Poseidon hash (1 or 2 inputs)
   */
  poseidonHash,

  /**
   * Format amount in wei to human-readable
   */
  formatAmount: (amount: bigint, decimals: number = 18): string => {
    const divisor = 10n ** BigInt(decimals);
    const intPart = amount / divisor;
    const fracPart = amount % divisor;
    const fracStr = fracPart.toString().padStart(decimals, '0').slice(0, 6);
    return `${intPart}.${fracStr}`;
  },

  /**
   * Parse human-readable amount to wei
   */
  parseAmount: (amount: string, decimals: number = 18): bigint => {
    const [intPart, fracPart = '0'] = amount.split('.');
    const paddedFrac = fracPart.padEnd(decimals, '0').slice(0, decimals);
    return BigInt(intPart) * 10n ** BigInt(decimals) + BigInt(paddedFrac);
  },
};
