/**
 * USDC Transaction Orchestrator Service
 *
 * Central service managing the 9-phase private USDC transaction flow:
 * INITIATE -> BRIDGE_TO_EVM -> APPROVAL -> DEPOSIT -> WAIT -> PROVE -> WITHDRAW -> BRIDGE_TO_XRPL -> COMPLETE
 *
 * KEY DIFFERENCES from XRP Orchestrator:
 * - Includes APPROVAL phase for ERC-20 token approval
 * - Uses axelarUSDCBridgeService instead of axelarBridgeService
 * - Uses usdcZKPoolService instead of zkPoolService
 * - USDC uses 15 decimals on EVM (vs 18 for XRP)
 * - Pool denomination is 100 USDC (vs 1 XRP)
 *
 * Features:
 * - State persistence after each phase
 * - Automatic phase transitions on success
 * - Error handling with retry for each phase
 * - Resume capability from last successful phase
 * - Timeout handling for stuck phases
 * - Event-driven architecture for UI updates
 */

import type {
  UsdcOrchestratorPhase,
  UsdcPhaseResult,
  UsdcOrchestratorTransaction,
  UsdcTransactionParams,
  UsdcOrchestratorConfig,
  UsdcOrchestratorEventType,
  UsdcOrchestratorEventPayload,
  UsdcOrchestratorEventListener,
} from './usdcTypes';
import {
  UsdcOrchestratorError,
  USDC_ORCHESTRATOR_ERROR_CODES,
  DEFAULT_USDC_ORCHESTRATOR_CONFIG,
  USDC_PHASE_DESCRIPTIONS,
  getUsdcNextPhase,
  getUsdcPhaseProgress,
  isValidUsdcPhaseTransition,
  generateUsdcTransactionId,
} from './usdcTypes';

// Import USDC-specific services
import { axelarUSDCBridgeService } from '@services/bridge/axelarUSDC';
import { axelarBridgeService } from '@services/bridge/axelar';
import { usdcZKPoolService, type DepositNote } from '@services/zkPool/usdcPool';
import { gemWalletService } from '@services/gemwallet';
import { evmSignerService } from '@services/evm/signer';
import { evmProviderService } from '@services/evm/provider';

// Import USDC constants
import {
  USDC_POOL_DENOMINATION,
  USDC_DECIMALS,
  USDC_TOKEN_ADDRESS,
} from '@constants/usdc';
import { formatUnits, Contract } from 'ethers';

// =============================================================================
// USDC Persistence (simplified - uses localStorage)
// =============================================================================

const USDC_STORAGE_KEY = 'veil_usdc_active_transaction';
const USDC_HISTORY_KEY = 'veil_usdc_transaction_history';

// =============================================================================
// Gas Configuration Constants
// =============================================================================

/** XRPL EVM RPC endpoint for balance checks */
const XRPL_EVM_RPC = 'https://rpc.xrplevm.org';

/**
 * Minimum native XRP gas required for EVM transactions (1.6 XRP in wei)
 * Based on actual gas usage:
 * - Approval:  ~0.01 XRP
 * - Deposit:   ~1.56 XRP (largest single cost)
 * - Buffer:    ~0.03 XRP
 */
const MIN_GAS_REQUIRED_WEI = BigInt('1600000000000000000'); // 1.6 XRP = 1600000000000000000 wei

/**
 * Recommended amount of XRP to bridge for gas
 * Gas breakdown:
 * - Approval:  ~0.01 XRP (ERC-20 approve tx)
 * - Deposit:   ~1.56 XRP (privacy pool contract call)
 * - Withdraw:  ~0.50 XRP (ZK proof verification)
 * - Buffer:    ~0.33 XRP (for gas price fluctuations)
 * - Total:     ~2.40 XRP needed, bridge 2.5 XRP
 */
const RECOMMENDED_GAS_BRIDGE_AMOUNT = '2.5';

/** USDC gas fee deducted by Axelar for ITS transfers */
const USDC_BRIDGE_GAS_FEE = 0.2;

// =============================================================================
// USDC Orchestrator Service
// =============================================================================

class UsdcTransactionOrchestratorService {
  private config: UsdcOrchestratorConfig;
  private currentTransaction: UsdcOrchestratorTransaction | null = null;
  private eventListeners: Map<UsdcOrchestratorEventType, Set<UsdcOrchestratorEventListener>> =
    new Map();
  private isRunning = false;
  private phaseTimeoutId: ReturnType<typeof setTimeout> | null = null;
  private demoMode = false;

  // Deposit note for withdrawal proof
  private depositNote: DepositNote | null = null;

  // AbortController for cancelling EVM balance polling
  private balanceAbortController: AbortController | null = null;

  // Lock to prevent concurrent phase executions
  private isExecutingPhase = false;
  private pendingPhaseExecution = false;

  // Gas bridging state
  private needsGasBridge = false;
  private evmGasBalance: bigint = BigInt(0);

  constructor(config?: Partial<UsdcOrchestratorConfig>) {
    this.config = { ...DEFAULT_USDC_ORCHESTRATOR_CONFIG, ...config };
    this.demoMode = this.config.demoMode;
    this.setDemoMode(this.demoMode);
  }

  // ===========================================================================
  // Configuration
  // ===========================================================================

  /**
   * Enable or disable demo mode
   */
  setDemoMode(enabled: boolean): void {
    this.demoMode = enabled;
    this.config.demoMode = enabled;
    // Also set demo mode on dependent services
    axelarUSDCBridgeService.setDemoMode(enabled);
    axelarBridgeService.setDemoMode(enabled);
    usdcZKPoolService.setDemoMode(enabled);

    // Configure services for real mode
    if (!enabled) {
      axelarUSDCBridgeService.setEVMProvider(evmProviderService);
      axelarUSDCBridgeService.setEVMSignerService(evmSignerService);
      axelarBridgeService.setEVMProvider(evmProviderService);
      axelarBridgeService.setEVMSignerService(evmSignerService);
    }

    console.log(`[USDC Orchestrator] Demo mode: ${enabled ? 'enabled' : 'disabled'}`);
  }

  /**
   * Check if running in demo mode
   */
  isDemoMode(): boolean {
    return this.demoMode;
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<UsdcOrchestratorConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Get current configuration
   */
  getConfig(): UsdcOrchestratorConfig {
    return { ...this.config };
  }

  // ===========================================================================
  // Transaction Lifecycle
  // ===========================================================================

  /**
   * Start a new private USDC transaction
   */
  async start(params: UsdcTransactionParams): Promise<UsdcOrchestratorTransaction> {
    // CRITICAL: Set running flag IMMEDIATELY to prevent race conditions
    if (this.isRunning) {
      throw new UsdcOrchestratorError(
        USDC_ORCHESTRATOR_ERROR_CODES.TRANSACTION_ALREADY_ACTIVE,
        'A USDC transaction is already in progress'
      );
    }

    this.isRunning = true;

    try {
      // Validate params
      this.validateParams(params);

      // Initialize USDC ZK pool if not already done
      if (!usdcZKPoolService.isReady()) {
        console.log('[USDC Orchestrator] Initializing USDC ZK pool...');
        await usdcZKPoolService.initialize();
      }

      // Configure bridge service for real mode
      if (!this.demoMode) {
        console.log('[USDC Orchestrator] Configuring bridge service for real mode...');
        axelarUSDCBridgeService.setGemWalletService(gemWalletService);
        axelarUSDCBridgeService.setAxelarEnvironment(this.config.axelarEnvironment);
      }

      // Create new transaction
      const transaction: UsdcOrchestratorTransaction = {
        id: generateUsdcTransactionId(),
        currentPhase: 'INITIATE',
        phaseStatus: 'pending',
        params,
        phaseResults: {},
        txHashes: {},
        startedAt: Date.now(),
        retryCount: 0,
        maxRetries: this.config.maxRetries,
        lastUpdatedAt: Date.now(),
      };

      this.currentTransaction = transaction;

      // Persist initial state
      await this.persistState();

      // Emit event
      this.emitEvent('phase_started', {
        phase: 'INITIATE',
        progress: 0,
        message: USDC_PHASE_DESCRIPTIONS.INITIATE,
      });

      // Start execution
      this.executeCurrentPhase();

      return transaction;
    } catch (error) {
      // Reset running flag if initialization fails
      this.isRunning = false;
      this.currentTransaction = null;
      throw error;
    }
  }

  /**
   * Resume a pending USDC transaction
   */
  async resume(transaction?: UsdcOrchestratorTransaction): Promise<UsdcOrchestratorTransaction | null> {
    if (this.isRunning) {
      console.warn('[USDC Orchestrator] Transaction already running, cannot resume');
      return this.currentTransaction;
    }

    // If no transaction provided, try to load from storage
    const txToResume = transaction || (await this.loadActiveTransaction());

    if (!txToResume) {
      console.log('[USDC Orchestrator] No USDC transaction to resume');
      return null;
    }

    // Validate it's resumable
    if (!this.isTransactionRecoverable(txToResume)) {
      throw new UsdcOrchestratorError(
        USDC_ORCHESTRATOR_ERROR_CODES.PHASE_FAILED,
        `Transaction ${txToResume.id} is not recoverable`,
        txToResume.currentPhase
      );
    }

    // Set as current and resume
    this.currentTransaction = txToResume;
    this.isRunning = true;

    // Initialize ZK pool if needed
    if (!usdcZKPoolService.isReady()) {
      await usdcZKPoolService.initialize();
    }

    // Configure bridge service for real mode
    if (!this.demoMode) {
      console.log('[USDC Orchestrator] Configuring bridge service for real mode (resume)...');
      axelarUSDCBridgeService.setGemWalletService(gemWalletService);
      axelarUSDCBridgeService.setAxelarEnvironment(this.config.axelarEnvironment);
    }

    this.emitEvent('state_restored', {
      phase: txToResume.currentPhase,
      progress: getUsdcPhaseProgress(txToResume.currentPhase),
      message: `Resuming from ${USDC_PHASE_DESCRIPTIONS[txToResume.currentPhase]}`,
    });

    // Continue execution
    this.executeCurrentPhase();

    return txToResume;
  }

  /**
   * Abort the current transaction
   */
  async abort(): Promise<void> {
    if (!this.currentTransaction) {
      return;
    }

    this.isRunning = false;
    this.clearPhaseTimeout();

    // Cancel any pending EVM balance polling
    if (this.balanceAbortController) {
      this.balanceAbortController.abort();
      this.balanceAbortController = null;
    }

    const tx = this.currentTransaction;
    tx.currentPhase = 'FAILED';
    tx.phaseStatus = 'failed';
    tx.error = 'Transaction aborted by user';
    tx.lastUpdatedAt = Date.now();

    await this.persistState();

    this.emitEvent('transaction_failed', {
      phase: tx.currentPhase,
      error: tx.error,
      message: 'Transaction aborted',
    });

    console.log(`[USDC Orchestrator] Transaction ${tx.id} aborted`);
  }

  /**
   * Get the current transaction
   */
  getCurrentTransaction(): UsdcOrchestratorTransaction | null {
    return this.currentTransaction ? { ...this.currentTransaction } : null;
  }

  /**
   * Get current phase
   */
  getCurrentPhase(): UsdcOrchestratorPhase | null {
    return this.currentTransaction?.currentPhase || null;
  }

  /**
   * Check if orchestrator is running
   */
  isActive(): boolean {
    return this.isRunning;
  }

  // ===========================================================================
  // Event System
  // ===========================================================================

  /**
   * Subscribe to orchestrator events
   */
  on(event: UsdcOrchestratorEventType, listener: UsdcOrchestratorEventListener): () => void {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, new Set());
    }
    this.eventListeners.get(event)!.add(listener);

    // Return unsubscribe function
    return () => {
      this.eventListeners.get(event)?.delete(listener);
    };
  }

  /**
   * Unsubscribe from events
   */
  off(event: UsdcOrchestratorEventType, listener?: UsdcOrchestratorEventListener): void {
    if (listener) {
      this.eventListeners.get(event)?.delete(listener);
    } else {
      this.eventListeners.delete(event);
    }
  }

  /**
   * Remove all listeners
   */
  removeAllListeners(): void {
    this.eventListeners.clear();
  }

  /**
   * Emit an event
   */
  private emitEvent(
    type: UsdcOrchestratorEventType,
    data: Partial<Omit<UsdcOrchestratorEventPayload, 'type' | 'transactionId' | 'timestamp'>>
  ): void {
    const payload: UsdcOrchestratorEventPayload = {
      type,
      transactionId: this.currentTransaction?.id || '',
      timestamp: Date.now(),
      ...data,
    };

    const listeners = this.eventListeners.get(type);
    if (listeners) {
      listeners.forEach((listener) => {
        try {
          listener(payload);
        } catch (error) {
          console.error(`[USDC Orchestrator] Error in event listener for ${type}:`, error);
        }
      });
    }
  }

  // ===========================================================================
  // Phase Execution
  // ===========================================================================

  /**
   * Execute the current phase with concurrency guard
   */
  private async executeCurrentPhase(): Promise<void> {
    if (!this.currentTransaction || !this.isRunning) {
      return;
    }

    // CONCURRENCY GUARD: Prevent concurrent phase executions
    if (this.isExecutingPhase) {
      console.log('[USDC Orchestrator] Phase execution already in progress, marking pending');
      this.pendingPhaseExecution = true;
      return;
    }

    // Acquire execution lock
    this.isExecutingPhase = true;
    this.pendingPhaseExecution = false;

    try {
      await this.doExecuteCurrentPhase();
    } finally {
      // Release execution lock
      this.isExecutingPhase = false;

      // If another execution was requested while we were busy, execute it now
      if (this.pendingPhaseExecution && this.isRunning) {
        this.pendingPhaseExecution = false;
        setTimeout(() => this.executeCurrentPhase(), 0);
      }
    }
  }

  /**
   * Internal phase execution
   */
  private async doExecuteCurrentPhase(): Promise<void> {
    if (!this.currentTransaction || !this.isRunning) {
      return;
    }

    const tx = this.currentTransaction;
    const phase = tx.currentPhase;

    // Skip if already complete or failed
    if (phase === 'COMPLETE' || phase === 'FAILED') {
      return;
    }

    // Update status to active
    tx.phaseStatus = 'active';
    tx.lastUpdatedAt = Date.now();
    await this.persistState();

    this.emitEvent('phase_started', {
      phase,
      progress: getUsdcPhaseProgress(phase),
      message: USDC_PHASE_DESCRIPTIONS[phase],
    });

    // Set phase timeout
    this.setPhaseTimeout(phase);

    try {
      // Execute the phase
      const result = await this.executePhase(phase);

      // Clear timeout
      this.clearPhaseTimeout();

      if (result.success) {
        await this.handlePhaseSuccess(result);
      } else {
        await this.handlePhaseFailure(result);
      }
    } catch (error) {
      this.clearPhaseTimeout();
      await this.handlePhaseError(phase, error);
    }
  }

  /**
   * Execute a specific phase
   */
  private async executePhase(phase: UsdcOrchestratorPhase): Promise<UsdcPhaseResult> {
    console.log(`[USDC Orchestrator] Executing phase: ${phase}`);

    switch (phase) {
      case 'INITIATE':
        return this.executeInitiate();
      case 'BRIDGE_GAS':
        return this.executeBridgeGas();
      case 'APPROVAL':
        return this.executeApproval();
      case 'BRIDGE_TO_EVM':
        return this.executeBridgeToEVM();
      case 'DEPOSIT':
        return this.executeDeposit();
      case 'WAIT':
        return this.executeWait();
      case 'PROVE':
        return this.executeProve();
      case 'WITHDRAW':
        return this.executeWithdraw();
      case 'BRIDGE_TO_XRPL':
        return this.executeBridgeToXRPL();
      default:
        throw new UsdcOrchestratorError(
          USDC_ORCHESTRATOR_ERROR_CODES.INVALID_PHASE_TRANSITION,
          `Unknown phase: ${phase}`
        );
    }
  }

  // ===========================================================================
  // Phase Implementations
  // ===========================================================================

  /**
   * Phase 1: INITIATE - Validate inputs and prepare transaction
   * Also checks EVM gas balance to determine if BRIDGE_GAS phase is needed
   */
  private async executeInitiate(): Promise<UsdcPhaseResult> {
    const tx = this.currentTransaction!;

    try {
      if (this.demoMode) {
        await this.simulateDelay(1500);
        this.needsGasBridge = false; // In demo mode, skip gas bridging
        return {
          success: true,
          phase: 'INITIATE',
          timestamp: Date.now(),
          data: { validated: true, needsGasBridge: false },
        };
      }

      // Real mode: Validate wallet connections
      const isGemWalletInstalled = await gemWalletService.isInstalled();
      if (!isGemWalletInstalled) {
        throw new Error('GemWallet not installed');
      }

      // Validate sender address
      if (!gemWalletService.isValidAddress(tx.params.senderXRPL)) {
        throw new Error('Invalid sender XRPL address');
      }

      // Validate recipient address
      if (!gemWalletService.isValidAddress(tx.params.recipient)) {
        throw new Error('Invalid recipient XRPL address');
      }

      // Validate amount
      const amount = parseFloat(tx.params.amount);
      if (isNaN(amount) || amount <= 0) {
        throw new Error('Invalid amount');
      }

      // Create EVM wallet for bridge destination (before BRIDGE_TO_EVM phase)
      let evmAddress = tx.params.senderEVM;
      if (!evmAddress) {
        evmAddress = await evmSignerService.getAddress() || undefined;
        if (!evmAddress) {
          console.log('[USDC Orchestrator] Creating internal EVM wallet...');
          const wallet = await evmSignerService.createWallet();
          evmAddress = wallet.address;
        }
      }
      tx.params.senderEVM = evmAddress;
      console.log('[USDC Orchestrator] EVM wallet ready:', evmAddress);

      // Check EVM gas balance to determine if BRIDGE_GAS phase is needed
      console.log('[USDC Orchestrator] Checking EVM gas balance...');
      this.evmGasBalance = await this.checkEvmGasBalance(evmAddress);
      const gasBalanceXRP = Number(this.evmGasBalance) / 1e18;
      console.log(`[USDC Orchestrator] EVM gas balance: ${gasBalanceXRP.toFixed(6)} XRP (${this.evmGasBalance} wei)`);
      console.log(`[USDC Orchestrator] Minimum required: ${Number(MIN_GAS_REQUIRED_WEI) / 1e18} XRP (${MIN_GAS_REQUIRED_WEI} wei)`);

      // Determine if gas bridging is needed
      this.needsGasBridge = this.evmGasBalance < MIN_GAS_REQUIRED_WEI;
      if (this.needsGasBridge) {
        console.log(`[USDC Orchestrator] Gas balance insufficient! Will bridge ${RECOMMENDED_GAS_BRIDGE_AMOUNT} XRP for gas.`);
      } else {
        console.log('[USDC Orchestrator] Gas balance sufficient. Skipping BRIDGE_GAS phase.');
      }

      return {
        success: true,
        phase: 'INITIATE',
        timestamp: Date.now(),
        data: {
          validated: true,
          evmAddress,
          gasBalanceWei: this.evmGasBalance.toString(),
          gasBalanceXRP: gasBalanceXRP.toFixed(6),
          needsGasBridge: this.needsGasBridge,
        },
      };
    } catch (error) {
      return {
        success: false,
        phase: 'INITIATE',
        timestamp: Date.now(),
        error: error instanceof Error ? error.message : 'Initiation failed',
      };
    }
  }

  /**
   * Check native XRP balance on EVM wallet for gas fees
   *
   * @param evmAddress - EVM wallet address to check
   * @returns Native XRP balance in wei
   */
  private async checkEvmGasBalance(evmAddress: string): Promise<bigint> {
    try {
      console.log(`[USDC Orchestrator] Fetching native XRP balance for ${evmAddress}...`);

      // Use JSON-RPC call to get native balance
      const response = await fetch(XRPL_EVM_RPC, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'eth_getBalance',
          params: [evmAddress, 'latest'],
          id: 1,
        }),
      });

      if (!response.ok) {
        throw new Error(`RPC request failed: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();

      if (data.error) {
        throw new Error(`RPC error: ${data.error.message || JSON.stringify(data.error)}`);
      }

      // Parse hex balance to BigInt
      const balanceWei = BigInt(data.result);
      console.log(`[USDC Orchestrator] Native XRP balance: ${balanceWei} wei (${Number(balanceWei) / 1e18} XRP)`);

      return balanceWei;
    } catch (error) {
      console.error('[USDC Orchestrator] Failed to check EVM gas balance:', error);
      // Return 0 on error to trigger gas bridging as a safety measure
      return BigInt(0);
    }
  }

  /**
   * Phase 2: BRIDGE_GAS - Bridge XRP for gas fees (conditional)
   *
   * This phase bridges XRP from XRPL to EVM to pay for gas fees.
   * It's skipped if the EVM wallet already has sufficient gas.
   */
  private async executeBridgeGas(): Promise<UsdcPhaseResult> {
    const tx = this.currentTransaction!;

    try {
      // In demo mode, always skip this phase
      if (this.demoMode) {
        console.log('[USDC Orchestrator] Demo mode: Skipping BRIDGE_GAS phase');
        return {
          success: true,
          phase: 'BRIDGE_GAS',
          timestamp: Date.now(),
          data: { skipped: true, reason: 'demo_mode' },
        };
      }

      // Check if gas bridging is needed (determined in INITIATE phase)
      if (!this.needsGasBridge) {
        console.log('[USDC Orchestrator] Gas balance sufficient, skipping BRIDGE_GAS phase');
        return {
          success: true,
          phase: 'BRIDGE_GAS',
          timestamp: Date.now(),
          data: {
            skipped: true,
            reason: 'sufficient_gas',
            currentGasWei: this.evmGasBalance.toString(),
          },
        };
      }

      // Check if gas was already bridged (prevents duplicate bridging on retry)
      if (tx.txHashes.gasBridge) {
        console.log('[USDC Orchestrator] Gas bridge already sent, waiting for confirmation...');
        console.log(`[USDC Orchestrator] Gas bridge tx hash: ${tx.txHashes.gasBridge}`);

        // Wait for gas to arrive
        await this.waitForGasDelivery(tx.params.senderEVM!);

        return {
          success: true,
          phase: 'BRIDGE_GAS',
          timestamp: Date.now(),
          txHash: tx.txHashes.gasBridge,
          data: { resumedFromExistingTx: true },
        };
      }

      const evmAddress = tx.params.senderEVM!;
      console.log(`[USDC Orchestrator] Bridging ${RECOMMENDED_GAS_BRIDGE_AMOUNT} XRP for gas to ${evmAddress}...`);

      // Configure the XRP bridge service
      axelarBridgeService.setGemWalletService(gemWalletService);
      axelarBridgeService.setAxelarEnvironment(this.config.axelarEnvironment);

      // Bridge XRP for gas
      const result = await axelarBridgeService.bridgeToEVM(
        RECOMMENDED_GAS_BRIDGE_AMOUNT,
        tx.params.senderXRPL,
        evmAddress
      );

      if (!result.success) {
        throw new Error(result.error || 'XRP gas bridge failed');
      }

      // Store the gas bridge tx hash
      if (result.txHash) {
        tx.txHashes.gasBridge = result.txHash;
        console.log(`[USDC Orchestrator] Gas bridge tx submitted: ${result.txHash}`);
        await this.persistState();

        // Wait for gas to be delivered to EVM wallet
        await this.waitForGasDelivery(evmAddress);
      }

      return {
        success: true,
        phase: 'BRIDGE_GAS',
        timestamp: Date.now(),
        txHash: result.txHash || undefined,
        data: {
          bridgedAmount: RECOMMENDED_GAS_BRIDGE_AMOUNT,
          depositAddress: result.depositAddress,
          evmAddress,
        },
      };
    } catch (error) {
      return {
        success: false,
        phase: 'BRIDGE_GAS',
        timestamp: Date.now(),
        error: error instanceof Error ? error.message : 'Gas bridge failed',
      };
    }
  }

  /**
   * Wait for gas XRP to be delivered to EVM wallet after bridge
   *
   * @param evmAddress - EVM wallet address to monitor
   * @param maxWaitMs - Maximum time to wait (default: 5 minutes)
   * @param pollIntervalMs - Polling interval (default: 10 seconds)
   */
  private async waitForGasDelivery(
    evmAddress: string,
    maxWaitMs: number = 5 * 60 * 1000,
    pollIntervalMs: number = 10000
  ): Promise<void> {
    const startTime = Date.now();
    let pollCount = 0;

    console.log(`[USDC Orchestrator] Waiting for XRP gas delivery to EVM wallet...`);
    console.log(`  EVM Address: ${evmAddress}`);
    console.log(`  Required: >= ${Number(MIN_GAS_REQUIRED_WEI) / 1e18} XRP`);
    console.log(`  Max wait: ${maxWaitMs / 1000}s`);

    while (Date.now() - startTime < maxWaitMs) {
      pollCount++;

      try {
        const balance = await this.checkEvmGasBalance(evmAddress);
        const balanceXRP = Number(balance) / 1e18;

        console.log(`[USDC Orchestrator] Gas balance poll #${pollCount}: ${balanceXRP.toFixed(6)} XRP`);

        if (balance >= MIN_GAS_REQUIRED_WEI) {
          console.log(`[USDC Orchestrator] Gas delivery confirmed! Balance: ${balanceXRP.toFixed(6)} XRP`);
          this.evmGasBalance = balance;
          return;
        }

        // Emit progress update
        const elapsed = Date.now() - startTime;
        const progress = Math.min(90, Math.round((elapsed / maxWaitMs) * 100));
        this.emitEvent('progress_update', {
          phase: 'BRIDGE_GAS',
          message: `Waiting for XRP gas delivery... (${balanceXRP.toFixed(4)} XRP received)`,
          progress,
        });

        // Wait before next poll
        await this.delay(pollIntervalMs);
      } catch (error) {
        console.warn(`[USDC Orchestrator] Gas balance check failed (poll #${pollCount}):`, error);
        await this.delay(pollIntervalMs);
      }
    }

    const elapsed = (Date.now() - startTime) / 1000;
    throw new Error(
      `Timeout waiting for XRP gas delivery after ${elapsed.toFixed(0)}s. ` +
      `The Axelar bridge may be delayed. Please try again later.`
    );
  }

  /**
   * Phase 3: APPROVAL - Approve USDC for privacy pool (unique to USDC)
   */
  private async executeApproval(): Promise<UsdcPhaseResult> {
    const tx = this.currentTransaction!;

    try {
      if (this.demoMode) {
        await this.simulateDelay(1000);
        return {
          success: true,
          phase: 'APPROVAL',
          timestamp: Date.now(),
          data: { approved: true },
        };
      }

      // Real mode: Get EVM signer
      let evmAddress = tx.params.senderEVM;
      if (!evmAddress) {
        evmAddress = await evmSignerService.getAddress() || undefined;
        if (!evmAddress) {
          // Auto-create internal EVM wallet
          console.log('[USDC Orchestrator] Creating internal EVM wallet...');
          const wallet = await evmSignerService.createWallet();
          evmAddress = wallet.address;
        }
      }

      if (!evmAddress) {
        throw new Error('Failed to create EVM wallet');
      }

      // Set EVM address on transaction
      tx.params.senderEVM = evmAddress;

      // Set signer on USDC ZK pool service
      const signer = await evmSignerService.getSigner();
      if (!signer) {
        throw new Error('No EVM signer available');
      }
      usdcZKPoolService.setSigner(signer);

      // Check current approval status
      const approvalStatus = await usdcZKPoolService.checkApprovalStatus(evmAddress);
      console.log(`[USDC Orchestrator] Approval status: allowance=${formatUnits(approvalStatus.allowance, USDC_DECIMALS)}, needsApproval=${approvalStatus.needsApproval}`);

      if (approvalStatus.needsApproval) {
        // Execute approval
        console.log('[USDC Orchestrator] Approving USDC...');
        const approvalTx = await usdcZKPoolService.approveUSDC();

        if (approvalTx) {
          tx.txHashes.approval = approvalTx.hash;
          console.log(`[USDC Orchestrator] Approval tx: ${approvalTx.hash}`);

          // Wait for confirmation
          await approvalTx.wait();
          console.log('[USDC Orchestrator] USDC approval confirmed');
        }
      } else {
        console.log('[USDC Orchestrator] USDC already approved');
      }

      return {
        success: true,
        phase: 'APPROVAL',
        timestamp: Date.now(),
        txHash: tx.txHashes.approval,
        data: {
          evmAddress,
          approved: true,
        },
      };
    } catch (error) {
      return {
        success: false,
        phase: 'APPROVAL',
        timestamp: Date.now(),
        error: error instanceof Error ? error.message : 'Approval failed',
      };
    }
  }

  /**
   * Phase 3: BRIDGE_TO_EVM - Bridge USDC to EVM via Axelar ITS
   */
  private async executeBridgeToEVM(): Promise<UsdcPhaseResult> {
    const tx = this.currentTransaction!;

    try {
      console.log(`[USDC Orchestrator] Bridge mode: ${this.demoMode ? 'DEMO' : 'REAL'}`);

      // Check if bridge payment was already sent (prevents duplicate payments on retry)
      if (tx.txHashes.xrplBridge) {
        console.log('[USDC Orchestrator] Bridge payment already sent, skipping duplicate');
        console.log(`[USDC Orchestrator] Existing tx hash: ${tx.txHashes.xrplBridge}`);

        // Wait for bridge confirmation
        await this.waitForBridgeConfirmation(tx.txHashes.xrplBridge);

        return {
          success: true,
          phase: 'BRIDGE_TO_EVM',
          timestamp: Date.now(),
          txHash: tx.txHashes.xrplBridge,
          data: {
            evmAddress: tx.params.senderEVM,
            resumedFromExistingTx: true,
          },
        };
      }

      const targetEVM = tx.params.senderEVM || '0x' + '0'.repeat(40);
      // Add gas fee to bridge amount since Axelar deducts it from the transfer
      const baseAmount = parseFloat(tx.params.amount);
      const bridgeAmountWithGas = (baseAmount + USDC_BRIDGE_GAS_FEE).toFixed(6);

      console.log(`[USDC Orchestrator] Bridging ${bridgeAmountWithGas} USDC (${tx.params.amount} + ${USDC_BRIDGE_GAS_FEE} gas fee) to EVM address: ${targetEVM}`);

      // Execute bridge
      const result = await axelarUSDCBridgeService.bridgeToEVM(
        bridgeAmountWithGas,
        tx.params.senderXRPL,
        targetEVM
      );

      if (!result.success) {
        throw new Error(result.error || 'Bridge to EVM failed');
      }

      // Store tx hash immediately
      if (result.txHash) {
        tx.txHashes.xrplBridge = result.txHash;
        console.log(`[USDC Orchestrator] Bridge payment sent, tx hash: ${result.txHash}`);
        await this.persistState();

        // Wait for bridge confirmation
        await this.waitForBridgeConfirmation(result.txHash);
      }

      return {
        success: true,
        phase: 'BRIDGE_TO_EVM',
        timestamp: Date.now(),
        txHash: result.txHash || undefined,
        data: {
          depositAddress: result.depositAddress,
          evmAddress: targetEVM,
        },
      };
    } catch (error) {
      return {
        success: false,
        phase: 'BRIDGE_TO_EVM',
        timestamp: Date.now(),
        error: error instanceof Error ? error.message : 'Bridge to EVM failed',
      };
    }
  }

  /**
   * Phase 4: DEPOSIT - Deposit USDC to privacy pool
   */
  private async executeDeposit(): Promise<UsdcPhaseResult> {
    const tx = this.currentTransaction!;

    try {
      // Get the EVM signer and set it on usdcZKPoolService
      let evmAddress: string | undefined;

      if (!this.demoMode) {
        const signer = await evmSignerService.getSigner();
        if (!signer) {
          throw new Error('No EVM signer available. Wallet may not be initialized.');
        }
        usdcZKPoolService.setSigner(signer);
        evmAddress = await signer.getAddress();
        console.log('[USDC Orchestrator] Set signer on usdcZKPoolService:', evmAddress);

        // Wait for Axelar bridge to deliver USDC to EVM wallet
        // We bridge (amount + gas_fee), so after gas deduction we should receive ~amount
        const requiredAmount = parseFloat(tx.params.amount);
        console.log(`[USDC Orchestrator] Waiting for ${requiredAmount} USDC to arrive on EVM...`);

        // Note: For USDC, we check USDC balance, not native XRP
        await this.waitForUSDCBalance(evmAddress, requiredAmount);
        console.log('[USDC Orchestrator] USDC received, proceeding with deposit');
      }

      // Execute deposit
      const depositResult = await usdcZKPoolService.deposit(USDC_POOL_DENOMINATION);

      if (!depositResult.success || !depositResult.note) {
        throw new Error(depositResult.error || 'Deposit failed');
      }

      // Store deposit note for withdrawal
      this.depositNote = depositResult.note;

      // Save deposit data
      tx.depositData = {
        commitment: depositResult.note.commitment,
        nullifierHash: depositResult.note.nullifierHash,
        leafIndex: depositResult.note.leafIndex,
      };
      tx.txHashes.deposit = depositResult.txHash;

      return {
        success: true,
        phase: 'DEPOSIT',
        timestamp: Date.now(),
        txHash: depositResult.txHash,
        data: {
          commitment: depositResult.note.commitment,
          leafIndex: depositResult.note.leafIndex,
        },
      };
    } catch (error) {
      return {
        success: false,
        phase: 'DEPOSIT',
        timestamp: Date.now(),
        error: error instanceof Error ? error.message : 'Deposit failed',
      };
    }
  }

  /**
   * Phase 5: WAIT - Wait for anonymity set growth (optional)
   */
  private async executeWait(): Promise<UsdcPhaseResult> {
    const tx = this.currentTransaction!;

    try {
      // Check if we should skip waiting
      if (tx.params.skipWait) {
        return {
          success: true,
          phase: 'WAIT',
          timestamp: Date.now(),
          data: { skipped: true },
        };
      }

      const waitDuration = tx.params.waitDuration || this.config.defaultWaitDurationMs;

      if (waitDuration > 0) {
        console.log(`[USDC Orchestrator] Waiting ${waitDuration}ms for anonymity set...`);

        const startTime = Date.now();
        const updateInterval = 1000;

        await new Promise<void>((resolve) => {
          const checkProgress = setInterval(() => {
            const elapsed = Date.now() - startTime;
            const progress = Math.min(100, Math.round((elapsed / waitDuration) * 100));

            this.emitEvent('progress_update', {
              phase: 'WAIT',
              progress: getUsdcPhaseProgress('WAIT'),
              message: `Waiting for privacy... ${progress}%`,
              data: { waitProgress: progress },
            });

            if (elapsed >= waitDuration) {
              clearInterval(checkProgress);
              resolve();
            }
          }, updateInterval);
        });
      }

      return {
        success: true,
        phase: 'WAIT',
        timestamp: Date.now(),
        data: { waitDuration },
      };
    } catch (error) {
      return {
        success: false,
        phase: 'WAIT',
        timestamp: Date.now(),
        error: error instanceof Error ? error.message : 'Wait phase failed',
      };
    }
  }

  /**
   * Phase 6: PROVE - Generate ZK withdrawal proof
   */
  private async executeProve(): Promise<UsdcPhaseResult> {
    const tx = this.currentTransaction!;

    try {
      // Need the deposit note
      if (!this.depositNote && tx.depositData) {
        // Try to restore from stored notes
        const notes = await usdcZKPoolService.getAllNotes();
        this.depositNote = notes.find(
          (n) => n.commitment === tx.depositData!.commitment
        ) || null;
      }

      if (!this.depositNote) {
        throw new Error('Deposit note not found - cannot generate proof');
      }

      // Generate a fresh recipient EVM address for withdrawal
      const recipientEVM = tx.params.senderEVM || '0x' + '0'.repeat(40);

      // Generate the ZK proof
      console.log('[USDC Orchestrator] Generating ZK proof...');
      await usdcZKPoolService.generateWithdrawProof(
        this.depositNote,
        recipientEVM
      );

      tx.withdrawData = {
        proofGenerated: true,
        proofTimestamp: Date.now(),
      };

      return {
        success: true,
        phase: 'PROVE',
        timestamp: Date.now(),
        data: {
          proofGenerated: true,
          recipientEVM,
        },
      };
    } catch (error) {
      return {
        success: false,
        phase: 'PROVE',
        timestamp: Date.now(),
        error: error instanceof Error ? error.message : 'Proof generation failed',
      };
    }
  }

  /**
   * Phase 7: WITHDRAW - Withdraw USDC from privacy pool
   */
  private async executeWithdraw(): Promise<UsdcPhaseResult> {
    const tx = this.currentTransaction!;

    try {
      if (!this.depositNote) {
        throw new Error('Deposit note not found');
      }

      // Get the EVM address for withdrawal
      const recipientEVM = tx.params.senderEVM || '0x' + '0'.repeat(40);

      // Execute withdrawal
      const result = await usdcZKPoolService.withdraw(this.depositNote, recipientEVM);

      if (!result.success) {
        throw new Error(result.error || 'Withdrawal failed');
      }

      tx.txHashes.withdraw = result.txHash;

      return {
        success: true,
        phase: 'WITHDRAW',
        timestamp: Date.now(),
        txHash: result.txHash,
      };
    } catch (error) {
      return {
        success: false,
        phase: 'WITHDRAW',
        timestamp: Date.now(),
        error: error instanceof Error ? error.message : 'Withdrawal failed',
      };
    }
  }

  /**
   * Phase 8: BRIDGE_TO_XRPL - Bridge USDC back to XRPL
   */
  private async executeBridgeToXRPL(): Promise<UsdcPhaseResult> {
    const tx = this.currentTransaction!;

    try {
      const fromEVM = tx.params.senderEVM || '0x' + '0'.repeat(40);

      // CRITICAL: Record USDC balance BEFORE bridge tx for confirmation check
      // When bridging TO XRPL, we need to wait for balance to DECREASE (not increase)
      const initialBalance = await this.checkEvmUsdcBalance(fromEVM);
      console.log(`[USDC Orchestrator] BRIDGE_TO_XRPL: Initial EVM USDC balance = ${initialBalance}`);

      // Execute bridge to XRPL
      const result = await axelarUSDCBridgeService.bridgeToXRPL(
        tx.params.amount,
        fromEVM,
        tx.params.recipient
      );

      if (!result.success) {
        throw new Error(result.error || 'Bridge to XRPL failed');
      }

      tx.txHashes.evmBridge = result.txHash || undefined;

      // Wait for bridge confirmation by checking balance DECREASE
      if (result.txHash) {
        await this.waitForBridgeToXRPLConfirmation(fromEVM, initialBalance);
      }

      return {
        success: true,
        phase: 'BRIDGE_TO_XRPL',
        timestamp: Date.now(),
        txHash: result.txHash || undefined,
      };
    } catch (error) {
      return {
        success: false,
        phase: 'BRIDGE_TO_XRPL',
        timestamp: Date.now(),
        error: error instanceof Error ? error.message : 'Bridge to XRPL failed',
      };
    }
  }

  /**
   * Wait for BRIDGE_TO_XRPL confirmation by checking EVM USDC balance DECREASE
   *
   * Unlike BRIDGE_TO_EVM which waits for balance to increase (from 0 to >0),
   * BRIDGE_TO_XRPL must wait for balance to DECREASE (from >0 to 0 or near 0).
   *
   * @param evmAddress - EVM wallet address to monitor
   * @param initialBalance - USDC balance before bridge tx was submitted
   */
  private async waitForBridgeToXRPLConfirmation(
    evmAddress: string,
    initialBalance: number
  ): Promise<void> {
    const maxWait = 300000; // 5 minutes
    const pollInterval = 5000; // 5 seconds
    const startTime = Date.now();

    console.log(`[USDC Orchestrator] Waiting for BRIDGE_TO_XRPL confirmation...`);
    console.log(`  EVM Address: ${evmAddress}`);
    console.log(`  Initial USDC balance: ${initialBalance}`);
    console.log(`  Expecting balance to DECREASE to ~0`);

    let pollCount = 0;
    while (Date.now() - startTime < maxWait) {
      pollCount++;
      const elapsedSec = Math.round((Date.now() - startTime) / 1000);

      try {
        const currentBalance = await this.checkEvmUsdcBalance(evmAddress);
        console.log(`[USDC Orchestrator] BRIDGE_TO_XRPL poll #${pollCount} (${elapsedSec}s): EVM USDC balance = ${currentBalance} (was ${initialBalance})`);

        // Confirm when balance has decreased significantly (allow small dust amount)
        // Balance should drop from initialBalance to near 0
        const balanceDecrease = initialBalance - currentBalance;
        const significantDecrease = balanceDecrease >= initialBalance * 0.95; // 95% decrease
        const nearZero = currentBalance < 0.01; // Less than 0.01 USDC

        if (nearZero || (initialBalance > 0 && significantDecrease)) {
          console.log(`[USDC Orchestrator] BRIDGE_TO_XRPL confirmed! USDC left EVM wallet.`);
          console.log(`  Balance change: ${initialBalance} -> ${currentBalance} (decrease: ${balanceDecrease})`);
          return;
        }

        // Emit progress update
        this.emitEvent('progress_update', {
          phase: 'BRIDGE_TO_XRPL',
          progress: getUsdcPhaseProgress('BRIDGE_TO_XRPL'),
          message: `Bridging to XRPL... (${elapsedSec}s elapsed, balance: ${currentBalance.toFixed(2)} USDC)`,
        });
      } catch (balanceError) {
        console.warn(`[USDC Orchestrator] BRIDGE_TO_XRPL balance check failed (poll #${pollCount}):`, balanceError);
      }

      await this.delay(pollInterval);
    }

    throw new Error(`BRIDGE_TO_XRPL confirmation timeout after ${maxWait / 1000}s. USDC may still be leaving EVM wallet.`);
  }

  // ===========================================================================
  // Phase Transition Handling
  // ===========================================================================

  /**
   * Handle successful phase completion
   */
  private async handlePhaseSuccess(result: UsdcPhaseResult): Promise<void> {
    if (!this.currentTransaction) return;

    const tx = this.currentTransaction;
    const completedPhase = result.phase;

    // Save phase result
    tx.phaseResults[completedPhase] = result;
    tx.phaseStatus = 'completed';
    tx.retryCount = 0;
    tx.lastUpdatedAt = Date.now();

    // Save transaction hash if present
    if (result.txHash) {
      switch (completedPhase) {
        case 'BRIDGE_GAS':
          tx.txHashes.gasBridge = result.txHash;
          break;
        case 'APPROVAL':
          tx.txHashes.approval = result.txHash;
          break;
        case 'BRIDGE_TO_EVM':
          tx.txHashes.xrplBridge = result.txHash;
          break;
        case 'DEPOSIT':
          tx.txHashes.deposit = result.txHash;
          break;
        case 'WITHDRAW':
          tx.txHashes.withdraw = result.txHash;
          break;
        case 'BRIDGE_TO_XRPL':
          tx.txHashes.evmBridge = result.txHash;
          break;
      }
    }

    // Emit completion event
    this.emitEvent('phase_completed', {
      phase: completedPhase,
      progress: getUsdcPhaseProgress(completedPhase),
      message: `${USDC_PHASE_DESCRIPTIONS[completedPhase]} completed`,
      data: result.data,
    });

    // Persist state
    await this.persistState();

    // Get next phase
    let nextPhase = getUsdcNextPhase(completedPhase, tx.params.skipWait);

    // Special handling: Skip BRIDGE_GAS if gas is sufficient
    // This happens when INITIATE completes and we don't need to bridge gas
    if (nextPhase === 'BRIDGE_GAS' && !this.needsGasBridge) {
      console.log('[USDC Orchestrator] Skipping BRIDGE_GAS phase - gas balance sufficient');
      nextPhase = 'BRIDGE_TO_EVM';
    }

    if (nextPhase && nextPhase !== 'COMPLETE') {
      // Validate transition
      if (!isValidUsdcPhaseTransition(completedPhase, nextPhase)) {
        throw new UsdcOrchestratorError(
          USDC_ORCHESTRATOR_ERROR_CODES.INVALID_PHASE_TRANSITION,
          `Invalid transition from ${completedPhase} to ${nextPhase}`
        );
      }

      // Move to next phase
      tx.currentPhase = nextPhase;
      tx.phaseStatus = 'pending';
      await this.persistState();

      // Execute next phase
      this.executeCurrentPhase();
    } else {
      // Transaction complete
      await this.handleTransactionComplete();
    }
  }

  /**
   * Handle phase failure
   */
  private async handlePhaseFailure(result: UsdcPhaseResult): Promise<void> {
    if (!this.currentTransaction) return;

    const tx = this.currentTransaction;

    // Save phase result
    tx.phaseResults[result.phase] = result;
    tx.phaseStatus = 'failed';
    tx.lastUpdatedAt = Date.now();

    // Check retry count
    if (tx.retryCount < tx.maxRetries) {
      tx.retryCount++;

      this.emitEvent('phase_retry', {
        phase: result.phase,
        progress: getUsdcPhaseProgress(result.phase),
        message: `Retrying ${USDC_PHASE_DESCRIPTIONS[result.phase]} (${tx.retryCount}/${tx.maxRetries})`,
        error: result.error,
      });

      await this.persistState();

      // Retry with exponential backoff
      const delay = this.config.retryDelayMs * Math.pow(2, tx.retryCount - 1);
      await this.delay(delay);

      // Set status back to pending and retry
      tx.phaseStatus = 'pending';
      this.executeCurrentPhase();
    } else {
      // Max retries exceeded
      await this.handleTransactionFailed(
        result.error || `Max retries exceeded for ${result.phase}`
      );
    }
  }

  /**
   * Handle phase execution error
   */
  private async handlePhaseError(
    phase: UsdcOrchestratorPhase,
    error: unknown
  ): Promise<void> {
    const errorMessage =
      error instanceof Error ? error.message : 'Unknown error occurred';

    const result: UsdcPhaseResult = {
      success: false,
      phase,
      timestamp: Date.now(),
      error: errorMessage,
    };

    await this.handlePhaseFailure(result);
  }

  /**
   * Handle transaction completion
   */
  private async handleTransactionComplete(): Promise<void> {
    if (!this.currentTransaction) return;

    const tx = this.currentTransaction;
    tx.currentPhase = 'COMPLETE';
    tx.phaseStatus = 'completed';
    tx.completedAt = Date.now();
    tx.lastUpdatedAt = Date.now();
    this.isRunning = false;
    this.pendingPhaseExecution = false;

    // Save to history
    await this.saveToHistory(tx);

    // Clear active transaction
    await this.clearActiveTransaction();

    // Emit completion event
    this.emitEvent('transaction_complete', {
      phase: 'COMPLETE',
      progress: 100,
      message: 'USDC transaction complete',
      data: {
        amount: tx.params.amount,
        recipient: tx.params.recipient,
        duration: tx.completedAt - tx.startedAt,
      },
    });

    console.log(`[USDC Orchestrator] Transaction ${tx.id} completed successfully`);
  }

  /**
   * Handle transaction failure
   */
  private async handleTransactionFailed(error: string): Promise<void> {
    if (!this.currentTransaction) return;

    const tx = this.currentTransaction;
    tx.currentPhase = 'FAILED';
    tx.phaseStatus = 'failed';
    tx.error = error;
    tx.lastUpdatedAt = Date.now();
    this.isRunning = false;
    this.pendingPhaseExecution = false;

    await this.persistState();

    this.emitEvent('transaction_failed', {
      phase: 'FAILED',
      progress: getUsdcPhaseProgress(tx.currentPhase),
      message: 'USDC transaction failed',
      error,
    });

    console.error(`[USDC Orchestrator] Transaction ${tx.id} failed: ${error}`);
  }

  // ===========================================================================
  // Helper Methods
  // ===========================================================================

  /**
   * Validate transaction parameters
   */
  private validateParams(params: UsdcTransactionParams): void {
    if (!params.amount || parseFloat(params.amount) <= 0) {
      throw new UsdcOrchestratorError(
        USDC_ORCHESTRATOR_ERROR_CODES.INVALID_PARAMS,
        'Invalid amount'
      );
    }

    if (!params.recipient) {
      throw new UsdcOrchestratorError(
        USDC_ORCHESTRATOR_ERROR_CODES.INVALID_PARAMS,
        'Recipient address required'
      );
    }

    if (!params.senderXRPL) {
      throw new UsdcOrchestratorError(
        USDC_ORCHESTRATOR_ERROR_CODES.INVALID_PARAMS,
        'Sender XRPL address required'
      );
    }
  }

  /**
   * Wait for USDC balance after Axelar bridge delivery
   */
  private async waitForUSDCBalance(
    evmAddress: string,
    requiredAmount: number,
    maxWaitMs: number = 10 * 60 * 1000,
    pollIntervalMs: number = 15000
  ): Promise<boolean> {
    // Cancel any existing polling loop
    if (this.balanceAbortController) {
      console.log('[USDC Orchestrator] Cancelling previous USDC balance polling loop');
      this.balanceAbortController.abort();
    }
    this.balanceAbortController = new AbortController();
    const signal = this.balanceAbortController.signal;

    const startTime = Date.now();
    let pollCount = 0;

    console.log(`[USDC Orchestrator] Waiting for USDC delivery to EVM wallet...`);
    console.log(`  EVM Address: ${evmAddress}`);
    console.log(`  Required: ${requiredAmount} USDC`);
    console.log(`  Max wait: ${maxWaitMs / 1000}s`);

    while (!signal.aborted && Date.now() - startTime < maxWaitMs) {
      pollCount++;

      try {
        const balance = await usdcZKPoolService.getUSDCBalance(evmAddress);
        const balanceUsdc = parseFloat(formatUnits(balance, USDC_DECIMALS));

        console.log(`[USDC Orchestrator] USDC balance poll #${pollCount}: ${balanceUsdc.toFixed(6)} USDC`);

        if (balanceUsdc >= requiredAmount) {
          console.log(`[USDC Orchestrator] Sufficient USDC balance: ${balanceUsdc.toFixed(6)} >= ${requiredAmount} USDC`);
          this.balanceAbortController = null;
          return true;
        }

        // Emit progress update for UI
        const elapsed = Date.now() - startTime;
        const progress = Math.min(90, Math.round((elapsed / maxWaitMs) * 100));
        this.emitEvent('progress_update', {
          phase: 'BRIDGE_TO_EVM',
          message: `Waiting for Axelar bridge delivery... (${balanceUsdc.toFixed(2)} USDC received)`,
          progress,
        });

        // Wait before next poll
        await new Promise<void>((resolve) => {
          const timeoutId = setTimeout(resolve, pollIntervalMs);
          signal.addEventListener('abort', () => {
            clearTimeout(timeoutId);
            resolve();
          }, { once: true });
        });

      } catch (error) {
        if (signal.aborted) break;
        console.warn(`[USDC Orchestrator] USDC balance check failed (poll #${pollCount}):`, error);
        await new Promise<void>((resolve) => {
          const timeoutId = setTimeout(resolve, pollIntervalMs);
          signal.addEventListener('abort', () => {
            clearTimeout(timeoutId);
            resolve();
          }, { once: true });
        });
      }
    }

    if (signal.aborted) {
      console.log('[USDC Orchestrator] USDC balance polling was cancelled');
      throw new Error('Balance polling cancelled - phase is being retried');
    }

    this.balanceAbortController = null;

    const elapsed = (Date.now() - startTime) / 1000;
    throw new Error(
      `Timeout waiting for USDC delivery after ${elapsed.toFixed(0)}s. ` +
      `Axelar bridge may be delayed.`
    );
  }

  /**
   * Wait for bridge confirmation
   *
   * Uses USDC balance check on EVM as primary detection (most reliable for XRPL Amplifier)
   * Falls back to Axelar GMP API status check
   */
  private async waitForBridgeConfirmation(txHash: string): Promise<void> {
    console.log(`[USDC Orchestrator] Waiting for bridge confirmation: ${txHash}`);

    const maxWait = 300000; // 5 minutes (increased from 2 minutes)
    const pollInterval = 5000; // 5 seconds
    const startTime = Date.now();

    // Get the EVM wallet address for balance checking
    const evmAddress = this.currentTransaction?.params.senderEVM;
    if (!evmAddress) {
      console.warn('[USDC Orchestrator] No EVM wallet address for balance check');
    }

    let pollCount = 0;
    while (Date.now() - startTime < maxWait) {
      pollCount++;
      const elapsedSec = Math.round((Date.now() - startTime) / 1000);

      // Primary method: Check USDC balance on EVM wallet directly
      // This is most reliable for XRPL Amplifier-based bridges
      if (evmAddress) {
        try {
          const balance = await this.checkEvmUsdcBalance(evmAddress);
          console.log(`[USDC Orchestrator] Bridge poll #${pollCount} (${elapsedSec}s): EVM USDC balance = ${balance}`);

          if (balance > 0) {
            console.log(`[USDC Orchestrator] Bridge confirmed! USDC balance on EVM: ${balance}`);
            return;
          }
        } catch (balanceError) {
          console.warn('[USDC Orchestrator] EVM balance check failed:', balanceError);
        }
      }

      // Secondary method: Check Axelar GMP API status
      try {
        const status = await axelarUSDCBridgeService.getBridgeStatus(txHash);
        console.log(`[USDC Orchestrator] Axelar status: ${status.status} (${status.axelarStatus || 'unknown'})`);

        if (status.status === 'complete') {
          console.log('[USDC Orchestrator] Bridge confirmed via Axelar API');
          return;
        }

        if (status.status === 'failed') {
          throw new Error('Bridge transaction failed');
        }

        // Emit progress
        this.emitEvent('progress_update', {
          phase: this.currentTransaction?.currentPhase,
          progress: getUsdcPhaseProgress(this.currentTransaction?.currentPhase || 'INITIATE'),
          message: `Bridge confirming... (${elapsedSec}s elapsed)`,
        });
      } catch (statusError) {
        console.warn('[USDC Orchestrator] Axelar status check failed:', statusError);
      }

      await this.delay(pollInterval);
    }

    throw new Error(`Bridge confirmation timeout after ${maxWait / 1000}s`);
  }

  /**
   * Check USDC balance on EVM wallet
   * Returns balance in human-readable USDC units
   */
  private async checkEvmUsdcBalance(evmAddress: string): Promise<number> {
    const provider = evmProviderService.getProvider();
    const usdcContract = new Contract(
      USDC_TOKEN_ADDRESS,
      ['function balanceOf(address) view returns (uint256)'],
      provider
    );

    const balance = await usdcContract.balanceOf(evmAddress);
    const balanceFormatted = parseFloat(formatUnits(balance, USDC_DECIMALS));
    return balanceFormatted;
  }

  /**
   * Check if a transaction can be resumed
   */
  private isTransactionRecoverable(transaction: UsdcOrchestratorTransaction): boolean {
    if (transaction.currentPhase === 'COMPLETE') return false;

    if (transaction.currentPhase === 'FAILED') {
      return transaction.retryCount < transaction.maxRetries;
    }

    // Check if not too old (24 hours)
    const maxAge = 24 * 60 * 60 * 1000;
    const age = Date.now() - transaction.lastUpdatedAt;
    if (age > maxAge) {
      console.warn(`[USDC Orchestrator] Transaction ${transaction.id} is too old`);
      return false;
    }

    return true;
  }

  // ===========================================================================
  // Persistence Methods
  // ===========================================================================

  /**
   * Persist current transaction state
   */
  private async persistState(): Promise<void> {
    if (!this.currentTransaction) return;

    try {
      localStorage.setItem(
        USDC_STORAGE_KEY,
        JSON.stringify(this.currentTransaction)
      );
      this.emitEvent('state_persisted', {
        phase: this.currentTransaction.currentPhase,
        message: 'State saved',
      });
    } catch (error) {
      console.error('[USDC Orchestrator] Failed to persist state:', error);
    }
  }

  /**
   * Load active transaction from storage
   */
  private async loadActiveTransaction(): Promise<UsdcOrchestratorTransaction | null> {
    try {
      const data = localStorage.getItem(USDC_STORAGE_KEY);
      if (!data) return null;
      return JSON.parse(data) as UsdcOrchestratorTransaction;
    } catch (error) {
      console.error('[USDC Orchestrator] Failed to load active transaction:', error);
      return null;
    }
  }

  /**
   * Clear active transaction from storage
   */
  private async clearActiveTransaction(): Promise<void> {
    try {
      localStorage.removeItem(USDC_STORAGE_KEY);
    } catch (error) {
      console.error('[USDC Orchestrator] Failed to clear active transaction:', error);
    }
  }

  /**
   * Save to history
   */
  private async saveToHistory(transaction: UsdcOrchestratorTransaction): Promise<void> {
    try {
      const historyData = localStorage.getItem(USDC_HISTORY_KEY);
      const history: UsdcOrchestratorTransaction[] = historyData
        ? JSON.parse(historyData)
        : [];

      history.unshift(transaction);
      const trimmed = history.slice(0, 50);

      localStorage.setItem(USDC_HISTORY_KEY, JSON.stringify(trimmed));
    } catch (error) {
      console.error('[USDC Orchestrator] Failed to save to history:', error);
    }
  }

  // ===========================================================================
  // Timeout Methods
  // ===========================================================================

  /**
   * Set phase timeout
   */
  private setPhaseTimeout(phase: UsdcOrchestratorPhase): void {
    this.clearPhaseTimeout();

    // Extended timeout for DEPOSIT and BRIDGE phases (including BRIDGE_GAS)
    const EXTENDED_PHASES: UsdcOrchestratorPhase[] = ['BRIDGE_GAS', 'DEPOSIT', 'BRIDGE_TO_EVM', 'BRIDGE_TO_XRPL'];
    const EXTENDED_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes
    const timeoutMs = EXTENDED_PHASES.includes(phase) ? EXTENDED_TIMEOUT_MS : this.config.phaseTimeoutMs;

    this.phaseTimeoutId = setTimeout(async () => {
      if (this.currentTransaction?.currentPhase === phase) {
        await this.handlePhaseError(
          phase,
          new UsdcOrchestratorError(
            USDC_ORCHESTRATOR_ERROR_CODES.PHASE_TIMEOUT,
            `Phase ${phase} timed out after ${timeoutMs}ms`,
            phase
          )
        );
      }
    }, timeoutMs);
  }

  /**
   * Clear phase timeout
   */
  private clearPhaseTimeout(): void {
    if (this.phaseTimeoutId) {
      clearTimeout(this.phaseTimeoutId);
      this.phaseTimeoutId = null;
    }
  }

  /**
   * Delay helper
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Simulate delay for demo mode
   */
  private simulateDelay(ms: number): Promise<void> {
    return this.delay(ms);
  }

  // ===========================================================================
  // Cleanup
  // ===========================================================================

  /**
   * Cleanup resources
   */
  cleanup(): void {
    this.clearPhaseTimeout();
    this.isRunning = false;
    this.isExecutingPhase = false;
    this.pendingPhaseExecution = false;
    this.needsGasBridge = false;
    this.evmGasBalance = BigInt(0);
    this.removeAllListeners();

    if (this.balanceAbortController) {
      this.balanceAbortController.abort();
      this.balanceAbortController = null;
    }

    console.log('[USDC Orchestrator] Cleanup complete');
  }
}

// =============================================================================
// Export
// =============================================================================

/** Singleton instance */
export const usdcTransactionOrchestratorService = new UsdcTransactionOrchestratorService();

/** Export class for testing */
export { UsdcTransactionOrchestratorService };
