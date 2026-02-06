/**
 * Transaction Orchestrator Service
 *
 * Central service managing the 7-phase private transaction flow:
 * INITIATE -> BRIDGE_TO_EVM -> DEPOSIT -> WAIT -> PROVE -> WITHDRAW -> BRIDGE_TO_XRPL -> COMPLETE
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
  OrchestratorPhase,
  PhaseResult,
  OrchestratorTransaction,
  TransactionParams,
  OrchestratorConfig,
  OrchestratorEventType,
  OrchestratorEventPayload,
  OrchestratorEventListener,
  PreflightCheck,
  PreflightResult,
} from './types';
import {
  OrchestratorError,
  ORCHESTRATOR_ERROR_CODES,
  DEFAULT_ORCHESTRATOR_CONFIG,
  PHASE_DESCRIPTIONS,
  getNextPhase,
  getPhaseProgress,
  isValidPhaseTransition,
  generateTransactionId,
} from './types';
import {
  transactionPersistenceService,
  type RecoveryResult,
} from './persistence';

// Import services for each phase
import { axelarBridgeService } from '@services/bridge';
import { zkPoolService, type DepositNote } from '@services/zkPool';
import { gemWalletService } from '@services/gemwallet';
import { evmSignerService } from '@services/evm/signer';
import { evmProviderService } from '@services/evm/provider';
import { evmService } from '@services/evm';
import { calculateBridgeAmount } from '@utils/fees';

// =============================================================================
// Terminal XRPL Error Detection
// =============================================================================

/**
 * Terminal XRPL error codes that should NOT be retried.
 * These errors indicate permanent failures that won't resolve with retries.
 * Retrying wastes user's XRP on transaction fees.
 */
const TERMINAL_XRPL_ERROR_CODES = [
  'tecUNFUNDED_PAYMENT',     // Insufficient funds
  'tecNO_DST',               // Destination doesn't exist
  'tecNO_DST_INSUF_XRP',     // Destination needs more XRP to receive
  'tecPATH_DRY',             // No path found for payment
  'tecINSUF_RESERVE_LINE',   // Below reserve for trustline
  'tecNO_PERMISSION',        // No permission for this operation
  'tecNO_LINE',              // No trust line exists
  'tecNO_AUTH',              // Not authorized
  'tecFROZEN',               // Asset is frozen
  'temBAD_AMOUNT',           // Invalid amount (permanent)
  'temBAD_CURRENCY',         // Invalid currency (permanent)
  'temBAD_EXPIRATION',       // Invalid expiration (permanent)
  'temBAD_ISSUER',           // Invalid issuer (permanent)
  'temBAD_OFFER',            // Invalid offer (permanent)
  'temBAD_PATH',             // Invalid path (permanent)
  'temBAD_SEND_XRP_PATHS',   // Cannot use paths with XRP (permanent)
  'temBAD_SEQUENCE',         // Bad sequence number (wallet issue)
  'temBAD_SIGNATURE',        // Invalid signature (permanent)
  'temDST_IS_SRC',           // Destination is source (permanent)
  'temDST_NEEDED',           // Destination required (permanent)
  'temINVALID',              // Invalid transaction (permanent)
  'temINVALID_FLAG',         // Invalid flag (permanent)
  'temREDUNDANT',            // Redundant transaction (permanent)
  'tefFAILURE',              // Transaction failed (permanent)
  'tefALREADY',              // Transaction already applied (permanent)
  'tefBAD_AUTH',             // Bad auth (permanent)
  'tefBAD_LEDGER',           // Bad ledger (permanent)
  'tefEXCEPTION',            // Exception during processing (permanent)
  'tefINTERNAL',             // Internal error (permanent)
  'tefNO_AUTH_REQUIRED',     // No auth required (permanent)
  'tefPAST_SEQ',             // Past sequence number (permanent)
] as const;

/**
 * Check if an error message contains a terminal XRPL error code.
 * Terminal errors should not be retried as they will always fail.
 *
 * @param errorMessage - The error message to check
 * @returns True if the error is terminal and should not be retried
 */
const isTerminalXRPLError = (errorMessage: string): boolean => {
  if (!errorMessage) return false;
  return TERMINAL_XRPL_ERROR_CODES.some(code => errorMessage.includes(code));
};

/**
 * Get a user-friendly message for terminal XRPL errors
 */
const getTerminalErrorMessage = (errorMessage: string): string => {
  // Extract the error code for clearer messaging
  for (const code of TERMINAL_XRPL_ERROR_CODES) {
    if (errorMessage.includes(code)) {
      switch (code) {
        case 'tecUNFUNDED_PAYMENT':
          return `Insufficient XRP balance. ${code}`;
        case 'tecNO_DST':
          return `Destination account does not exist. ${code}`;
        case 'tecNO_DST_INSUF_XRP':
          return `Destination account needs more XRP to receive payment. ${code}`;
        case 'tecPATH_DRY':
          return `No payment path found. ${code}`;
        case 'tecINSUF_RESERVE_LINE':
          return `Insufficient reserve for trust line. ${code}`;
        case 'tecNO_PERMISSION':
          return `No permission for this operation. ${code}`;
        case 'tecFROZEN':
          return `Asset is frozen. ${code}`;
        default:
          return `Transaction failed: ${code}. This error cannot be resolved by retrying.`;
      }
    }
  }
  return errorMessage;
};

// =============================================================================
// Re-exports
// =============================================================================

export * from './types';
export { transactionPersistenceService } from './persistence';
export type { RecoveryResult } from './persistence';

// =============================================================================
// Orchestrator Service
// =============================================================================

class TransactionOrchestratorService {
  private config: OrchestratorConfig;
  private currentTransaction: OrchestratorTransaction | null = null;
  private eventListeners: Map<OrchestratorEventType, Set<OrchestratorEventListener>> =
    new Map();
  private isRunning = false;
  private phaseTimeoutId: ReturnType<typeof setTimeout> | null = null;
  private demoMode = false;

  // Deposit note for withdrawal proof
  private depositNote: DepositNote | null = null;

  // AbortController for cancelling EVM balance polling
  // Prevents duplicate polling loops when phase retries occur
  private balanceAbortController: AbortController | null = null;

  // Lock to prevent concurrent phase executions
  // This prevents race conditions when executeCurrentPhase is called without await
  private isExecutingPhase = false;
  private pendingPhaseExecution = false;

  constructor(config?: Partial<OrchestratorConfig>) {
    this.config = { ...DEFAULT_ORCHESTRATOR_CONFIG, ...config };
    this.demoMode = this.config.demoMode;
    // Propagate demo mode to dependent services
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
    axelarBridgeService.setDemoMode(enabled);
    zkPoolService.setDemoMode(enabled);

    // Configure bridge with required services for real mode
    if (!enabled) {
      axelarBridgeService.setEVMProvider(evmProviderService);
      axelarBridgeService.setEVMSignerService(evmSignerService);
    }

    console.log(`[Orchestrator] Demo mode: ${enabled ? 'enabled' : 'disabled'}`);
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
  updateConfig(config: Partial<OrchestratorConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Get current configuration
   */
  getConfig(): OrchestratorConfig {
    return { ...this.config };
  }

  // ===========================================================================
  // Transaction Lifecycle
  // ===========================================================================

  /**
   * Start a new private transaction
   */
  async start(params: TransactionParams): Promise<OrchestratorTransaction> {
    // CRITICAL: Set running flag IMMEDIATELY to prevent race conditions
    // This must happen before any async work to block concurrent start() calls
    if (this.isRunning) {
      throw new OrchestratorError(
        ORCHESTRATOR_ERROR_CODES.TRANSACTION_ALREADY_ACTIVE,
        'A transaction is already in progress'
      );
    }

    // Set flag immediately before any async work
    this.isRunning = true;

    try {
      // Validate params
      this.validateParams(params);

      // Pre-flight balance validation (skip in demo mode)
      // This prevents wasted transaction fees on tecUNFUNDED_PAYMENT errors
      if (!this.demoMode) {
        await this.validateBalance(params);
      }

      // Initialize ZK pool if not already done
      if (!zkPoolService.isReady()) {
        console.log('[Orchestrator] Initializing ZK pool...');
        await zkPoolService.initialize();
      }

      // Configure bridge service for real mode
      if (!this.demoMode) {
        console.log('[Orchestrator] Configuring bridge service for real mode...');
        axelarBridgeService.setGemWalletService(gemWalletService);
        axelarBridgeService.setAxelarEnvironment('mainnet'); // XRPL EVM Mainnet (Chain ID: 1440000)
      }

      // Create new transaction
      const transaction: OrchestratorTransaction = {
        id: generateTransactionId(),
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
        message: PHASE_DESCRIPTIONS.INITIATE,
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
   * Resume a pending transaction
   */
  async resume(transaction?: OrchestratorTransaction): Promise<OrchestratorTransaction | null> {
    // CRITICAL: Check if already running to prevent duplicate executions
    // Without this guard, resume() can start a second parallel execution
    // causing race conditions and cancelled polling loops
    if (this.isRunning) {
      console.warn('[Orchestrator] Transaction already running, cannot resume');
      return this.currentTransaction;
    }

    // If no transaction provided, try to load from storage
    const txToResume =
      transaction || (await transactionPersistenceService.loadActiveTransaction());

    if (!txToResume) {
      console.log('[Orchestrator] No transaction to resume');
      return null;
    }

    // Validate it's resumable
    if (!transactionPersistenceService.isTransactionRecoverable(txToResume)) {
      throw new OrchestratorError(
        ORCHESTRATOR_ERROR_CODES.PHASE_FAILED,
        `Transaction ${txToResume.id} is not recoverable`,
        txToResume.currentPhase
      );
    }

    // Set as current and resume
    this.currentTransaction = txToResume;
    this.isRunning = true;

    // Initialize ZK pool if needed
    if (!zkPoolService.isReady()) {
      await zkPoolService.initialize();
    }

    // Configure bridge service for real mode
    if (!this.demoMode) {
      console.log('[Orchestrator] Configuring bridge service for real mode (resume)...');
      axelarBridgeService.setGemWalletService(gemWalletService);
      axelarBridgeService.setAxelarEnvironment('mainnet'); // XRPL EVM Mainnet (Chain ID: 1440000)
    }

    this.emitEvent('state_restored', {
      phase: txToResume.currentPhase,
      progress: getPhaseProgress(txToResume.currentPhase),
      message: `Resuming from ${PHASE_DESCRIPTIONS[txToResume.currentPhase]}`,
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

    console.log(`[Orchestrator] Transaction ${tx.id} aborted`);
  }

  /**
   * Get the current transaction
   */
  getCurrentTransaction(): OrchestratorTransaction | null {
    return this.currentTransaction ? { ...this.currentTransaction } : null;
  }

  /**
   * Get current phase
   */
  getCurrentPhase(): OrchestratorPhase | null {
    return this.currentTransaction?.currentPhase || null;
  }

  /**
   * Check if orchestrator is running
   */
  isActive(): boolean {
    return this.isRunning;
  }

  /**
   * Check for pending transactions on app launch
   */
  async checkForPendingTransactions(): Promise<RecoveryResult> {
    return transactionPersistenceService.checkForPendingTransactions();
  }

  // ===========================================================================
  // Pre-flight Validation
  // ===========================================================================

  /**
   * Comprehensive pre-flight check before sending any money
   *
   * This validates EVERYTHING that can be validated without actually
   * sending a transaction. Run this before start() to ensure the
   * entire flow has a high probability of success.
   *
   * @param params - Transaction parameters to validate
   * @returns PreflightResult with pass/fail status and detailed checks
   */
  async preflight(params: TransactionParams): Promise<PreflightResult> {
    console.log('[Orchestrator] ========== PRE-FLIGHT CHECK ==========');
    const checks: PreflightCheck[] = [];
    let allPassed = true;

    // 1. GemWallet Installation
    try {
      const isInstalled = await gemWalletService.isInstalled();
      checks.push({
        name: 'GemWallet Installed',
        status: isInstalled ? 'pass' : 'fail',
        message: isInstalled ? 'GemWallet extension detected' : 'GemWallet not found - install from gemwallet.app',
      });
      if (!isInstalled) allPassed = false;
    } catch (error) {
      checks.push({ name: 'GemWallet Installed', status: 'fail', message: `Error: ${error}` });
      allPassed = false;
    }

    // 2. Network Check (must be Mainnet)
    try {
      const network = await gemWalletService.getNetwork();
      const isMainnet = network === 'mainnet';
      checks.push({
        name: 'XRPL Network',
        status: isMainnet ? 'pass' : 'fail',
        message: isMainnet ? 'Connected to XRPL Mainnet' : `Wrong network: ${network}. Switch to Mainnet in GemWallet`,
      });
      if (!isMainnet) allPassed = false;
    } catch (error) {
      checks.push({ name: 'XRPL Network', status: 'warn', message: 'Could not verify network' });
    }

    // 3. Sender Address Validation
    const senderValid = gemWalletService.isValidAddress(params.senderXRPL);
    checks.push({
      name: 'Sender Address',
      status: senderValid ? 'pass' : 'fail',
      message: senderValid ? `Valid: ${params.senderXRPL.slice(0, 8)}...` : 'Invalid XRPL address format',
    });
    if (!senderValid) allPassed = false;

    // 4. Recipient Address Validation
    const recipientValid = gemWalletService.isValidAddress(params.recipient);
    checks.push({
      name: 'Recipient Address',
      status: recipientValid ? 'pass' : 'fail',
      message: recipientValid ? `Valid: ${params.recipient.slice(0, 8)}...` : 'Invalid XRPL address format',
    });
    if (!recipientValid) allPassed = false;

    // 5. Balance Check
    try {
      const XRPL_BASE_RESERVE = 10;
      const balance = await gemWalletService.getBalance(params.senderXRPL);
      if (balance) {
        const balanceNum = parseFloat(balance);
        const paymentAmount = parseFloat(params.amount);
        const bridgeAmount = calculateBridgeAmount(paymentAmount);
        const spendable = balanceNum - XRPL_BASE_RESERVE;

        const hasSufficient = spendable >= bridgeAmount;
        checks.push({
          name: 'Sufficient Balance',
          status: hasSufficient ? 'pass' : 'fail',
          message: hasSufficient
            ? `${spendable.toFixed(2)} XRP spendable (need ${bridgeAmount.toFixed(2)} XRP)`
            : `Insufficient! Have ${spendable.toFixed(2)} XRP, need ${bridgeAmount.toFixed(2)} XRP`,
          details: {
            totalBalance: balanceNum,
            reserve: XRPL_BASE_RESERVE,
            spendable,
            required: bridgeAmount,
            shortfall: hasSufficient ? 0 : bridgeAmount - spendable,
          },
        });
        if (!hasSufficient) allPassed = false;
      } else {
        checks.push({ name: 'Sufficient Balance', status: 'fail', message: 'Could not fetch balance' });
        allPassed = false;
      }
    } catch (error) {
      checks.push({ name: 'Sufficient Balance', status: 'fail', message: `Error: ${error}` });
      allPassed = false;
    }

    // 6. Axelar Bridge Address Verification
    try {
      const bridgeConfig = axelarBridgeService.getConfig();
      const bridgeAddress = bridgeConfig.addresses?.XRPL_BRIDGE;
      const expectedBridge = 'rfmS3zqrQrka8wVyhXifEeyTwe8AMz2Yhw';
      const isCorrect = bridgeAddress === expectedBridge;
      checks.push({
        name: 'Axelar Bridge Address',
        status: isCorrect ? 'pass' : 'fail',
        message: isCorrect ? `Correct: ${bridgeAddress}` : `Wrong bridge! Got ${bridgeAddress}, expected ${expectedBridge}`,
      });
      if (!isCorrect) allPassed = false;
    } catch (error) {
      checks.push({ name: 'Axelar Bridge Address', status: 'fail', message: `Error: ${error}` });
      allPassed = false;
    }

    // 7. XRPL EVM RPC Connectivity
    try {
      const response = await fetch('https://rpc.xrplevm.org', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', method: 'eth_chainId', params: [], id: 1 }),
      });
      const data = await response.json();
      const chainId = parseInt(data.result, 16);
      const isCorrectChain = chainId === 1440000;
      checks.push({
        name: 'XRPL EVM RPC',
        status: isCorrectChain ? 'pass' : 'fail',
        message: isCorrectChain ? `Connected to chain ${chainId}` : `Wrong chain: ${chainId}, expected 1440000`,
      });
      if (!isCorrectChain) allPassed = false;
    } catch (error) {
      checks.push({ name: 'XRPL EVM RPC', status: 'fail', message: `Cannot connect: ${error}` });
      allPassed = false;
    }

    // 8. Privacy Pool Contract (1 XRP denomination)
    try {
      const poolAddress = '0xf765F2A56EF0f6d09438E2113a2FC9932b9645bB'; // PrivacyPoolNative
      const response = await fetch('https://rpc.xrplevm.org', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'eth_getCode',
          params: [poolAddress, 'latest'],
          id: 1,
        }),
      });
      const data = await response.json();
      const hasCode = data.result && data.result !== '0x' && data.result.length > 10;
      checks.push({
        name: 'Privacy Pool Contract',
        status: hasCode ? 'pass' : 'fail',
        message: hasCode ? `Deployed at ${poolAddress.slice(0, 10)}...` : 'Contract not found!',
      });
      if (!hasCode) allPassed = false;
    } catch (error) {
      checks.push({ name: 'Privacy Pool Contract', status: 'fail', message: `Error: ${error}` });
      allPassed = false;
    }

    // 9. Verifier Contract
    try {
      const verifierAddress = '0x8EAd4fb6e3fEA46c22a39f2da02E65E916D2Cd13';
      const response = await fetch('https://rpc.xrplevm.org', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'eth_getCode',
          params: [verifierAddress, 'latest'],
          id: 1,
        }),
      });
      const data = await response.json();
      const hasCode = data.result && data.result !== '0x' && data.result.length > 10;
      checks.push({
        name: 'Groth16 Verifier Contract',
        status: hasCode ? 'pass' : 'fail',
        message: hasCode ? `Deployed at ${verifierAddress.slice(0, 10)}...` : 'Contract not found!',
      });
      if (!hasCode) allPassed = false;
    } catch (error) {
      checks.push({ name: 'Groth16 Verifier Contract', status: 'fail', message: `Error: ${error}` });
      allPassed = false;
    }

    // 10. ZK Prover Readiness
    try {
      const proverReady = zkPoolService.isReady();
      checks.push({
        name: 'ZK Prover',
        status: proverReady ? 'pass' : 'warn',
        message: proverReady ? 'Initialized and ready' : 'Not initialized (will init on start)',
      });
    } catch (error) {
      checks.push({ name: 'ZK Prover', status: 'warn', message: `Not ready: ${error}` });
    }

    // 11. Axelar API Reachability
    try {
      const response = await fetch('https://api.axelarscan.io/api/getChains', {
        method: 'GET',
        signal: AbortSignal.timeout(5000),
      });
      const isReachable = response.ok;
      checks.push({
        name: 'Axelar API',
        status: isReachable ? 'pass' : 'warn',
        message: isReachable ? 'API reachable' : 'API may be slow or unavailable',
      });
    } catch (error) {
      checks.push({ name: 'Axelar API', status: 'warn', message: 'Could not reach API (may still work)' });
    }

    // Print results
    console.log('[Orchestrator] Pre-flight Results:');
    for (const check of checks) {
      const icon = check.status === 'pass' ? '✓' : check.status === 'fail' ? '✗' : '⚠';
      console.log(`  ${icon} ${check.name}: ${check.message}`);
    }
    console.log(`[Orchestrator] Overall: ${allPassed ? 'ALL CHECKS PASSED' : 'SOME CHECKS FAILED'}`);
    console.log('[Orchestrator] ======================================');

    return {
      passed: allPassed,
      checks,
      summary: allPassed
        ? 'All pre-flight checks passed. Ready to proceed.'
        : 'Some checks failed. Please fix issues before proceeding.',
    };
  }

  // ===========================================================================
  // Event System
  // ===========================================================================

  /**
   * Subscribe to orchestrator events
   */
  on(event: OrchestratorEventType, listener: OrchestratorEventListener): () => void {
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
  off(event: OrchestratorEventType, listener?: OrchestratorEventListener): void {
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
    type: OrchestratorEventType,
    data: Partial<Omit<OrchestratorEventPayload, 'type' | 'transactionId' | 'timestamp'>>
  ): void {
    const payload: OrchestratorEventPayload = {
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
          console.error(`[Orchestrator] Error in event listener for ${type}:`, error);
        }
      });
    }
  }

  // ===========================================================================
  // Phase Execution
  // ===========================================================================

  /**
   * Execute the current phase
   *
   * CRITICAL: This method has a concurrency guard to prevent race conditions.
   * When executeCurrentPhase() is called while another execution is in progress,
   * it marks a pending execution flag instead of starting immediately.
   * The in-progress execution will check this flag and start the next phase.
   */
  private async executeCurrentPhase(): Promise<void> {
    if (!this.currentTransaction || !this.isRunning) {
      return;
    }

    // CONCURRENCY GUARD: Prevent concurrent phase executions
    // If we're already executing a phase, mark that we need to execute again
    // and return. The current execution will check this flag when it completes.
    if (this.isExecutingPhase) {
      console.log('[Orchestrator] Phase execution already in progress, marking pending');
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
        // Use setImmediate pattern to avoid stack overflow
        setTimeout(() => this.executeCurrentPhase(), 0);
      }
    }
  }

  /**
   * Internal phase execution - called by executeCurrentPhase after acquiring lock
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
      progress: getPhaseProgress(phase),
      message: PHASE_DESCRIPTIONS[phase],
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
  private async executePhase(phase: OrchestratorPhase): Promise<PhaseResult> {
    console.log(`[Orchestrator] Executing phase: ${phase}`);

    switch (phase) {
      case 'INITIATE':
        return this.executeInitiate();
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
        throw new OrchestratorError(
          ORCHESTRATOR_ERROR_CODES.INVALID_PHASE_TRANSITION,
          `Unknown phase: ${phase}`
        );
    }
  }

  // ===========================================================================
  // Phase Implementations
  // ===========================================================================

  /**
   * Phase 1: INITIATE - Validate inputs and prepare transaction
   */
  private async executeInitiate(): Promise<PhaseResult> {
    const tx = this.currentTransaction!;

    try {
      // In demo mode, just simulate
      if (this.demoMode) {
        await this.simulateDelay(1500);
        return {
          success: true,
          phase: 'INITIATE',
          timestamp: Date.now(),
          data: { validated: true },
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

      return {
        success: true,
        phase: 'INITIATE',
        timestamp: Date.now(),
        data: { validated: true },
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
   * Phase 2: BRIDGE_TO_EVM - Bridge XRP to wXRP via Axelar
   *
   * The bridge amount includes:
   * - Payment amount (what recipient receives)
   * - Bridge fees (both directions)
   * - EVM gas costs (deposit + withdraw)
   * - Privacy pool fee (0.5%)
   * - XRPL network fee
   *
   * CRITICAL: This method checks if a bridge payment was already sent before
   * initiating a new one. This prevents duplicate payments on retry.
   */
  private async executeBridgeToEVM(): Promise<PhaseResult> {
    const tx = this.currentTransaction!;

    try {
      // Log bridge mode for debugging
      console.log(`[Orchestrator] Bridge mode: ${this.demoMode ? 'DEMO' : 'REAL'}`);

      // CRITICAL: Check if bridge payment was already sent (prevents duplicate payments on retry)
      // If we have a stored tx hash from a previous attempt, skip sending a new payment
      // and proceed directly to waiting for confirmation.
      if (tx.txHashes.xrplBridge) {
        console.log('[Orchestrator] Bridge payment already sent, skipping duplicate payment');
        console.log(`[Orchestrator] Existing tx hash: ${tx.txHashes.xrplBridge}`);

        // FIRST: Check XRPL ledger to see if the tx was already confirmed
        // This is more reliable than Axelar for XRPL native transactions
        const existingTxHash = tx.txHashes.xrplBridge;
        const xrplStatus = await this.verifyXRPLTransaction(existingTxHash);

        if (xrplStatus) {
          // Transaction IS confirmed on XRPL ledger - Axelar will process it
          console.log('[Orchestrator] Existing tx CONFIRMED on XRPL ledger - no need to wait');
          return {
            success: true,
            phase: 'BRIDGE_TO_EVM',
            timestamp: Date.now(),
            txHash: existingTxHash,
            data: {
              evmAddress: tx.params.senderEVM,
              resumedFromExistingTx: true,
              xrplLedgerConfirmed: true,
            },
          };
        }

        // If not yet on ledger, wait for confirmation
        // Note: waitForBridgeConfirmation now does FINAL XRPL check before throwing
        try {
          await this.waitForBridgeConfirmation(existingTxHash);

          // Return success with the existing tx hash
          return {
            success: true,
            phase: 'BRIDGE_TO_EVM',
            timestamp: Date.now(),
            txHash: existingTxHash,
            data: {
              evmAddress: tx.params.senderEVM,
              resumedFromExistingTx: true,
            },
          };
        } catch (confirmError) {
          // CRITICAL FIX: Do NOT clear the tx hash unless we're 100% sure the XRPL tx failed
          // The error message tells us if XRPL confirmed the tx
          const errorMsg = confirmError instanceof Error ? confirmError.message : String(confirmError);

          // Only allow new payment if XRPL ledger check also failed
          // Check one more time to be absolutely sure
          const finalXrplCheck = await this.verifyXRPLTransaction(existingTxHash);
          if (finalXrplCheck) {
            console.log('[Orchestrator] XRPL tx IS confirmed despite timeout - proceeding');
            return {
              success: true,
              phase: 'BRIDGE_TO_EVM',
              timestamp: Date.now(),
              txHash: existingTxHash,
              data: {
                evmAddress: tx.params.senderEVM,
                resumedFromExistingTx: true,
                confirmedAfterTimeout: true,
              },
            };
          }

          // If the error indicates the tx was NOT found on XRPL ledger, we can retry
          if (errorMsg.includes('not found on ledger')) {
            console.warn('[Orchestrator] Existing tx NOT found on XRPL ledger - allowing new payment');
            tx.txHashes.xrplBridge = undefined;
            await this.persistState();
          } else {
            // For any other error (network, timeout, etc.), DO NOT clear the hash
            // This prevents duplicate payments when the tx might actually be on ledger
            console.error('[Orchestrator] Confirmation error, but NOT clearing tx hash to prevent duplicates');
            console.error('[Orchestrator] Error:', errorMsg);
            console.error('[Orchestrator] User may need to check XRPL explorer manually for tx:', existingTxHash);
            throw new Error(`Bridge confirmation failed. Check XRPL explorer for tx: ${existingTxHash}`);
          }
        }
      }

      // Get EVM address (either from params or from signer)
      let evmAddress = tx.params.senderEVM;
      if (!evmAddress && !this.demoMode) {
        // Try to get existing wallet or create new one
        evmAddress = await evmSignerService.getAddress() || undefined;
        if (!evmAddress) {
          // Auto-create internal EVM wallet
          console.log('[Orchestrator] Creating internal EVM wallet...');
          const wallet = await evmSignerService.createWallet();
          evmAddress = wallet.address;
        }
      }
      if (!evmAddress && !this.demoMode) {
        throw new Error('Failed to create EVM wallet');
      }

      // In demo mode, use a mock address
      const targetEVM =
        evmAddress || '0x' + '0'.repeat(40);

      // Calculate bridge amount: payment + all fees
      // This ensures the internal EVM wallet has enough XRP for:
      // - Deposit gas, withdraw gas, bridge call gas
      // - Privacy pool fee
      // - Return bridge fee
      const paymentAmount = parseFloat(tx.params.amount);
      const bridgeAmount = calculateBridgeAmount(paymentAmount);

      console.log(`[Orchestrator] Payment: ${paymentAmount} XRP, Bridge amount: ${bridgeAmount} XRP`);

      // Execute bridge with the total amount needed
      const result = await axelarBridgeService.bridgeToEVM(
        bridgeAmount.toString(),
        tx.params.senderXRPL,
        targetEVM
      );

      if (!result.success) {
        throw new Error(result.error || 'Bridge to EVM failed');
      }

      // Save EVM address for later phases
      if (evmAddress) {
        tx.params.senderEVM = evmAddress;
      }

      // CRITICAL: Store tx hash and persist IMMEDIATELY after sending payment
      // This ensures that if the app crashes or fails during confirmation,
      // we can resume without sending duplicate payments.
      if (result.txHash) {
        tx.txHashes.xrplBridge = result.txHash;
        console.log(`[Orchestrator] Bridge payment sent, tx hash: ${result.txHash}`);
        console.log('[Orchestrator] Persisting tx hash immediately to prevent duplicate payments on retry...');
        await this.persistState();

        // Now wait for bridge confirmation
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
   * Phase 3: DEPOSIT - Deposit wXRP to privacy pool
   *
   * This phase waits for Axelar bridge to deliver wXRP to the EVM wallet
   * before attempting the privacy pool deposit. The bridge typically takes
   * 2-5 minutes to complete.
   */
  private async executeDeposit(): Promise<PhaseResult> {
    const tx = this.currentTransaction!;

    try {
      // Get the EVM signer and set it on zkPoolService
      let evmAddress: string | undefined;

      if (!this.demoMode) {
        const signer = await evmSignerService.getSigner();
        if (!signer) {
          throw new Error('No EVM signer available. Wallet may not be initialized.');
        }
        zkPoolService.setSigner(signer);
        evmAddress = await signer.getAddress();
        console.log('[Orchestrator] Set signer on zkPoolService:', evmAddress);

        // Wait for Axelar bridge to deliver wXRP to EVM wallet
        // This is critical - the bridge takes 2-5 minutes typically
        // IMPORTANT: We need payment amount PLUS gas costs for the deposit transaction
        // The deposit transaction requires ~1.5 XRP for gas on XRPL EVM (high gas prices)
        const paymentAmount = parseFloat(tx.params.amount);
        const EVM_GAS_BUFFER = 1.5; // Match MIN_EVM_GAS_BUFFER_XRP from fees.ts
        const requiredAmount = paymentAmount + EVM_GAS_BUFFER;
        console.log(`[Orchestrator] Waiting for ${requiredAmount} XRP to arrive on EVM (${paymentAmount} payment + ${EVM_GAS_BUFFER} gas)...`);

        await this.waitForEVMBalance(evmAddress, requiredAmount);
        console.log('[Orchestrator] wXRP received, proceeding with deposit');
      }

      // Convert amount to wei
      const amountWei = BigInt(Math.floor(parseFloat(tx.params.amount) * 1e18));

      // Create and execute deposit
      const depositResult = await zkPoolService.deposit(amountWei);

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
   * Phase 4: WAIT - Wait for anonymity set growth (optional)
   */
  private async executeWait(): Promise<PhaseResult> {
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
        console.log(`[Orchestrator] Waiting ${waitDuration}ms for anonymity set...`);

        // Emit progress updates during wait
        const startTime = Date.now();
        const updateInterval = 1000;

        await new Promise<void>((resolve) => {
          const checkProgress = setInterval(() => {
            const elapsed = Date.now() - startTime;
            const progress = Math.min(100, Math.round((elapsed / waitDuration) * 100));

            this.emitEvent('progress_update', {
              phase: 'WAIT',
              progress: getPhaseProgress('WAIT'),
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
   * Phase 5: PROVE - Generate ZK withdrawal proof
   */
  private async executeProve(): Promise<PhaseResult> {
    const tx = this.currentTransaction!;

    try {
      // Need the deposit note
      if (!this.depositNote && tx.depositData) {
        // Try to restore from stored notes
        const notes = await zkPoolService.getAllNotes();
        this.depositNote = notes.find(
          (n) => n.commitment === tx.depositData!.commitment
        ) || null;
      }

      if (!this.depositNote) {
        throw new Error('Deposit note not found - cannot generate proof');
      }

      // Generate a fresh recipient EVM address for withdrawal
      // In a real system, this would be a fresh address
      const recipientEVM =
        tx.params.senderEVM || '0x' + '0'.repeat(40);

      // Generate the ZK proof
      console.log('[Orchestrator] Generating ZK proof...');
      await zkPoolService.generateWithdrawProof(
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
   * Phase 6: WITHDRAW - Withdraw from privacy pool
   */
  private async executeWithdraw(): Promise<PhaseResult> {
    const tx = this.currentTransaction!;

    try {
      if (!this.depositNote) {
        throw new Error('Deposit note not found');
      }

      // Get the EVM address for withdrawal
      const recipientEVM =
        tx.params.senderEVM || '0x' + '0'.repeat(40);

      // Execute withdrawal
      const result = await zkPoolService.withdraw(this.depositNote, recipientEVM);

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
   * Phase 7: BRIDGE_TO_XRPL - Bridge wXRP back to XRPL
   */
  private async executeBridgeToXRPL(): Promise<PhaseResult> {
    const tx = this.currentTransaction!;

    try {
      const fromEVM = tx.params.senderEVM || '0x' + '0'.repeat(40);

      // Execute bridge to XRPL
      const result = await axelarBridgeService.bridgeToXRPL(
        tx.params.amount,
        fromEVM,
        tx.params.recipient
      );

      if (!result.success) {
        throw new Error(result.error || 'Bridge to XRPL failed');
      }

      tx.txHashes.evmBridge = result.txHash || undefined;

      // Wait for bridge confirmation
      if (result.txHash) {
        await this.waitForBridgeConfirmation(result.txHash);
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

  // ===========================================================================
  // Phase Transition Handling
  // ===========================================================================

  /**
   * Handle successful phase completion
   */
  private async handlePhaseSuccess(result: PhaseResult): Promise<void> {
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
      progress: getPhaseProgress(completedPhase),
      message: `${PHASE_DESCRIPTIONS[completedPhase]} completed`,
      data: result.data,
    });

    // Persist state
    await this.persistState();

    // Get next phase
    const nextPhase = getNextPhase(completedPhase, tx.params.skipWait);

    if (nextPhase && nextPhase !== 'COMPLETE') {
      // Validate transition
      if (!isValidPhaseTransition(completedPhase, nextPhase)) {
        throw new OrchestratorError(
          ORCHESTRATOR_ERROR_CODES.INVALID_PHASE_TRANSITION,
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
   *
   * This method handles failed phases with smart retry logic:
   * - Terminal XRPL errors (e.g., tecUNFUNDED_PAYMENT) are NOT retried
   * - Transient errors are retried with exponential backoff
   * - Max retries is respected for non-terminal errors
   */
  private async handlePhaseFailure(result: PhaseResult): Promise<void> {
    if (!this.currentTransaction) return;

    const tx = this.currentTransaction;

    // Save phase result
    tx.phaseResults[result.phase] = result;
    tx.phaseStatus = 'failed';
    tx.lastUpdatedAt = Date.now();

    // Check for terminal XRPL errors - these should NOT be retried
    // Retrying terminal errors wastes user's XRP on transaction fees
    if (result.error && isTerminalXRPLError(result.error)) {
      console.warn(
        `[Orchestrator] Terminal XRPL error detected in ${result.phase}: ${result.error}`
      );
      console.warn('[Orchestrator] Skipping retry - this error cannot be resolved by retrying');

      // Get user-friendly error message
      const userFriendlyError = getTerminalErrorMessage(result.error);

      await this.handleTransactionFailed(userFriendlyError);
      return;
    }

    // Check retry count for non-terminal errors
    if (tx.retryCount < tx.maxRetries) {
      tx.retryCount++;

      this.emitEvent('phase_retry', {
        phase: result.phase,
        progress: getPhaseProgress(result.phase),
        message: `Retrying ${PHASE_DESCRIPTIONS[result.phase]} (${tx.retryCount}/${tx.maxRetries})`,
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
    phase: OrchestratorPhase,
    error: unknown
  ): Promise<void> {
    const errorMessage =
      error instanceof Error ? error.message : 'Unknown error occurred';

    const result: PhaseResult = {
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
    this.pendingPhaseExecution = false; // Clear pending execution on completion

    // Save to history
    await transactionPersistenceService.saveToHistory(tx);

    // Clear active transaction
    await transactionPersistenceService.clearActiveTransaction();

    // Emit completion event
    this.emitEvent('transaction_complete', {
      phase: 'COMPLETE',
      progress: 100,
      message: 'Transaction complete',
      data: {
        amount: tx.params.amount,
        recipient: tx.params.recipient,
        duration: tx.completedAt - tx.startedAt,
      },
    });

    console.log(`[Orchestrator] Transaction ${tx.id} completed successfully`);
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
    this.pendingPhaseExecution = false; // Clear pending execution on failure

    await this.persistState();

    this.emitEvent('transaction_failed', {
      phase: 'FAILED',
      progress: getPhaseProgress(tx.currentPhase),
      message: 'Transaction failed',
      error,
    });

    console.error(`[Orchestrator] Transaction ${tx.id} failed: ${error}`);
  }

  // ===========================================================================
  // Helper Methods
  // ===========================================================================

  /**
   * Validate transaction parameters
   */
  private validateParams(params: TransactionParams): void {
    if (!params.amount || parseFloat(params.amount) <= 0) {
      throw new OrchestratorError(
        ORCHESTRATOR_ERROR_CODES.INVALID_PARAMS,
        'Invalid amount'
      );
    }

    if (!params.recipient) {
      throw new OrchestratorError(
        ORCHESTRATOR_ERROR_CODES.INVALID_PARAMS,
        'Recipient address required'
      );
    }

    if (!params.senderXRPL) {
      throw new OrchestratorError(
        ORCHESTRATOR_ERROR_CODES.INVALID_PARAMS,
        'Sender XRPL address required'
      );
    }
  }

  /**
   * Pre-flight balance validation
   *
   * XRPL requires a 10 XRP base reserve that cannot be spent.
   * This validation prevents tecUNFUNDED_PAYMENT errors by checking
   * the user has enough spendable XRP BEFORE attempting any transaction.
   *
   * Spendable XRP = Total Balance - 10 XRP reserve - transaction fee
   *
   * @param params - Transaction parameters including sender address and amount
   * @throws OrchestratorError with INSUFFICIENT_BALANCE if balance is too low
   */
  private async validateBalance(params: TransactionParams): Promise<void> {
    const XRPL_BASE_RESERVE = 10; // 10 XRP minimum account balance
    const XRPL_TX_FEE = 0.00002; // ~20 drops for transaction fee

    console.log('[Orchestrator] Pre-flight balance validation...');

    // Fetch current balance from XRPL
    const xrplBalance = await gemWalletService.getBalance(params.senderXRPL);

    if (!xrplBalance) {
      console.warn('[Orchestrator] Could not fetch balance, skipping pre-flight check');
      return; // Allow transaction to proceed, it will fail at XRPL level if insufficient
    }

    const balance = parseFloat(xrplBalance);
    const spendable = balance - XRPL_BASE_RESERVE - XRPL_TX_FEE;

    // Calculate total required: payment amount + all bridge/pool fees
    const paymentAmount = parseFloat(params.amount);
    const bridgeAmount = calculateBridgeAmount(paymentAmount);

    console.log(`[Orchestrator] Balance check:`);
    console.log(`  Total balance: ${balance.toFixed(6)} XRP`);
    console.log(`  XRPL reserve:  ${XRPL_BASE_RESERVE} XRP`);
    console.log(`  Spendable:     ${spendable.toFixed(6)} XRP`);
    console.log(`  Required:      ${bridgeAmount.toFixed(6)} XRP (payment: ${paymentAmount}, + fees)`);

    if (spendable < bridgeAmount) {
      const shortfall = bridgeAmount - spendable;
      throw new OrchestratorError(
        ORCHESTRATOR_ERROR_CODES.INSUFFICIENT_BALANCE,
        `Insufficient spendable XRP. You have ${spendable.toFixed(2)} XRP available ` +
        `(${balance.toFixed(2)} XRP - 10 XRP reserve). ` +
        `Need ${bridgeAmount.toFixed(2)} XRP for this transaction. ` +
        `Short by ${shortfall.toFixed(2)} XRP.`
      );
    }

    console.log('[Orchestrator] Balance check passed');
  }

  /**
   * Wait for EVM balance after Axelar bridge delivery
   *
   * Axelar bridge takes 2-5 minutes to deliver wXRP to EVM wallet.
   * This method polls the EVM wallet balance until sufficient wXRP
   * is available for the privacy pool deposit.
   *
   * @param evmAddress - EVM wallet address to check
   * @param requiredAmount - Required balance in XRP (decimal)
   * @param maxWaitMs - Maximum wait time in milliseconds (default: 10 minutes)
   * @param pollIntervalMs - Polling interval (default: 15 seconds)
   * @returns true when balance is sufficient
   * @throws Error if timeout reached
   */
  private async waitForEVMBalance(
    evmAddress: string,
    requiredAmount: number,
    maxWaitMs: number = 10 * 60 * 1000, // 10 minutes max
    pollIntervalMs: number = 15000 // Poll every 15 seconds
  ): Promise<boolean> {
    // Cancel any existing polling loop to prevent duplicates
    // This is critical when phase retries occur - we must cancel the previous loop
    if (this.balanceAbortController) {
      console.log('[Orchestrator] Cancelling previous EVM balance polling loop');
      this.balanceAbortController.abort();
    }
    this.balanceAbortController = new AbortController();
    const signal = this.balanceAbortController.signal;

    const startTime = Date.now();
    let pollCount = 0;

    console.log(`[Orchestrator] Waiting for wXRP delivery to EVM wallet...`);
    console.log(`  EVM Address: ${evmAddress}`);
    console.log(`  Required: ${requiredAmount} XRP`);
    console.log(`  Max wait: ${maxWaitMs / 1000}s`);

    while (!signal.aborted && Date.now() - startTime < maxWaitMs) {
      pollCount++;

      try {
        const balance = await evmService.getBalance(evmAddress);
        const balanceXRP = parseFloat(balance.formatted);

        console.log(`[Orchestrator] EVM balance poll #${pollCount}: ${balanceXRP.toFixed(6)} XRP`);

        if (balanceXRP >= requiredAmount) {
          console.log(`[Orchestrator] ✓ Sufficient EVM balance: ${balanceXRP.toFixed(6)} >= ${requiredAmount} XRP`);
          // Clear abort controller on success
          this.balanceAbortController = null;
          return true;
        }

        // Emit progress update for UI
        const elapsed = Date.now() - startTime;
        const progress = Math.min(90, Math.round((elapsed / maxWaitMs) * 100));
        this.emitEvent('progress_update', {
          phase: 'BRIDGE_TO_EVM',
          message: `Waiting for Axelar bridge delivery... (${balanceXRP.toFixed(2)} XRP received)`,
          progress,
        });

        // Wait before next poll, but allow cancellation
        await new Promise<void>((resolve) => {
          const timeoutId = setTimeout(resolve, pollIntervalMs);
          // If aborted during wait, resolve immediately
          signal.addEventListener('abort', () => {
            clearTimeout(timeoutId);
            resolve();
          }, { once: true });
        });

      } catch (error) {
        // Check if we were aborted
        if (signal.aborted) {
          break;
        }
        console.warn(`[Orchestrator] EVM balance check failed (poll #${pollCount}):`, error);
        // Continue polling even on errors, but allow cancellation
        await new Promise<void>((resolve) => {
          const timeoutId = setTimeout(resolve, pollIntervalMs);
          signal.addEventListener('abort', () => {
            clearTimeout(timeoutId);
            resolve();
          }, { once: true });
        });
      }
    }

    // Check if we were cancelled
    if (signal.aborted) {
      console.log('[Orchestrator] EVM balance polling was cancelled (phase retry)');
      throw new Error('Balance polling cancelled - phase is being retried');
    }

    // Clear abort controller on timeout
    this.balanceAbortController = null;

    const elapsed = (Date.now() - startTime) / 1000;
    throw new Error(
      `Timeout waiting for wXRP delivery after ${elapsed.toFixed(0)}s. ` +
      `Axelar bridge may be delayed. Check https://axelarscan.io for status.`
    );
  }

  /**
   * Persist current transaction state
   */
  private async persistState(): Promise<void> {
    if (!this.currentTransaction) return;

    try {
      await transactionPersistenceService.saveActiveTransaction(
        this.currentTransaction
      );
      this.emitEvent('state_persisted', {
        phase: this.currentTransaction.currentPhase,
        message: 'State saved',
      });
    } catch (error) {
      console.error('[Orchestrator] Failed to persist state:', error);
    }
  }

  /**
   * Wait for bridge confirmation
   *
   * For XRPL -> EVM bridges, Axelar's GMP API may return 'cannot_fetch_status'
   * because XRPL is not an EVM chain. In this case, we verify the XRPL transaction
   * directly via the XRPL ledger after a threshold number of polls.
   *
   * The XRPL transaction is instant (validated in 3-5 seconds), so if Axelar
   * can't fetch status after ~6 seconds (3 polls), we check XRPL directly.
   *
   * CRITICAL: This method should NEVER throw an error for a confirmed XRPL transaction.
   * If the XRPL ledger shows the tx as validated, we MUST return successfully even if
   * Axelar cannot track the status. Throwing an error here causes duplicate payments.
   */
  private async waitForBridgeConfirmation(txHash: string, direction: 'toEVM' | 'toXRPL' = 'toEVM'): Promise<void> {
    console.log(`[Orchestrator] Waiting for bridge confirmation: ${txHash} (direction: ${direction})`);

    const maxWait = 120000; // 2 minutes
    const pollInterval = 2000;
    const startTime = Date.now();
    let pollCount = 0;
    let cannotFetchCount = 0;
    let xrplConfirmedOnLedger = false; // Track if we've verified XRPL tx

    while (Date.now() - startTime < maxWait) {
      pollCount++;
      const status = await axelarBridgeService.getBridgeStatus(txHash);

      if (status.status === 'complete') {
        console.log('[Orchestrator] Bridge confirmed via Axelar');
        return;
      }

      // Only treat as failed if it's a real Axelar failure AND we haven't confirmed on XRPL
      if (status.status === 'failed' && !xrplConfirmedOnLedger) {
        // Double-check XRPL ledger before declaring failure
        if (direction === 'toEVM') {
          const xrplCheck = await this.verifyXRPLTransaction(txHash);
          if (xrplCheck) {
            console.log('[Orchestrator] Axelar reports failed but XRPL ledger shows confirmed - proceeding');
            return;
          }
        }
        throw new Error('Bridge transaction failed');
      }

      // Track consecutive 'cannot_fetch_status' responses
      // This happens for XRPL -> EVM bridges because Axelar can't index XRPL natively
      if (status.axelarStatus === 'cannot_fetch_status') {
        cannotFetchCount++;
        console.log(`[Orchestrator] Axelar cannot_fetch_status (count: ${cannotFetchCount}, poll: ${pollCount})`);

        // For XRPL -> EVM bridges, verify XRPL transaction EARLY and AGGRESSIVELY
        // XRPL transactions finalize in 3-5 seconds, so after 3 polls (~6s) we can check
        if (pollCount >= 3 && direction === 'toEVM') {
          console.log('[Orchestrator] Checking XRPL ledger for transaction confirmation...');
          const xrplConfirmed = await this.verifyXRPLTransaction(txHash);
          if (xrplConfirmed) {
            // XRPL tx succeeded - Axelar will process it even if they can't track it
            console.log('[Orchestrator] XRPL transaction CONFIRMED on ledger - bridge will process');
            xrplConfirmedOnLedger = true;
            // Return immediately - no need to wait for Axelar when XRPL ledger confirms
            return;
          } else {
            console.log('[Orchestrator] XRPL transaction not yet validated, will retry...');
          }
        }
      } else {
        cannotFetchCount = 0; // Reset if we get a different status
      }

      // Emit progress
      this.emitEvent('progress_update', {
        phase: this.currentTransaction?.currentPhase,
        progress: getPhaseProgress(this.currentTransaction?.currentPhase || 'INITIATE'),
        message: xrplConfirmedOnLedger
          ? 'XRPL confirmed, waiting for bridge...'
          : `Bridge confirming... ${status.confirmations}/${status.requiredConfirmations}`,
      });

      await this.delay(pollInterval);
    }

    // CRITICAL: Before timing out, do a FINAL check on XRPL ledger
    // If the XRPL tx is confirmed, we MUST NOT throw - that would cause duplicate payments
    if (direction === 'toEVM') {
      console.log('[Orchestrator] Timeout reached - doing FINAL XRPL ledger verification...');
      const finalCheck = await this.verifyXRPLTransaction(txHash);
      if (finalCheck) {
        console.log('[Orchestrator] XRPL transaction IS confirmed on ledger - proceeding despite Axelar timeout');
        return; // SUCCESS - do not throw!
      }
    }

    throw new Error('Bridge confirmation timeout - XRPL transaction not found on ledger');
  }

  /**
   * Verify an XRPL transaction exists and is validated on the ledger
   *
   * This is used as a fallback when Axelar's GMP API returns 'cannot_fetch_status'
   * for XRPL -> EVM bridges. XRPL transactions are finalized within 3-5 seconds,
   * so if we're past a few seconds and the tx is on ledger, it's safe to proceed.
   *
   * CRITICAL: This is the authoritative source of truth for XRPL transactions.
   * If this returns true, the payment WAS sent and we should NEVER send another.
   *
   * @param txHash - The XRPL transaction hash to verify
   * @returns true if the transaction is validated on XRPL ledger
   */
  private async verifyXRPLTransaction(txHash: string): Promise<boolean> {
    // Retry up to 3 times with 1 second delay for network reliability
    const maxRetries = 3;
    const retryDelay = 1000;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        // Use GemWallet service to check transaction on XRPL
        // This queries the XRPL ledger directly via xrplcluster.com
        const txResult = await gemWalletService.getTransaction(txHash);

        if (txResult && txResult.validated) {
          console.log(`[Orchestrator] XRPL transaction ${txHash.slice(0, 16)}... is VALIDATED on ledger`);
          console.log(`[Orchestrator] Result: ${txResult.result}, Ledger: ${txResult.ledgerIndex}`);
          return true;
        }

        if (txResult) {
          console.log(`[Orchestrator] XRPL tx found but not yet validated (attempt ${attempt})`);
        } else {
          console.log(`[Orchestrator] XRPL tx not found (attempt ${attempt})`);
        }

        // If not the last attempt, wait and retry
        if (attempt < maxRetries) {
          await this.delay(retryDelay);
        }
      } catch (error) {
        console.warn(`[Orchestrator] XRPL verification attempt ${attempt} failed:`, error);

        // If not the last attempt, wait and retry
        if (attempt < maxRetries) {
          await this.delay(retryDelay);
        }
      }
    }

    console.log(`[Orchestrator] XRPL tx ${txHash.slice(0, 16)}... not validated after ${maxRetries} attempts`);
    return false;
  }

  /**
   * Set phase timeout
   *
   * DEPOSIT phase gets extended timeout because:
   * 1. Axelar bridge takes 2-10+ minutes to deliver wXRP
   * 2. Balance polling waits up to 10 minutes (600s)
   * 3. Default 2-minute timeout would cancel polling prematurely
   */
  private setPhaseTimeout(phase: OrchestratorPhase): void {
    this.clearPhaseTimeout();

    // DEPOSIT phase needs extended timeout for Axelar bridge delivery
    // Default is 2 minutes, but bridge can take 10+ minutes
    const DEPOSIT_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes for DEPOSIT
    const timeoutMs = phase === 'DEPOSIT' ? DEPOSIT_TIMEOUT_MS : this.config.phaseTimeoutMs;

    this.phaseTimeoutId = setTimeout(async () => {
      if (this.currentTransaction?.currentPhase === phase) {
        await this.handlePhaseError(
          phase,
          new OrchestratorError(
            ORCHESTRATOR_ERROR_CODES.PHASE_TIMEOUT,
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
    this.removeAllListeners();

    // Cancel any pending EVM balance polling
    if (this.balanceAbortController) {
      this.balanceAbortController.abort();
      this.balanceAbortController = null;
    }

    console.log('[Orchestrator] Cleanup complete');
  }
}

// =============================================================================
// Export
// =============================================================================

/** Singleton instance */
export const transactionOrchestratorService = new TransactionOrchestratorService();

/** Export class for testing */
export { TransactionOrchestratorService };
