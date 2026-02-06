/**
 * USDC ZK Privacy Pool Service
 *
 * Custom ZK privacy pool implementation for USDC on XRPL EVM.
 * Uses the same Circom circuits and SnarkJS prover as XRP pool,
 * but with USDC-specific token handling.
 *
 * KEY DIFFERENCE from XRP Pool:
 * - Requires ERC-20 approval before deposit
 * - Uses USDC token contract instead of native XRP
 * - 15 decimals (USDC on EVM) vs 18 decimals (native XRP)
 * - Different pool denomination (3 USDC vs 1 XRP)
 *
 * Architecture:
 * - Deposits: Approve USDC -> Create commitment = Poseidon(nullifier, secret) -> Deposit
 * - Withdrawals: Generate ZK proof -> Contract transfers USDC to recipient
 *
 * @see /src/services/zkPool/index.ts for XRP pool (reference implementation)
 */

import {
  Contract,
  JsonRpcProvider,
  type Signer,
  type ContractTransactionResponse,
  formatUnits,
} from 'ethers';

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
  initPoseidon,
} from './merkleTree';
import { proverService, addressToFieldElement, amountToFieldElement } from './prover';
import { noteStorageService } from './noteStorage';

import {
  USDC_TOKEN_ADDRESS,
  USDC_DECIMALS,
  USDC_POOL_DENOMINATION,
  USDC_PRIVACY_POOL_ADDRESS,
  USDC_ERC20_ABI,
  USDC_NETWORK_CONFIG,
} from '@constants/usdc';

// =============================================================================
// Re-exports
// =============================================================================

export * from './types';
export { MerkleTree, computeCommitment, computeNullifierHash, initPoseidon } from './merkleTree';
export { proverService, addressToFieldElement, amountToFieldElement } from './prover';

// =============================================================================
// Contract ABI (for USDC PrivacyPool - ERC-20 version)
// =============================================================================

const USDC_PRIVACY_POOL_ABI = [
  // Deposit function (no payable - uses ERC20 transferFrom)
  'function deposit(uint256 _commitment) external',

  // Withdraw function
  'function withdraw((uint256[2] a, uint256[2][2] b, uint256[2] c) _proof, uint256 _root, uint256 _nullifierHash, address _recipient, address _relayer, uint256 _fee, uint256 _refund) external',

  // View functions
  'function isKnownRoot(uint256 _root) external view returns (bool)',
  'function getRoot() external view returns (uint256)',
  'function getLeafCount() external view returns (uint32)',
  'function isSpent(uint256 _nullifierHash) external view returns (bool)',
  'function isCommitmentExists(uint256 _commitment) external view returns (bool)',
  'function denomination() external view returns (uint256)',
  'function verifier() external view returns (address)',
  'function token() external view returns (address)',
  'function getPoolInfo() external view returns (uint256 _denomination, address _tokenAddress, address _verifierAddress, uint32 _leafCount, uint256 _root)',

  // Events
  'event Deposit(uint256 indexed commitment, uint32 indexed leafIndex, uint256 timestamp)',
  'event Withdrawal(address indexed recipient, uint256 indexed nullifierHash, address indexed relayer, uint256 fee)',
];

// =============================================================================
// Types
// =============================================================================

export interface USDCPoolConfig extends ZKPoolConfig {
  tokenAddress: string;
  poolAddress: string;
  rpcUrl: string;
  chainId: number;
}

export interface USDCPoolInfo {
  denomination: bigint;
  tokenAddress: string;
  verifierAddress: string;
  leafCount: number;
  root: bigint;
}

export interface ApprovalStatus {
  allowance: bigint;
  needsApproval: boolean;
  requiredAmount: bigint;
}

export interface USDCDepositEvent {
  commitment: bigint;
  leafIndex: number;
  timestamp: bigint;
  transactionHash: string;
  blockNumber: number;
}

// =============================================================================
// Default Configuration
// =============================================================================

const DEFAULT_USDC_POOL_CONFIG: USDCPoolConfig = {
  ...DEFAULT_ZK_POOL_CONFIG,
  tokenAddress: USDC_TOKEN_ADDRESS,
  poolAddress: USDC_PRIVACY_POOL_ADDRESS,
  rpcUrl: USDC_NETWORK_CONFIG.MAINNET.rpcUrl,
  chainId: USDC_NETWORK_CONFIG.MAINNET.chainId,
};

// =============================================================================
// USDC ZK Pool Service
// =============================================================================

class USDCZKPoolService {
  private config: USDCPoolConfig;
  private status: ZKPoolStatus = 'uninitialized';
  private merkleTree: MerkleTree;
  private usedNullifiers: Set<string> = new Set();
  private demoMode: boolean = false;
  private signer: Signer | null = null;
  private provider: JsonRpcProvider | null = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private poolContract: any = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private tokenContract: any = null;

  constructor(config?: Partial<USDCPoolConfig>) {
    this.config = { ...DEFAULT_USDC_POOL_CONFIG, ...config };
    this.merkleTree = new MerkleTree(this.config.treeLevels);
    this.demoMode = this.config.demoMode;
  }

  // ===========================================================================
  // Signer Management
  // ===========================================================================

  setSigner(signer: Signer): void {
    this.signer = signer;
    console.log('[USDCZKPool] Signer set');
  }

  getSigner(): Signer | null {
    return this.signer;
  }

  // ===========================================================================
  // Initialization
  // ===========================================================================

  async initialize(): Promise<void> {
    if (this.status === 'ready') {
      console.log('[USDCZKPool] Already initialized');
      return;
    }

    this.status = 'initializing';

    try {
      console.log('[USDCZKPool] Initializing...');
      console.log(`[USDCZKPool] Demo mode: ${this.demoMode}`);

      // Initialize Poseidon hash function
      console.log('[USDCZKPool] Initializing Poseidon hash function...');
      await initPoseidon();

      // Set demo mode on sub-services
      proverService.setDemoMode(this.demoMode);
      noteStorageService.setDemoMode(this.demoMode);

      // Initialize the prover
      await proverService.initialize();

      // Initialize contracts (for real mode)
      if (!this.demoMode) {
        await this.initializeContracts();
        await this.syncWithContract();
      }

      // Restore pool state from storage
      await this.restorePoolState();

      this.status = 'ready';
      console.log('[USDCZKPool] Initialized successfully');
      console.log(`[USDCZKPool] Pool state: ${this.merkleTree.getNextIndex()} deposits, root: ${this.merkleTree.getRoot().slice(0, 16)}...`);
    } catch (error) {
      this.status = 'error';
      throw new ZKPoolError(
        ZK_POOL_ERROR_CODES.NOT_INITIALIZED,
        `Failed to initialize USDC ZK Pool: ${error instanceof Error ? error.message : 'Unknown error'}`,
        error
      );
    }
  }

  private async initializeContracts(): Promise<void> {
    console.log('[USDCZKPool] Initializing contracts...');

    // Create provider
    this.provider = new JsonRpcProvider(this.config.rpcUrl, this.config.chainId, {
      staticNetwork: true,
    });

    // Create pool contract instance
    this.poolContract = new Contract(
      this.config.poolAddress,
      USDC_PRIVACY_POOL_ABI,
      this.provider
    );

    // Create token contract instance
    this.tokenContract = new Contract(
      this.config.tokenAddress,
      USDC_ERC20_ABI,
      this.provider
    );

    console.log(`[USDCZKPool] Pool contract: ${this.config.poolAddress}`);
    console.log(`[USDCZKPool] Token contract: ${this.config.tokenAddress}`);
  }

  private async syncWithContract(): Promise<void> {
    if (!this.poolContract) return;

    try {
      const poolInfo = await this.poolContract.getPoolInfo();
      // poolInfo returns: [denomination, tokenAddress, verifierAddress, leafCount, root]
      const onChainLeafCount = Number(poolInfo[3]);
      const onChainRoot = poolInfo[4].toString();

      console.log(`[USDCZKPool] On-chain state: ${onChainLeafCount} deposits`);
      console.log(`[USDCZKPool] Denomination: ${formatUnits(poolInfo[0], USDC_DECIMALS)} USDC`);
      console.log(`[USDCZKPool] Token: ${poolInfo[1]}`);
      console.log(`[USDCZKPool] On-chain root: ${onChainRoot.slice(0, 20)}...`);

      // Sync commitments from contract if local tree is behind
      const localLeafCount = this.merkleTree.getNextIndex();
      if (localLeafCount < onChainLeafCount) {
        console.log(`[USDCZKPool] Local tree behind (${localLeafCount} < ${onChainLeafCount}), syncing...`);
        await this.syncCommitmentsFromContract();
      }
    } catch (error) {
      console.warn('[USDCZKPool] Could not sync with contract:', error);
    }
  }

  /**
   * Sync commitments from on-chain Deposit events to rebuild local Merkle tree
   *
   * This method fetches all Deposit events from the contract, sorts them by leafIndex,
   * and inserts commitments into the local Merkle tree. After syncing, it verifies
   * that the local root matches the on-chain root.
   *
   * @returns Number of commitments synced
   * @throws ZKPoolError if root mismatch after sync
   */
  async syncCommitmentsFromContract(): Promise<number> {
    if (!this.poolContract || !this.provider) {
      console.warn('[USDCZKPool] Cannot sync: contract or provider not initialized');
      return 0;
    }

    try {
      console.log('[USDCZKPool] Starting commitment sync from contract...');

      // Get on-chain state
      const poolInfo = await this.poolContract.getPoolInfo();
      const onChainLeafCount = Number(poolInfo[3]);
      const onChainRoot = poolInfo[4].toString();

      // Check if already synced
      const localLeafCount = this.merkleTree.getNextIndex();
      if (localLeafCount >= onChainLeafCount) {
        console.log(`[USDCZKPool] Already synced (local: ${localLeafCount}, on-chain: ${onChainLeafCount})`);
        return 0;
      }

      // Get current block for query range
      const currentBlock = await this.provider.getBlockNumber();

      // Query all Deposit events from contract creation
      // Start from block 0 or a known deployment block to ensure we get all events
      // USDC pool deployment block - first deposit at block 4342765
      const DEPLOYMENT_BLOCK = 4340000;
      const CHUNK_SIZE = 10000; // Query in chunks to avoid RPC limits

      const allEvents: USDCDepositEvent[] = [];
      let fromBlock = DEPLOYMENT_BLOCK;

      console.log(`[USDCZKPool] Querying Deposit events from block ${fromBlock} to ${currentBlock}`);

      while (fromBlock <= currentBlock) {
        const toBlock = Math.min(fromBlock + CHUNK_SIZE - 1, currentBlock);

        try {
          const depositFilter = this.poolContract.filters.Deposit();
          const events = await this.poolContract.queryFilter(depositFilter, fromBlock, toBlock);

          for (const event of events) {
            // Type assertion for EventLog which has args property
            const log = event as {
              args: [bigint, number, bigint];
              blockNumber: number;
              transactionHash: string;
            };

            const depositEvent: USDCDepositEvent = {
              commitment: log.args[0],
              leafIndex: Number(log.args[1]),
              timestamp: log.args[2],
              transactionHash: log.transactionHash,
              blockNumber: log.blockNumber,
            };

            allEvents.push(depositEvent);
          }

          if (events.length > 0) {
            console.log(`[USDCZKPool] Found ${events.length} events in blocks ${fromBlock}-${toBlock}`);
          }
        } catch (queryError) {
          console.warn(`[USDCZKPool] Error querying blocks ${fromBlock}-${toBlock}:`, queryError);
          // Continue with next chunk
        }

        fromBlock = toBlock + 1;
      }

      if (allEvents.length === 0) {
        console.log('[USDCZKPool] No Deposit events found');
        return 0;
      }

      // Sort events by leafIndex to maintain correct order
      allEvents.sort((a, b) => a.leafIndex - b.leafIndex);

      console.log(`[USDCZKPool] Processing ${allEvents.length} deposit events...`);

      // Insert commitments into local Merkle tree
      // Only insert commitments that are not already in the tree
      let syncedCount = 0;
      for (const event of allEvents) {
        if (event.leafIndex >= localLeafCount) {
          // Insert at the specific index from the on-chain event
          this.merkleTree.insertAt(event.commitment.toString(), event.leafIndex);
          syncedCount++;
        }
      }

      // Verify final root matches on-chain root
      const localRoot = this.merkleTree.getRoot();
      if (localRoot !== onChainRoot) {
        console.error('[USDCZKPool] Root mismatch after sync!');
        console.error(`[USDCZKPool] Local root:    ${localRoot}`);
        console.error(`[USDCZKPool] On-chain root: ${onChainRoot}`);
        throw new ZKPoolError(
          ZK_POOL_ERROR_CODES.MERKLE_PROOF_FAILED,
          `Merkle root mismatch after sync. Local: ${localRoot.slice(0, 20)}..., On-chain: ${onChainRoot.slice(0, 20)}...`
        );
      }

      console.log(`[USDCZKPool] Sync complete. Synced ${syncedCount} new commitments.`);
      console.log(`[USDCZKPool] Local tree now has ${this.merkleTree.getNextIndex()} deposits`);
      console.log(`[USDCZKPool] Root verified: ${localRoot.slice(0, 20)}...`);

      // Save updated pool state
      await this.savePoolState();

      return syncedCount;
    } catch (error) {
      if (error instanceof ZKPoolError) {
        throw error;
      }
      console.error('[USDCZKPool] Sync failed:', error);
      throw new ZKPoolError(
        ZK_POOL_ERROR_CODES.CONTRACT_ERROR,
        `Failed to sync commitments from contract: ${error instanceof Error ? error.message : 'Unknown error'}`,
        error
      );
    }
  }

  // ===========================================================================
  // Status Methods
  // ===========================================================================

  getStatus(): ZKPoolStatus {
    return this.status;
  }

  isReady(): boolean {
    return this.status === 'ready';
  }

  setDemoMode(enabled: boolean): void {
    this.demoMode = enabled;
    this.config.demoMode = enabled;
    proverService.setDemoMode(enabled);
    noteStorageService.setDemoMode(enabled);
    console.log(`[USDCZKPool] Demo mode: ${enabled ? 'enabled' : 'disabled'}`);
  }

  isDemoMode(): boolean {
    return this.demoMode;
  }

  // ===========================================================================
  // ERC-20 Approval (KEY DIFFERENCE from XRP pool)
  // ===========================================================================

  /**
   * Check if USDC approval is needed for deposit
   */
  async checkApprovalStatus(ownerAddress: string): Promise<ApprovalStatus> {
    this.ensureReady();

    if (this.demoMode || !this.tokenContract) {
      return {
        allowance: USDC_POOL_DENOMINATION * BigInt(1000), // Mock large allowance
        needsApproval: false,
        requiredAmount: USDC_POOL_DENOMINATION,
      };
    }

    const allowance = await this.tokenContract.allowance(ownerAddress, this.config.poolAddress);
    const allowanceBigInt = BigInt(allowance);

    return {
      allowance: allowanceBigInt,
      needsApproval: allowanceBigInt < USDC_POOL_DENOMINATION,
      requiredAmount: USDC_POOL_DENOMINATION,
    };
  }

  /**
   * Approve USDC for the privacy pool contract
   */
  async approveUSDC(amount?: bigint): Promise<ContractTransactionResponse | null> {
    this.ensureReady();

    if (this.demoMode) {
      console.log('[USDCZKPool] Demo mode - approval simulated');
      return null;
    }

    if (!this.signer) {
      throw new ZKPoolError(
        ZK_POOL_ERROR_CODES.CONTRACT_ERROR,
        'No signer set. Call setSigner() before approving.'
      );
    }

    if (!this.tokenContract) {
      throw new ZKPoolError(
        ZK_POOL_ERROR_CODES.CONTRACT_ERROR,
        'Token contract not initialized'
      );
    }

    const approvalAmount = amount ?? USDC_POOL_DENOMINATION;
    const signerAddress = await this.signer.getAddress();

    // Check current allowance
    const currentAllowance = await this.tokenContract.allowance(signerAddress, this.config.poolAddress);
    if (BigInt(currentAllowance) >= approvalAmount) {
      console.log('[USDCZKPool] Sufficient allowance already');
      return null;
    }

    // Execute approval
    const tokenWithSigner = this.tokenContract.connect(this.signer);
    console.log(`[USDCZKPool] Approving ${formatUnits(approvalAmount, USDC_DECIMALS)} USDC`);

    const tx = await tokenWithSigner.approve(this.config.poolAddress, approvalAmount);
    console.log(`[USDCZKPool] Approval tx: ${tx.hash}`);

    return tx;
  }

  /**
   * Get USDC balance for an address
   */
  async getUSDCBalance(address: string): Promise<bigint> {
    if (this.demoMode || !this.tokenContract) {
      return USDC_POOL_DENOMINATION * BigInt(10); // Mock 1000 USDC
    }

    const balance = await this.tokenContract.balanceOf(address);
    return BigInt(balance);
  }

  // ===========================================================================
  // Deposit Operations
  // ===========================================================================

  /**
   * Create a new deposit note for USDC
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
      leafIndex: -1,
      amount,
      timestamp: Date.now(),
    };

    console.log(`[USDCZKPool] Created deposit note: ${commitment.slice(0, 16)}...`);
    return note;
  }

  /**
   * Confirm a deposit after on-chain transaction succeeds
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
    let leafIndex: number;
    if (note.leafIndex >= 0) {
      this.merkleTree.insertAt(note.commitment, note.leafIndex);
      leafIndex = note.leafIndex;
    } else {
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

    console.log(`[USDCZKPool] Confirmed deposit at index ${leafIndex}`);
    console.log(`[USDCZKPool] New root: ${this.merkleTree.getRoot().slice(0, 16)}...`);

    return confirmedNote;
  }

  /**
   * Perform a complete USDC deposit
   *
   * Flow:
   * 1. Check/approve USDC for pool contract
   * 2. Create deposit note
   * 3. Call deposit() on pool contract
   * 4. Wait for confirmation
   */
  async deposit(amount: bigint): Promise<DepositResult> {
    try {
      // Validate amount matches denomination
      if (!this.demoMode && amount !== USDC_POOL_DENOMINATION) {
        throw new ZKPoolError(
          ZK_POOL_ERROR_CODES.INVALID_AMOUNT,
          `Deposit amount must be exactly ${formatUnits(USDC_POOL_DENOMINATION, USDC_DECIMALS)} USDC`
        );
      }

      // Create the deposit note
      const note = await this.createDepositNote(amount);

      if (this.demoMode) {
        // Demo mode - immediately confirm
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

      if (!this.poolContract) {
        throw new ZKPoolError(
          ZK_POOL_ERROR_CODES.CONTRACT_ERROR,
          'Pool contract not initialized'
        );
      }

      console.log('[USDCZKPool] Executing real USDC deposit...');

      // Step 1: Check and approve USDC
      const signerAddress = await this.signer.getAddress();
      const approvalStatus = await this.checkApprovalStatus(signerAddress);

      if (approvalStatus.needsApproval) {
        console.log('[USDCZKPool] Approving USDC...');
        const approvalTx = await this.approveUSDC();
        if (approvalTx) {
          console.log('[USDCZKPool] Waiting for approval confirmation...');
          await approvalTx.wait();
          console.log('[USDCZKPool] USDC approved');
        }
      }

      // Step 2: Check balance
      const balance = await this.getUSDCBalance(signerAddress);
      if (balance < USDC_POOL_DENOMINATION) {
        throw new ZKPoolError(
          ZK_POOL_ERROR_CODES.INVALID_AMOUNT,
          `Insufficient USDC balance: ${formatUnits(balance, USDC_DECIMALS)} < ${formatUnits(USDC_POOL_DENOMINATION, USDC_DECIMALS)}`
        );
      }

      // Step 3: Execute deposit
      const commitmentBigInt = BigInt(note.commitment);
      const poolWithSigner = this.poolContract.connect(this.signer);

      console.log(`[USDCZKPool] Depositing commitment: ${commitmentBigInt.toString().slice(0, 20)}...`);

      const tx = await poolWithSigner.deposit(commitmentBigInt);
      console.log(`[USDCZKPool] Deposit transaction sent: ${tx.hash}`);

      // Wait for confirmation
      console.log('[USDCZKPool] Waiting for confirmation...');
      const receipt = await tx.wait();

      if (!receipt) {
        throw new ZKPoolError(
          ZK_POOL_ERROR_CODES.CONTRACT_ERROR,
          'Transaction failed - no receipt'
        );
      }

      console.log(`[USDCZKPool] Deposit confirmed in block ${receipt.blockNumber}`);

      // Parse Deposit event for leafIndex
      let leafIndex = -1;
      for (const log of receipt.logs) {
        try {
          const parsed = this.poolContract.interface.parseLog({
            topics: [...log.topics],
            data: log.data,
          });
          if (parsed?.name === 'Deposit') {
            leafIndex = Number(parsed.args.leafIndex);
            console.log(`[USDCZKPool] Deposit event: leafIndex=${leafIndex}`);
            break;
          }
        } catch {
          // Not a Deposit event
        }
      }

      // Confirm deposit - this inserts the commitment into the local Merkle tree
      const confirmedNote = await this.confirmDeposit(
        { ...note, leafIndex },
        tx.hash,
        receipt.blockNumber
      );

      // IMMEDIATE INSERT VERIFICATION (XRP pool pattern)
      // Verify the commitment was inserted at the correct index
      const commitments = this.merkleTree.getCommitments();
      if (leafIndex >= 0 && leafIndex < commitments.length) {
        const treeCommitment = commitments[leafIndex];
        if (treeCommitment === note.commitment) {
          console.log(`[USDCZKPool] ✓ Immediate insert verified: commitment at index ${leafIndex}`);
        } else {
          console.warn(`[USDCZKPool] ⚠ Commitment mismatch at index ${leafIndex} after insert`);
        }
      }

      // Verify local root matches on-chain root (optional but helpful for debugging)
      if (this.poolContract) {
        try {
          const onChainRoot = await this.poolContract.getRoot();
          const localRoot = this.merkleTree.getRoot();
          if (BigInt(localRoot) === BigInt(onChainRoot)) {
            console.log(`[USDCZKPool] ✓ Root verified after deposit: ${localRoot.slice(0, 20)}...`);
          } else {
            console.log(`[USDCZKPool] Note: Root will sync before withdrawal proof generation`);
          }
        } catch {
          // Non-critical, root verification is also done before proof generation
        }
      }

      return {
        success: true,
        note: confirmedNote,
        txHash: tx.hash,
      };
    } catch (error) {
      console.error('[USDCZKPool] Deposit failed:', error);
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
   * Generate a withdrawal proof for a USDC deposit note
   */
  async generateWithdrawProof(
    note: DepositNote,
    recipient: string,
    relayer: string = '0',
    fee: bigint = 0n,
    refund: bigint = 0n
  ): Promise<WithdrawProof> {
    this.ensureReady();

    // Validate recipient address
    if (!this.isValidEVMAddress(recipient)) {
      throw new ZKPoolError(
        ZK_POOL_ERROR_CODES.INVALID_RECIPIENT,
        `Invalid recipient address: "${recipient}"`
      );
    }

    // Validate relayer address
    if (relayer !== '0' && !this.isValidEVMAddress(relayer)) {
      throw new ZKPoolError(
        ZK_POOL_ERROR_CODES.INVALID_RECIPIENT,
        `Invalid relayer address: "${relayer}"`
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

    // PRE-PROOF SYNC CHECK: Ensure local tree is synced with on-chain state
    // This proactively prevents UnknownRoot() errors from stale Merkle trees
    if (!this.demoMode && this.poolContract) {
      console.log('[USDCZKPool] Pre-proof sync check: verifying tree is synced with on-chain state...');

      try {
        const onChainRoot = await this.poolContract.getRoot();
        const localRoot = this.merkleTree.getRoot();

        if (BigInt(localRoot) !== BigInt(onChainRoot)) {
          console.log('[USDCZKPool] Root mismatch detected, syncing before proof generation...');
          console.log(`[USDCZKPool] Local root:    ${localRoot.slice(0, 20)}...`);
          console.log(`[USDCZKPool] On-chain root: ${onChainRoot.toString().slice(0, 20)}...`);

          await this.syncCommitmentsFromContract();

          // Verify sync was successful
          const newLocalRoot = this.merkleTree.getRoot();
          const newOnChainRoot = await this.poolContract.getRoot();

          if (BigInt(newLocalRoot) !== BigInt(newOnChainRoot)) {
            throw new ZKPoolError(
              ZK_POOL_ERROR_CODES.MERKLE_PROOF_FAILED,
              `Failed to sync tree with on-chain state. Root mismatch persists after sync.`
            );
          }

          console.log('[USDCZKPool] Tree synced successfully, roots now match');
        } else {
          console.log('[USDCZKPool] Tree already synced with on-chain state');
        }
      } catch (error) {
        if (error instanceof ZKPoolError) {
          throw error;
        }
        console.warn('[USDCZKPool] Pre-proof sync check warning:', error);
        // Continue anyway - proof might still work if tree has the required commitment
      }
    }

    // VERIFY NOTE'S COMMITMENT EXISTS IN TREE: Check that the note is in the synced tree
    const commitments = this.merkleTree.getCommitments();
    if (note.leafIndex >= commitments.length) {
      throw new ZKPoolError(
        ZK_POOL_ERROR_CODES.INVALID_NOTE,
        `Note leafIndex ${note.leafIndex} is out of range (tree has ${commitments.length} commitments). ` +
        `The deposit may not have been confirmed on-chain yet.`
      );
    }

    const treeCommitment = commitments[note.leafIndex];
    if (treeCommitment !== note.commitment) {
      console.error('[USDCZKPool] Commitment mismatch at leafIndex', note.leafIndex);
      console.error(`[USDCZKPool] Note commitment: ${note.commitment.slice(0, 20)}...`);
      console.error(`[USDCZKPool] Tree commitment: ${treeCommitment?.slice(0, 20) || 'undefined'}...`);
      throw new ZKPoolError(
        ZK_POOL_ERROR_CODES.INVALID_NOTE,
        `Note commitment does not match tree at leafIndex ${note.leafIndex}. ` +
        `This may indicate a corrupted note or tree sync issue.`
      );
    }

    console.log(`[USDCZKPool] Verified note commitment exists at leafIndex ${note.leafIndex}`);

    // Get Merkle proof
    let merkleProof = this.merkleTree.getProof(note.leafIndex);

    // Verify the proof locally (should always pass after the checks above)
    let isValidProof = this.merkleTree.verify(note.commitment, merkleProof);
    if (!isValidProof) {
      // This should rarely happen after the pre-checks, but handle it just in case
      console.error('[USDCZKPool] Unexpected: Merkle proof verification failed after sync');
      throw new ZKPoolError(
        ZK_POOL_ERROR_CODES.MERKLE_PROOF_FAILED,
        'Merkle proof verification failed. The tree state may be inconsistent.'
      );
    }

    // Prepare circuit input
    const input: WithdrawCircuitInput = {
      nullifier: note.nullifier,
      secret: note.secret,
      pathElements: merkleProof.pathElements,
      pathIndices: merkleProof.pathIndices,
      root: merkleProof.root,
      nullifierHash: note.nullifierHash,
      recipient: addressToFieldElement(recipient),
      relayer: addressToFieldElement(relayer),
      fee: amountToFieldElement(fee),
      refund: amountToFieldElement(refund),
    };

    // Generate the ZK proof
    const proof = await proverService.generateWithdrawProof(input);

    console.log(`[USDCZKPool] Generated withdrawal proof for note ${note.commitment.slice(0, 16)}...`);
    return proof;
  }

  /**
   * Verify a withdrawal proof locally
   */
  async verifyProof(proof: WithdrawProof): Promise<boolean> {
    this.ensureReady();

    const isValid = await proverService.verifyProof(proof);
    const proofRoot = proof.publicSignals[0];
    const currentRoot = this.merkleTree.getRoot();
    const rootValid = proofRoot === currentRoot;

    if (!rootValid) {
      console.warn('[USDCZKPool] Proof root does not match current tree root');
    }

    return isValid && rootValid;
  }

  /**
   * Mark a nullifier as used
   */
  async markNullifierUsed(nullifierHash: string): Promise<void> {
    this.usedNullifiers.add(nullifierHash);
    await this.savePoolState();
    console.log(`[USDCZKPool] Marked nullifier as used: ${nullifierHash.slice(0, 16)}...`);
  }

  /**
   * Check if a nullifier has been used
   */
  isNullifierUsed(nullifierHash: string): boolean {
    return this.usedNullifiers.has(nullifierHash);
  }

  /**
   * Perform a complete USDC withdrawal
   */
  async withdraw(note: DepositNote, recipient: string): Promise<WithdrawResult> {
    try {
      // Generate the withdrawal proof
      const proof = await this.generateWithdrawProof(note, recipient);

      if (this.demoMode) {
        await this.markNullifierUsed(note.nullifierHash);

        return {
          success: true,
          proof,
          txHash: `0x${Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join('')}`,
        };
      }

      // Real mode
      if (!this.signer) {
        throw new ZKPoolError(
          ZK_POOL_ERROR_CODES.CONTRACT_ERROR,
          'No signer set. Call setSigner() before withdrawing.'
        );
      }

      if (!this.poolContract) {
        throw new ZKPoolError(
          ZK_POOL_ERROR_CODES.CONTRACT_ERROR,
          'Pool contract not initialized'
        );
      }

      console.log('[USDCZKPool] Executing real USDC withdrawal...');

      // Export proof to Solidity calldata format
      const calldata = await this.exportSolidityCalldata(proof);

      // Prepare proof struct for contract
      const proofCalldata = {
        a: [BigInt(calldata.a[0]), BigInt(calldata.a[1])] as [bigint, bigint],
        b: [
          [BigInt(calldata.b[0][0]), BigInt(calldata.b[0][1])] as [bigint, bigint],
          [BigInt(calldata.b[1][0]), BigInt(calldata.b[1][1])] as [bigint, bigint],
        ] as [[bigint, bigint], [bigint, bigint]],
        c: [BigInt(calldata.c[0]), BigInt(calldata.c[1])] as [bigint, bigint],
      };

      const root = BigInt(proof.publicSignals[0]);
      const nullifierHash = BigInt(proof.publicSignals[1]);

      // Verify the root is known on-chain before submitting
      const isKnownRoot = await this.poolContract.isKnownRoot(root);
      if (!isKnownRoot) {
        console.error(`[USDCZKPool] Root ${root.toString().slice(0, 20)}... is not known on-chain`);
        // Try syncing one more time
        console.log('[USDCZKPool] Attempting to sync and regenerate proof...');
        await this.syncCommitmentsFromContract();

        // The proof was generated with an old root, we need to regenerate
        throw new ZKPoolError(
          ZK_POOL_ERROR_CODES.MERKLE_PROOF_FAILED,
          'Merkle root not recognized by contract. Please try the withdrawal again.'
        );
      }

      console.log(`[USDCZKPool] Root verified on-chain: ${root.toString().slice(0, 20)}...`);

      const poolWithSigner = this.poolContract.connect(this.signer);

      const tx = await poolWithSigner.withdraw(
        proofCalldata,
        root,
        nullifierHash,
        recipient,
        '0x0000000000000000000000000000000000000000',
        0n,
        0n
      );

      console.log(`[USDCZKPool] Withdrawal transaction sent: ${tx.hash}`);

      console.log('[USDCZKPool] Waiting for confirmation...');
      const receipt = await tx.wait();

      if (!receipt) {
        throw new ZKPoolError(
          ZK_POOL_ERROR_CODES.CONTRACT_ERROR,
          'Withdrawal transaction failed - no receipt'
        );
      }

      console.log(`[USDCZKPool] Withdrawal confirmed in block ${receipt.blockNumber}`);

      await this.markNullifierUsed(note.nullifierHash);

      return {
        success: true,
        proof,
        txHash: tx.hash,
      };
    } catch (error) {
      console.error('[USDCZKPool] Withdrawal failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Withdrawal failed',
      };
    }
  }

  /**
   * Export proof as Solidity calldata
   */
  async exportSolidityCalldata(proof: WithdrawProof): Promise<SolidityCalldata> {
    return proverService.exportSolidityCalldata(proof);
  }

  // ===========================================================================
  // Pool State
  // ===========================================================================

  getPoolState(): PoolState {
    return {
      ...this.merkleTree.getPoolState(),
      usedNullifiers: new Set(this.usedNullifiers),
    };
  }

  getRoot(): string {
    return this.merkleTree.getRoot();
  }

  getNextIndex(): number {
    return this.merkleTree.getNextIndex();
  }

  getCommitments(): string[] {
    return this.merkleTree.getCommitments();
  }

  getCapacity(): number {
    return this.merkleTree.getCapacity();
  }

  /**
   * Get pool denomination in USDC
   */
  getDenomination(): bigint {
    return USDC_POOL_DENOMINATION;
  }

  /**
   * Get pool denomination as human-readable string
   */
  getDenominationDisplay(): string {
    return formatUnits(USDC_POOL_DENOMINATION, USDC_DECIMALS);
  }

  // ===========================================================================
  // Note Management
  // ===========================================================================

  async getAllNotes(): Promise<DepositNote[]> {
    return noteStorageService.getAllNotes();
  }

  async getNote(commitment: string): Promise<DepositNote | null> {
    return noteStorageService.getNote(commitment);
  }

  async getUnspentNotes(): Promise<DepositNote[]> {
    const allNotes = await this.getAllNotes();
    return allNotes.filter((note) => !this.usedNullifiers.has(note.nullifierHash));
  }

  async getSpentNotes(): Promise<DepositNote[]> {
    const allNotes = await this.getAllNotes();
    return allNotes.filter((note) => this.usedNullifiers.has(note.nullifierHash));
  }

  async getTotalBalance(): Promise<bigint> {
    const unspent = await this.getUnspentNotes();
    return unspent.reduce((sum, note) => sum + note.amount, 0n);
  }

  // ===========================================================================
  // Cleanup
  // ===========================================================================

  async reset(): Promise<void> {
    await noteStorageService.clearAll();
    this.merkleTree = new MerkleTree(this.config.treeLevels);
    this.usedNullifiers.clear();
    console.log('[USDCZKPool] Service reset');
  }

  cleanup(): void {
    this.poolContract?.removeAllListeners();
    this.tokenContract?.removeAllListeners();
    this.status = 'uninitialized';
    console.log('[USDCZKPool] Cleanup complete');
  }

  // ===========================================================================
  // Private Methods
  // ===========================================================================

  private ensureReady(): void {
    if (this.status !== 'ready') {
      throw new ZKPoolError(
        ZK_POOL_ERROR_CODES.NOT_INITIALIZED,
        'USDC ZK Pool service not initialized. Call initialize() first.'
      );
    }
  }

  private isValidEVMAddress(address: string): boolean {
    if (!address || typeof address !== 'string') {
      return false;
    }
    const evmAddressRegex = /^0x[a-fA-F0-9]{40}$/;
    return evmAddressRegex.test(address);
  }

  private async restorePoolState(): Promise<void> {
    const storedState = await noteStorageService.getPoolState();

    if (storedState) {
      this.merkleTree = MerkleTree.fromStoredState(storedState, this.config.treeLevels);
      this.usedNullifiers = new Set(storedState.usedNullifiers);
      console.log(`[USDCZKPool] Restored pool state with ${storedState.commitments.length} deposits`);
    } else {
      console.log('[USDCZKPool] No stored pool state, starting fresh');
    }
  }

  private async savePoolState(): Promise<void> {
    const state = this.merkleTree.toStoredState(this.usedNullifiers);
    await noteStorageService.storePoolState(state);
  }
}

// =============================================================================
// Export
// =============================================================================

export const usdcZKPoolService = new USDCZKPoolService();

export { USDCZKPoolService };

// =============================================================================
// Utility Exports
// =============================================================================

export const usdcPoolUtils = {
  computeCommitment,
  computeNullifierHash,
  randomFieldElement,
  addressToFieldElement,
  amountToFieldElement,

  formatAmount: (amount: bigint): string => {
    return formatUnits(amount, USDC_DECIMALS);
  },

  parseAmount: (amount: string): bigint => {
    const [intPart, fracPart = '0'] = amount.split('.');
    const paddedFrac = fracPart.padEnd(USDC_DECIMALS, '0').slice(0, USDC_DECIMALS);
    return BigInt(intPart) * BigInt(10) ** BigInt(USDC_DECIMALS) + BigInt(paddedFrac);
  },

  getDenomination: (): bigint => USDC_POOL_DENOMINATION,
  getDecimals: (): number => USDC_DECIMALS,
  getTokenAddress: (): string => USDC_TOKEN_ADDRESS,
};
