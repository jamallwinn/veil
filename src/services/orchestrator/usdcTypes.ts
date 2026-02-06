/**
 * USDC Transaction Orchestrator Types
 *
 * TypeScript interfaces for the USDC transaction orchestration service.
 * Manages the 9-phase private USDC transaction flow.
 *
 * KEY DIFFERENCE from XRP Orchestrator:
 * - Includes APPROVAL phase for ERC-20 token approval
 * - Uses USDC amounts and decimals (15 on EVM)
 * - Pool denomination is 100 USDC (vs 1 XRP)
 */

// =============================================================================
// Phase Types
// =============================================================================

/**
 * All phases of a private USDC transaction
 *
 * Flow:
 * INITIATE -> BRIDGE_GAS (conditional) -> BRIDGE_TO_EVM -> APPROVAL -> DEPOSIT -> WAIT -> PROVE -> WITHDRAW -> BRIDGE_TO_XRPL -> COMPLETE
 *
 * Note: BRIDGE_GAS comes before BRIDGE_TO_EVM because:
 * - EVM wallet is created with 0 balance
 * - APPROVAL and other EVM txs require native XRP for gas
 * - BRIDGE_GAS funds the wallet with XRP for gas fees (conditional - skipped if wallet already has gas)
 * - BRIDGE_TO_EVM bridges the USDC
 */
export type UsdcOrchestratorPhase =
  | 'INITIATE'
  | 'BRIDGE_GAS'    // Bridge XRP for gas fees (conditional - skipped if wallet has sufficient gas)
  | 'APPROVAL'      // ERC-20 token approval (unique to USDC)
  | 'BRIDGE_TO_EVM'
  | 'DEPOSIT'
  | 'WAIT'
  | 'PROVE'
  | 'WITHDRAW'
  | 'BRIDGE_TO_XRPL'
  | 'COMPLETE'
  | 'FAILED';

/**
 * Status of each phase
 */
export type UsdcPhaseStatus = 'pending' | 'active' | 'completed' | 'failed' | 'skipped';

/**
 * Phase result from each step
 */
export interface UsdcPhaseResult {
  success: boolean;
  phase: UsdcOrchestratorPhase;
  data?: Record<string, unknown>;
  error?: string;
  txHash?: string;
  timestamp: number;
}

// =============================================================================
// Transaction Types
// =============================================================================

/**
 * Transaction parameters for starting a private USDC transaction
 */
export interface UsdcTransactionParams {
  /** Amount of USDC to send (human-readable, e.g., "100") */
  amount: string;
  /** Recipient XRPL address */
  recipient: string;
  /** Sender XRPL address */
  senderXRPL: string;
  /** Sender EVM address (for privacy pool) */
  senderEVM?: string;
  /** Optional wait duration in ms for anonymity set growth */
  waitDuration?: number;
  /** Whether to skip waiting for anonymity set */
  skipWait?: boolean;
}

/**
 * Complete USDC transaction state persisted between phases
 */
export interface UsdcOrchestratorTransaction {
  /** Unique transaction ID */
  id: string;
  /** Current phase */
  currentPhase: UsdcOrchestratorPhase;
  /** Status of the current phase */
  phaseStatus: UsdcPhaseStatus;
  /** Transaction parameters */
  params: UsdcTransactionParams;
  /** Results from each completed phase */
  phaseResults: Partial<Record<UsdcOrchestratorPhase, UsdcPhaseResult>>;
  /** Transaction hashes */
  txHashes: {
    approval?: string;      // ERC-20 approval tx (unique to USDC)
    gasBridge?: string;     // XRP gas bridge tx (if gas was needed)
    xrplBridge?: string;
    deposit?: string;
    withdraw?: string;
    evmBridge?: string;
  };
  /** Deposit note data (commitment, leafIndex) */
  depositData?: {
    commitment: string;
    nullifierHash: string;
    leafIndex: number;
  };
  /** Withdrawal proof data */
  withdrawData?: {
    proofGenerated: boolean;
    proofTimestamp?: number;
  };
  /** Unix timestamp when started */
  startedAt: number;
  /** Unix timestamp when completed */
  completedAt?: number;
  /** Error message if failed */
  error?: string;
  /** Number of retries for current phase */
  retryCount: number;
  /** Maximum retries allowed */
  maxRetries: number;
  /** Last update timestamp */
  lastUpdatedAt: number;
}

// =============================================================================
// Event Types
// =============================================================================

/**
 * USDC Orchestrator event types
 */
export type UsdcOrchestratorEventType =
  | 'phase_started'
  | 'phase_completed'
  | 'phase_failed'
  | 'phase_retry'
  | 'transaction_complete'
  | 'transaction_failed'
  | 'progress_update'
  | 'state_persisted'
  | 'state_restored';

/**
 * Event payload structure
 */
export interface UsdcOrchestratorEventPayload {
  type: UsdcOrchestratorEventType;
  transactionId: string;
  phase?: UsdcOrchestratorPhase;
  progress?: number;
  message?: string;
  data?: Record<string, unknown>;
  error?: string;
  timestamp: number;
}

/**
 * Event listener function type
 */
export type UsdcOrchestratorEventListener = (payload: UsdcOrchestratorEventPayload) => void;

// =============================================================================
// Configuration Types
// =============================================================================

/**
 * USDC Orchestrator configuration
 */
export interface UsdcOrchestratorConfig {
  /** Maximum retries per phase */
  maxRetries: number;
  /** Base retry delay in ms */
  retryDelayMs: number;
  /** Timeout per phase in ms */
  phaseTimeoutMs: number;
  /** Default wait duration for anonymity set in ms */
  defaultWaitDurationMs: number;
  /** Minimum anonymity set size to proceed */
  minAnonymitySetSize: number;
  /** Enable demo mode */
  demoMode: boolean;
  /** Auto-resume on app launch */
  autoResume: boolean;
  /** Axelar environment */
  axelarEnvironment: 'mainnet' | 'testnet';
}

/**
 * Default configuration
 */
export const DEFAULT_USDC_ORCHESTRATOR_CONFIG: UsdcOrchestratorConfig = {
  maxRetries: 3,
  retryDelayMs: 2000,
  phaseTimeoutMs: 120000, // 2 minutes
  defaultWaitDurationMs: 0, // No wait by default
  minAnonymitySetSize: 1, // At least 1 other deposit
  demoMode: false,
  autoResume: true,
  axelarEnvironment: 'mainnet',
};

// =============================================================================
// Error Types
// =============================================================================

/**
 * USDC Orchestrator error codes
 */
export const USDC_ORCHESTRATOR_ERROR_CODES = {
  NOT_INITIALIZED: 'USDC_NOT_INITIALIZED',
  TRANSACTION_NOT_FOUND: 'USDC_TRANSACTION_NOT_FOUND',
  TRANSACTION_ALREADY_ACTIVE: 'USDC_TRANSACTION_ALREADY_ACTIVE',
  PHASE_FAILED: 'USDC_PHASE_FAILED',
  PHASE_TIMEOUT: 'USDC_PHASE_TIMEOUT',
  MAX_RETRIES_EXCEEDED: 'USDC_MAX_RETRIES_EXCEEDED',
  INVALID_PHASE_TRANSITION: 'USDC_INVALID_PHASE_TRANSITION',
  PERSISTENCE_ERROR: 'USDC_PERSISTENCE_ERROR',
  BRIDGE_ERROR: 'USDC_BRIDGE_ERROR',
  APPROVAL_ERROR: 'USDC_APPROVAL_ERROR',
  DEPOSIT_ERROR: 'USDC_DEPOSIT_ERROR',
  PROVE_ERROR: 'USDC_PROVE_ERROR',
  WITHDRAW_ERROR: 'USDC_WITHDRAW_ERROR',
  INVALID_PARAMS: 'USDC_INVALID_PARAMS',
  INSUFFICIENT_BALANCE: 'USDC_INSUFFICIENT_BALANCE',
  INSUFFICIENT_ALLOWANCE: 'USDC_INSUFFICIENT_ALLOWANCE',
} as const;

export type UsdcOrchestratorErrorCode =
  (typeof USDC_ORCHESTRATOR_ERROR_CODES)[keyof typeof USDC_ORCHESTRATOR_ERROR_CODES];

/**
 * USDC Orchestrator error class
 */
export class UsdcOrchestratorError extends Error {
  constructor(
    public readonly code: UsdcOrchestratorErrorCode,
    message: string,
    public readonly phase?: UsdcOrchestratorPhase,
    public readonly originalError?: unknown
  ) {
    super(message);
    this.name = 'UsdcOrchestratorError';
  }
}

// =============================================================================
// User Stage Mapping
// =============================================================================

/**
 * Map USDC orchestrator phases to user-facing stages
 */
export type UsdcUserStage = 'securing' | 'privacy' | 'delivery' | 'complete';

/**
 * Phase to user stage mapping
 *
 * Securing: INITIATE, BRIDGE_GAS, BRIDGE_TO_EVM, APPROVAL, DEPOSIT
 * Privacy: WAIT, PROVE
 * Delivery: WITHDRAW, BRIDGE_TO_XRPL
 */
export const USDC_PHASE_TO_USER_STAGE: Record<UsdcOrchestratorPhase, UsdcUserStage | null> = {
  INITIATE: 'securing',
  BRIDGE_GAS: 'securing',
  APPROVAL: 'securing',
  BRIDGE_TO_EVM: 'securing',
  DEPOSIT: 'securing',
  WAIT: 'privacy',
  PROVE: 'privacy',
  WITHDRAW: 'delivery',
  BRIDGE_TO_XRPL: 'delivery',
  COMPLETE: 'complete',
  FAILED: null,
};

/**
 * Phase order for progress calculation
 * Includes BRIDGE_GAS and APPROVAL phases (10 phases total)
 *
 * CRITICAL: BRIDGE_GAS comes before BRIDGE_TO_EVM because:
 * - EVM wallet starts with 0 balance
 * - APPROVAL and other EVM txs require native XRP for gas
 * - BRIDGE_GAS funds the wallet with XRP for gas fees first
 * - BRIDGE_TO_EVM then bridges the USDC
 *
 * Note: BRIDGE_GAS is conditional - skipped if wallet already has sufficient gas
 */
export const USDC_PHASE_ORDER: UsdcOrchestratorPhase[] = [
  'INITIATE',
  'BRIDGE_GAS',     // FIRST: Fund EVM wallet with XRP for gas (conditional)
  'BRIDGE_TO_EVM',  // SECOND: Bridge USDC to EVM
  'APPROVAL',       // THIRD: Now wallet has gas to approve USDC
  'DEPOSIT',
  'WAIT',
  'PROVE',
  'WITHDRAW',
  'BRIDGE_TO_XRPL',
  'COMPLETE',
];

/**
 * Phase descriptions for UI
 */
export const USDC_PHASE_DESCRIPTIONS: Record<UsdcOrchestratorPhase, string> = {
  INITIATE: 'Preparing USDC transaction',
  BRIDGE_GAS: 'Bridging XRP for gas fees',
  APPROVAL: 'Approving USDC for privacy pool',
  BRIDGE_TO_EVM: 'Bridging USDC to EVM',
  DEPOSIT: 'Depositing to privacy pool',
  WAIT: 'Waiting for anonymity set',
  PROVE: 'Generating ZK proof',
  WITHDRAW: 'Withdrawing from privacy pool',
  BRIDGE_TO_XRPL: 'Bridging USDC to recipient',
  COMPLETE: 'Transaction complete',
  FAILED: 'Transaction failed',
};

/**
 * Estimated durations per phase in ms (for progress UI)
 */
export const USDC_PHASE_ESTIMATED_DURATIONS: Record<UsdcOrchestratorPhase, number> = {
  INITIATE: 2000,
  BRIDGE_GAS: 30000,    // Axelar XRP bridge for gas
  APPROVAL: 10000,      // ERC-20 approval tx
  BRIDGE_TO_EVM: 30000, // Axelar USDC bridge
  DEPOSIT: 15000,
  WAIT: 0, // Variable
  PROVE: 30000,
  WITHDRAW: 15000,
  BRIDGE_TO_XRPL: 35000, // Bridge back to XRPL
  COMPLETE: 0,
  FAILED: 0,
};

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Get progress percentage based on current phase
 */
export function getUsdcPhaseProgress(phase: UsdcOrchestratorPhase): number {
  const index = USDC_PHASE_ORDER.indexOf(phase);
  if (index === -1) return 0;
  // COMPLETE is 100%, so divide by (length - 1)
  return Math.round((index / (USDC_PHASE_ORDER.length - 1)) * 100);
}

/**
 * Get the next phase after the current one
 */
export function getUsdcNextPhase(
  currentPhase: UsdcOrchestratorPhase,
  skipWait?: boolean
): UsdcOrchestratorPhase | null {
  const index = USDC_PHASE_ORDER.indexOf(currentPhase);
  if (index === -1 || index >= USDC_PHASE_ORDER.length - 1) return null;

  const nextPhase = USDC_PHASE_ORDER[index + 1];

  // Skip WAIT phase if requested
  if (nextPhase === 'WAIT' && skipWait) {
    return USDC_PHASE_ORDER[index + 2] || null;
  }

  return nextPhase;
}

/**
 * Check if a phase transition is valid
 */
export function isValidUsdcPhaseTransition(
  from: UsdcOrchestratorPhase,
  to: UsdcOrchestratorPhase
): boolean {
  // Allow transition to FAILED from any phase
  if (to === 'FAILED') return true;

  const fromIndex = USDC_PHASE_ORDER.indexOf(from);
  const toIndex = USDC_PHASE_ORDER.indexOf(to);

  // Must move forward by exactly one step, or:
  // - Skip BRIDGE_GAS (INITIATE -> BRIDGE_TO_EVM) if wallet already has gas
  // - Skip WAIT (DEPOSIT -> PROVE) if skipWait is true
  return (
    toIndex === fromIndex + 1 ||
    (from === 'INITIATE' && to === 'BRIDGE_TO_EVM') || // Skip BRIDGE_GAS if gas sufficient
    (from === 'DEPOSIT' && to === 'PROVE') // Skip WAIT if skipWait
  );
}

/**
 * Generate a unique USDC transaction ID
 */
export function generateUsdcTransactionId(): string {
  const timestamp = Date.now().toString(36).toUpperCase();
  const random = Math.random().toString(36).substring(2, 8).toUpperCase();
  return `USDC-${timestamp}-${random}`;
}
