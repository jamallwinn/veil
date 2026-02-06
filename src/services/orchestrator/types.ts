/**
 * Transaction Orchestrator Types
 *
 * TypeScript interfaces for the transaction orchestration service.
 * Manages the 7-phase private transaction flow.
 */

// =============================================================================
// Phase Types
// =============================================================================

/**
 * All phases of a private transaction
 *
 * Flow:
 * INITIATE -> BRIDGE_TO_EVM -> DEPOSIT -> WAIT -> PROVE -> WITHDRAW -> BRIDGE_TO_XRPL -> COMPLETE
 */
export type OrchestratorPhase =
  | 'INITIATE'
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
export type PhaseStatus = 'pending' | 'active' | 'completed' | 'failed' | 'skipped';

/**
 * Phase result from each step
 */
export interface PhaseResult {
  success: boolean;
  phase: OrchestratorPhase;
  data?: Record<string, unknown>;
  error?: string;
  txHash?: string;
  timestamp: number;
}

// =============================================================================
// Pre-flight Types
// =============================================================================

/**
 * Individual pre-flight check result
 */
export interface PreflightCheck {
  name: string;
  status: 'pass' | 'fail' | 'warn';
  message: string;
  details?: Record<string, unknown>;
}

/**
 * Complete pre-flight validation result
 *
 * Run before start() to validate the entire transaction flow
 * will likely succeed without losing funds.
 */
export interface PreflightResult {
  /** Whether all critical checks passed */
  passed: boolean;
  /** Individual check results */
  checks: PreflightCheck[];
  /** Human-readable summary */
  summary: string;
}

// =============================================================================
// Transaction Types
// =============================================================================

/**
 * Transaction parameters for starting a private transaction
 */
export interface TransactionParams {
  /** Amount of XRP to send */
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
 * Complete transaction state persisted between phases
 */
export interface OrchestratorTransaction {
  /** Unique transaction ID */
  id: string;
  /** Current phase */
  currentPhase: OrchestratorPhase;
  /** Status of the current phase */
  phaseStatus: PhaseStatus;
  /** Transaction parameters */
  params: TransactionParams;
  /** Results from each completed phase */
  phaseResults: Partial<Record<OrchestratorPhase, PhaseResult>>;
  /** Transaction hashes */
  txHashes: {
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
 * Orchestrator event types
 */
export type OrchestratorEventType =
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
export interface OrchestratorEventPayload {
  type: OrchestratorEventType;
  transactionId: string;
  phase?: OrchestratorPhase;
  progress?: number;
  message?: string;
  data?: Record<string, unknown>;
  error?: string;
  timestamp: number;
}

/**
 * Event listener function type
 */
export type OrchestratorEventListener = (payload: OrchestratorEventPayload) => void;

// =============================================================================
// Configuration Types
// =============================================================================

/**
 * Orchestrator configuration
 */
export interface OrchestratorConfig {
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
}

/**
 * Default configuration
 */
export const DEFAULT_ORCHESTRATOR_CONFIG: OrchestratorConfig = {
  maxRetries: 3,
  retryDelayMs: 2000,
  phaseTimeoutMs: 120000, // 2 minutes
  defaultWaitDurationMs: 0, // No wait by default
  minAnonymitySetSize: 1, // At least 1 other deposit
  demoMode: false,
  autoResume: true,
};

// =============================================================================
// Error Types
// =============================================================================

/**
 * Orchestrator error codes
 */
export const ORCHESTRATOR_ERROR_CODES = {
  NOT_INITIALIZED: 'NOT_INITIALIZED',
  TRANSACTION_NOT_FOUND: 'TRANSACTION_NOT_FOUND',
  TRANSACTION_ALREADY_ACTIVE: 'TRANSACTION_ALREADY_ACTIVE',
  PHASE_FAILED: 'PHASE_FAILED',
  PHASE_TIMEOUT: 'PHASE_TIMEOUT',
  MAX_RETRIES_EXCEEDED: 'MAX_RETRIES_EXCEEDED',
  INVALID_PHASE_TRANSITION: 'INVALID_PHASE_TRANSITION',
  PERSISTENCE_ERROR: 'PERSISTENCE_ERROR',
  BRIDGE_ERROR: 'BRIDGE_ERROR',
  DEPOSIT_ERROR: 'DEPOSIT_ERROR',
  PROVE_ERROR: 'PROVE_ERROR',
  WITHDRAW_ERROR: 'WITHDRAW_ERROR',
  INVALID_PARAMS: 'INVALID_PARAMS',
  INSUFFICIENT_BALANCE: 'INSUFFICIENT_BALANCE',
} as const;

export type OrchestratorErrorCode =
  (typeof ORCHESTRATOR_ERROR_CODES)[keyof typeof ORCHESTRATOR_ERROR_CODES];

/**
 * Orchestrator error class
 */
export class OrchestratorError extends Error {
  constructor(
    public readonly code: OrchestratorErrorCode,
    message: string,
    public readonly phase?: OrchestratorPhase,
    public readonly originalError?: unknown
  ) {
    super(message);
    this.name = 'OrchestratorError';
  }
}

// =============================================================================
// User Stage Mapping
// =============================================================================

/**
 * Map orchestrator phases to user-facing stages
 */
export type UserStage = 'securing' | 'privacy' | 'delivery' | 'complete';

/**
 * Phase to user stage mapping
 *
 * Securing: INITIATE, BRIDGE_TO_EVM, DEPOSIT
 * Privacy: WAIT, PROVE
 * Delivery: WITHDRAW, BRIDGE_TO_XRPL
 */
export const PHASE_TO_USER_STAGE: Record<OrchestratorPhase, UserStage | null> = {
  INITIATE: 'securing',
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
 */
export const PHASE_ORDER: OrchestratorPhase[] = [
  'INITIATE',
  'BRIDGE_TO_EVM',
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
export const PHASE_DESCRIPTIONS: Record<OrchestratorPhase, string> = {
  INITIATE: 'Preparing transaction',
  BRIDGE_TO_EVM: 'Bridging XRP to EVM',
  DEPOSIT: 'Depositing to privacy pool',
  WAIT: 'Waiting for anonymity set',
  PROVE: 'Generating ZK proof',
  WITHDRAW: 'Withdrawing from privacy pool',
  BRIDGE_TO_XRPL: 'Bridging to recipient',
  COMPLETE: 'Transaction complete',
  FAILED: 'Transaction failed',
};

/**
 * Estimated durations per phase in ms (for progress UI)
 */
export const PHASE_ESTIMATED_DURATIONS: Record<OrchestratorPhase, number> = {
  INITIATE: 2000,
  BRIDGE_TO_EVM: 20000,
  DEPOSIT: 15000,
  WAIT: 0, // Variable
  PROVE: 30000,
  WITHDRAW: 15000,
  BRIDGE_TO_XRPL: 25000,
  COMPLETE: 0,
  FAILED: 0,
};

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Get progress percentage based on current phase
 */
export function getPhaseProgress(phase: OrchestratorPhase): number {
  const index = PHASE_ORDER.indexOf(phase);
  if (index === -1) return 0;
  // COMPLETE is 100%, so divide by (length - 1)
  return Math.round((index / (PHASE_ORDER.length - 1)) * 100);
}

/**
 * Get the next phase after the current one
 */
export function getNextPhase(
  currentPhase: OrchestratorPhase,
  skipWait?: boolean
): OrchestratorPhase | null {
  const index = PHASE_ORDER.indexOf(currentPhase);
  if (index === -1 || index >= PHASE_ORDER.length - 1) return null;

  const nextPhase = PHASE_ORDER[index + 1];

  // Skip WAIT phase if requested
  if (nextPhase === 'WAIT' && skipWait) {
    return PHASE_ORDER[index + 2] || null;
  }

  return nextPhase;
}

/**
 * Check if a phase transition is valid
 */
export function isValidPhaseTransition(
  from: OrchestratorPhase,
  to: OrchestratorPhase
): boolean {
  // Allow transition to FAILED from any phase
  if (to === 'FAILED') return true;

  const fromIndex = PHASE_ORDER.indexOf(from);
  const toIndex = PHASE_ORDER.indexOf(to);

  // Must move forward by exactly one step (or skip WAIT)
  return toIndex === fromIndex + 1 || (from === 'DEPOSIT' && to === 'PROVE');
}

/**
 * Generate a unique transaction ID
 */
export function generateTransactionId(): string {
  const timestamp = Date.now().toString(36).toUpperCase();
  const random = Math.random().toString(36).substring(2, 8).toUpperCase();
  return `VEIL-${timestamp}-${random}`;
}
