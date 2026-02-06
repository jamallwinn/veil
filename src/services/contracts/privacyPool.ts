/**
 * Privacy Pool Contract Service
 *
 * Provides integration with the deployed PrivacyPoolNative contract on XRPL EVM Mainnet.
 * Handles deposits, withdrawals, and contract state queries.
 * Supports native XRP deposits via msg.value.
 *
 * Contract Address: 0xf765F2A56EF0f6d09438E2113a2FC9932b9645bB (PrivacyPoolNative)
 * Chain ID: 1440000 (XRPL EVM Mainnet)
 * Denomination: 1 XRP
 */

import {
  Contract,
  JsonRpcProvider,
  type Signer,
  type ContractTransactionResponse,
  type EventLog,
  parseUnits,
  formatUnits,
} from 'ethers';

// =============================================================================
// Contract ABI (minimal for required functions)
// =============================================================================

const PRIVACY_POOL_ABI = [
  // Deposit function (payable for native XRP)
  'function deposit(uint256 _commitment) external payable',

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
  'function getPoolInfo() external view returns (uint256 _denomination, address _tokenAddress, address _verifierAddress, uint32 _leafCount, uint256 _root)',
  // Note: PrivacyPoolNative does NOT have a token() function - use getPoolInfo() instead

  // Events
  'event Deposit(uint256 indexed commitment, uint32 indexed leafIndex, uint256 timestamp)',
  'event Withdrawal(address indexed recipient, uint256 indexed nullifierHash, address indexed relayer, uint256 fee)',
];

const ERC20_ABI = [
  'function approve(address spender, uint256 amount) external returns (bool)',
  'function allowance(address owner, address spender) external view returns (uint256)',
  'function balanceOf(address account) external view returns (uint256)',
  'function decimals() external view returns (uint8)',
  'function symbol() external view returns (string)',
];

// =============================================================================
// Types
// =============================================================================

export interface PrivacyPoolConfig {
  contractAddress: string;
  rpcUrl: string;
  chainId: number;
}

export interface DepositEvent {
  commitment: bigint;
  leafIndex: number;
  timestamp: bigint;
  transactionHash: string;
  blockNumber: number;
}

export interface WithdrawalEvent {
  recipient: string;
  nullifierHash: bigint;
  relayer: string;
  fee: bigint;
  transactionHash: string;
  blockNumber: number;
}

export interface PoolInfo {
  denomination: bigint;
  tokenAddress: string;
  verifierAddress: string;
  leafCount: number;
  root: bigint;
}

export interface ProofCalldata {
  a: [bigint, bigint];
  b: [[bigint, bigint], [bigint, bigint]];
  c: [bigint, bigint];
}

// =============================================================================
// Default Configuration (XRPL EVM Mainnet)
// =============================================================================

export const DEFAULT_PRIVACY_POOL_CONFIG: PrivacyPoolConfig = {
  // PrivacyPoolNative contract - accepts native XRP via msg.value
  contractAddress: '0xf765F2A56EF0f6d09438E2113a2FC9932b9645bB',
  rpcUrl: 'https://rpc.xrplevm.org',
  chainId: 1440000,
};

// Denomination: 1 XRP = 1e18 wei
export const POOL_DENOMINATION = parseUnits('1', 18);

// =============================================================================
// Privacy Pool Contract Service
// =============================================================================

class PrivacyPoolContractService {
  private config: PrivacyPoolConfig;
  private provider: JsonRpcProvider | null = null;
  private contract: Contract | null = null;
  private tokenContract: Contract | null = null;
  private tokenAddress: string | null = null;

  constructor(config?: Partial<PrivacyPoolConfig>) {
    this.config = { ...DEFAULT_PRIVACY_POOL_CONFIG, ...config };
  }

  // ===========================================================================
  // Initialization
  // ===========================================================================

  /**
   * Initialize the contract service with a provider
   */
  async initialize(): Promise<void> {
    if (this.contract) {
      console.log('[PrivacyPoolContract] Already initialized');
      return;
    }

    try {
      // Create provider
      this.provider = new JsonRpcProvider(this.config.rpcUrl, this.config.chainId, {
        staticNetwork: true,
      });

      // Create read-only contract instance
      this.contract = new Contract(
        this.config.contractAddress,
        PRIVACY_POOL_ABI,
        this.provider
      );

      // Get token address from getPoolInfo() - PrivacyPoolNative doesn't have token()
      const poolInfo = await this.contract.getPoolInfo();
      this.tokenAddress = poolInfo[1]; // tokenAddress is second return value

      // Native token indicators (don't create ERC20 contract for these)
      const NATIVE_TOKEN_ADDRESSES = [
        '0x0000000000000000000000000000000000000000',
        '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE', // Common native token indicator
      ];

      // Create token contract instance (only for ERC20 tokens, not native)
      const isNative = NATIVE_TOKEN_ADDRESSES.some(
        (addr) => addr.toLowerCase() === this.tokenAddress?.toLowerCase()
      );

      if (this.tokenAddress && !isNative) {
        this.tokenContract = new Contract(this.tokenAddress, ERC20_ABI, this.provider);
        console.log('[PrivacyPoolContract] ERC20 token mode');
      } else {
        console.log('[PrivacyPoolContract] Native token mode (XRP)');
      }

      console.log('[PrivacyPoolContract] Initialized');
      console.log(`[PrivacyPoolContract] Contract: ${this.config.contractAddress}`);
      console.log(`[PrivacyPoolContract] Token: ${this.tokenAddress}`);
    } catch (error) {
      console.error('[PrivacyPoolContract] Initialization failed:', error);
      throw error;
    }
  }

  /**
   * Get provider
   */
  getProvider(): JsonRpcProvider {
    if (!this.provider) {
      throw new Error('PrivacyPoolContract not initialized');
    }
    return this.provider;
  }

  /**
   * Get contract with signer for write operations
   */
  getContractWithSigner(signer: Signer): Contract {
    if (!this.contract) {
      throw new Error('PrivacyPoolContract not initialized');
    }
    return this.contract.connect(signer) as Contract;
  }

  /**
   * Get token contract with signer for approvals
   */
  getTokenContractWithSigner(signer: Signer): Contract | null {
    if (!this.tokenContract) return null;
    return this.tokenContract.connect(signer) as Contract;
  }

  // ===========================================================================
  // Read Operations
  // ===========================================================================

  /**
   * Get current Merkle root
   */
  async getRoot(): Promise<bigint> {
    this.ensureInitialized();
    const root = await this.contract!.getRoot();
    return BigInt(root);
  }

  /**
   * Get number of deposits (leaves in tree)
   */
  async getLeafCount(): Promise<number> {
    this.ensureInitialized();
    const count = await this.contract!.getLeafCount();
    return Number(count);
  }

  /**
   * Check if a Merkle root is known (current or in history)
   */
  async isKnownRoot(root: bigint): Promise<boolean> {
    this.ensureInitialized();
    return this.contract!.isKnownRoot(root);
  }

  /**
   * Check if a nullifier has been spent
   */
  async isSpent(nullifierHash: bigint): Promise<boolean> {
    this.ensureInitialized();
    return this.contract!.isSpent(nullifierHash);
  }

  /**
   * Check if a commitment exists
   */
  async isCommitmentExists(commitment: bigint): Promise<boolean> {
    this.ensureInitialized();
    return this.contract!.isCommitmentExists(commitment);
  }

  /**
   * Get pool information
   */
  async getPoolInfo(): Promise<PoolInfo> {
    this.ensureInitialized();
    const [denomination, tokenAddress, verifierAddress, leafCount, root] =
      await this.contract!.getPoolInfo();
    return {
      denomination: BigInt(denomination),
      tokenAddress,
      verifierAddress,
      leafCount: Number(leafCount),
      root: BigInt(root),
    };
  }

  /**
   * Get pool denomination
   */
  async getDenomination(): Promise<bigint> {
    this.ensureInitialized();
    return BigInt(await this.contract!.denomination());
  }

  /**
   * Get token balance for an address
   */
  async getTokenBalance(address: string): Promise<bigint> {
    this.ensureInitialized();
    if (!this.tokenContract) {
      // Native token - use provider
      return this.provider!.getBalance(address);
    }
    return BigInt(await this.tokenContract.balanceOf(address));
  }

  /**
   * Get token allowance for the pool contract
   */
  async getTokenAllowance(owner: string): Promise<bigint> {
    this.ensureInitialized();
    if (!this.tokenContract) {
      // Native token - no approval needed
      return BigInt(2) ** BigInt(256) - BigInt(1); // max uint256
    }
    return BigInt(await this.tokenContract.allowance(owner, this.config.contractAddress));
  }

  // ===========================================================================
  // Write Operations
  // ===========================================================================

  /**
   * Approve tokens for deposit (if needed)
   */
  async approveTokens(signer: Signer, amount?: bigint): Promise<ContractTransactionResponse | null> {
    this.ensureInitialized();

    const tokenContract = this.getTokenContractWithSigner(signer);
    if (!tokenContract) {
      console.log('[PrivacyPoolContract] No token contract - native token, no approval needed');
      return null;
    }

    const approvalAmount = amount ?? POOL_DENOMINATION;
    const address = await signer.getAddress();
    const currentAllowance = await this.getTokenAllowance(address);

    if (currentAllowance >= approvalAmount) {
      console.log('[PrivacyPoolContract] Sufficient allowance already');
      return null;
    }

    console.log(`[PrivacyPoolContract] Approving ${formatUnits(approvalAmount, 18)} tokens`);
    const tx = await tokenContract.approve(this.config.contractAddress, approvalAmount);
    console.log(`[PrivacyPoolContract] Approval tx: ${tx.hash}`);
    return tx;
  }

  /**
   * Check if this pool uses native token (XRP) or ERC20
   */
  isNativeToken(): boolean {
    return !this.tokenContract &&
      (this.tokenAddress === '0x0000000000000000000000000000000000000000' ||
       this.tokenAddress === '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE');
  }

  /**
   * Deposit to the privacy pool
   *
   * @param signer - The signer to use for the transaction
   * @param commitment - The commitment hash (Poseidon(nullifier, secret))
   * @returns Transaction response
   */
  async deposit(
    signer: Signer,
    commitment: bigint
  ): Promise<ContractTransactionResponse> {
    this.ensureInitialized();

    // Check if commitment already exists
    const exists = await this.isCommitmentExists(commitment);
    if (exists) {
      throw new Error('Commitment already exists in the pool');
    }

    // Check token balance
    const address = await signer.getAddress();
    const balance = await this.getTokenBalance(address);
    const denomination = await this.getDenomination();

    if (balance < denomination) {
      throw new Error(
        `Insufficient balance: ${formatUnits(balance, 18)} < ${formatUnits(denomination, 18)} XRP`
      );
    }

    // For native token, no approval needed
    // For ERC20, approve tokens if needed
    if (!this.isNativeToken()) {
      const approvalTx = await this.approveTokens(signer, denomination);
      if (approvalTx) {
        console.log('[PrivacyPoolContract] Waiting for approval confirmation...');
        await approvalTx.wait();
        console.log('[PrivacyPoolContract] Approval confirmed');
      }
    } else {
      console.log('[PrivacyPoolContract] Native token deposit - no approval needed');
    }

    // Execute deposit
    const contract = this.getContractWithSigner(signer);
    console.log(`[PrivacyPoolContract] Depositing commitment: ${commitment.toString().slice(0, 20)}...`);
    console.log(`[PrivacyPoolContract] Native token: ${this.isNativeToken()}`);

    // For native token, send value; for ERC20, no value needed
    const txOptions = this.isNativeToken() ? { value: denomination } : {};
    const tx = await contract.deposit(commitment, txOptions);
    console.log(`[PrivacyPoolContract] Deposit tx: ${tx.hash}`);

    return tx;
  }

  /**
   * Withdraw from the privacy pool
   *
   * @param signer - The signer to use for the transaction
   * @param proof - The ZK proof calldata
   * @param root - The Merkle root
   * @param nullifierHash - The nullifier hash
   * @param recipient - The recipient address
   * @param relayer - The relayer address (zero for self-relay)
   * @param fee - The relayer fee
   * @param refund - The refund amount
   * @returns Transaction response
   */
  async withdraw(
    signer: Signer,
    proof: ProofCalldata,
    root: bigint,
    nullifierHash: bigint,
    recipient: string,
    relayer: string = '0x0000000000000000000000000000000000000000',
    fee: bigint = 0n,
    refund: bigint = 0n
  ): Promise<ContractTransactionResponse> {
    this.ensureInitialized();

    // Check if nullifier is already spent
    const spent = await this.isSpent(nullifierHash);
    if (spent) {
      throw new Error('Nullifier already spent');
    }

    // Check if root is valid
    const validRoot = await this.isKnownRoot(root);
    if (!validRoot) {
      throw new Error('Unknown Merkle root');
    }

    // Execute withdrawal
    const contract = this.getContractWithSigner(signer);
    console.log(`[PrivacyPoolContract] Withdrawing to: ${recipient}`);

    const tx = await contract.withdraw(
      proof,
      root,
      nullifierHash,
      recipient,
      relayer,
      fee,
      refund
    );

    console.log(`[PrivacyPoolContract] Withdrawal tx: ${tx.hash}`);
    return tx;
  }

  // ===========================================================================
  // Event Listeners
  // ===========================================================================

  /**
   * Get past Deposit events
   */
  async getDepositEvents(fromBlock?: number, toBlock?: number): Promise<DepositEvent[]> {
    this.ensureInitialized();

    const filter = this.contract!.filters.Deposit();
    const events = await this.contract!.queryFilter(
      filter,
      fromBlock ?? 0,
      toBlock ?? 'latest'
    );

    return events
      .filter((e): e is EventLog => e instanceof Object && 'args' in e)
      .map((event) => ({
        commitment: BigInt(event.args.commitment),
        leafIndex: Number(event.args.leafIndex),
        timestamp: BigInt(event.args.timestamp),
        transactionHash: event.transactionHash,
        blockNumber: event.blockNumber,
      }));
  }

  /**
   * Subscribe to new Deposit events
   */
  onDeposit(callback: (event: DepositEvent) => void): void {
    this.ensureInitialized();

    this.contract!.on('Deposit', (commitment, leafIndex, timestamp, event) => {
      callback({
        commitment: BigInt(commitment),
        leafIndex: Number(leafIndex),
        timestamp: BigInt(timestamp),
        transactionHash: event.log.transactionHash,
        blockNumber: event.log.blockNumber,
      });
    });
  }

  /**
   * Subscribe to new Withdrawal events
   */
  onWithdrawal(callback: (event: WithdrawalEvent) => void): void {
    this.ensureInitialized();

    this.contract!.on('Withdrawal', (recipient, nullifierHash, relayer, fee, event) => {
      callback({
        recipient,
        nullifierHash: BigInt(nullifierHash),
        relayer,
        fee: BigInt(fee),
        transactionHash: event.log.transactionHash,
        blockNumber: event.log.blockNumber,
      });
    });
  }

  /**
   * Remove all event listeners
   */
  removeAllListeners(): void {
    if (this.contract) {
      this.contract.removeAllListeners();
    }
  }

  // ===========================================================================
  // Private Methods
  // ===========================================================================

  private ensureInitialized(): void {
    if (!this.contract || !this.provider) {
      throw new Error('PrivacyPoolContract not initialized. Call initialize() first.');
    }
  }
}

// =============================================================================
// Export
// =============================================================================

/** Singleton instance */
export const privacyPoolContractService = new PrivacyPoolContractService();

/** Export class for testing */
export { PrivacyPoolContractService };
