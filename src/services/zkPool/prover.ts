/**
 * ZK Prover Service
 *
 * Generates and verifies ZK proofs using SnarkJS.
 * Uses the compiled Circom circuit artifacts for the withdrawal proof.
 *
 * Circuit: withdraw.circom
 * - 20-level Merkle tree
 * - Poseidon hash function
 * - Groth16 proving system
 *
 * Features:
 * - Direct snarkjs import (npm package)
 * - Optional Web Worker for non-blocking proof generation
 * - Demo mode for testing without real circuit artifacts
 */

import * as snarkjs from 'snarkjs';
import type {
  WithdrawCircuitInput,
  WithdrawProof,
  Groth16Proof,
  SolidityCalldata,
  ZKPoolConfig,
} from './types';
import { ZKPoolError, ZK_POOL_ERROR_CODES, DEFAULT_ZK_POOL_CONFIG } from './types';

// Import worker using Vite's ?worker suffix - this returns a Worker constructor
// that is properly bundled with correct MIME type handling
import ZkProverWorker from '../../workers/zkProver.worker?worker';

// =============================================================================
// Types
// =============================================================================

/**
 * Verification key structure
 */
interface VerificationKey {
  protocol: string;
  curve: string;
  nPublic: number;
  vk_alpha_1: string[];
  vk_beta_2: string[][];
  vk_gamma_2: string[][];
  vk_delta_2: string[][];
  vk_alphabeta_12: string[][][];
  IC: string[][];
}

/**
 * Worker message types for async proof generation
 */
interface WorkerResponse {
  type: 'SUCCESS' | 'ERROR' | 'PROGRESS';
  requestId: string;
  payload: unknown;
}

/**
 * Progress callback for tracking proof generation
 */
export type ProofProgressCallback = (message: string, percent: number) => void;

// =============================================================================
// Prover Service
// =============================================================================

/**
 * ZK Prover Service
 *
 * Handles proof generation and verification using SnarkJS.
 * In browser/desktop environment, circuit artifacts are loaded from public paths.
 *
 * Features:
 * - Direct snarkjs import (no global window dependency)
 * - Web Worker support for non-blocking proof generation
 * - Demo mode for testing
 */
class ProverService {
  private config: ZKPoolConfig;
  private verificationKey: VerificationKey | null = null;
  private initialized: boolean = false;
  private demoMode: boolean = false; // Default to real mode
  /** Tracks whether demoMode was explicitly set by the user */
  private demoModeExplicitlySet: boolean = false;
  /** Web Worker for async proof generation */
  private worker: Worker | null = null;
  /** Pending worker requests */
  private pendingRequests: Map<string, {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
    onProgress?: ProofProgressCallback;
  }> = new Map();

  constructor(config?: Partial<ZKPoolConfig>) {
    this.config = { ...DEFAULT_ZK_POOL_CONFIG, ...config };
    // If config explicitly specifies demoMode, track that
    if (config && 'demoMode' in config) {
      this.demoModeExplicitlySet = true;
      this.demoMode = config.demoMode ?? true;
    }
  }

  /**
   * Initialize the prover by loading circuit artifacts
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      console.log('[Prover] Already initialized');
      return;
    }

    try {
      console.log('[Prover] Initializing...');

      // In demo mode, we simulate proof generation
      if (this.demoMode) {
        this.initialized = true;
        console.log('[Prover] Initialized in demo mode');
        return;
      }

      // Verify snarkjs is available (imported at top of file)
      if (!snarkjs || !snarkjs.groth16) {
        // If demo mode was explicitly disabled, throw an error instead of silently falling back
        if (this.demoModeExplicitlySet && !this.demoMode) {
          throw new ZKPoolError(
            ZK_POOL_ERROR_CODES.CIRCUIT_LOAD_FAILED,
            'SnarkJS module not properly loaded and demo mode is disabled. Ensure snarkjs is installed via npm.'
          );
        }
        console.warn('[Prover] SnarkJS not properly loaded, falling back to demo mode');
        this.demoMode = true;
        this.initialized = true;
        return;
      }

      console.log('[Prover] SnarkJS loaded successfully');

      // Load verification key
      await this.loadVerificationKey();

      // Try to initialize Web Worker for async proof generation
      this.initializeWorker();

      this.initialized = true;
      console.log('[Prover] Initialized successfully with real proof generation');
    } catch (error) {
      // If demo mode was explicitly disabled, throw the error
      if (this.demoModeExplicitlySet && !this.demoMode) {
        throw new ZKPoolError(
          ZK_POOL_ERROR_CODES.CIRCUIT_LOAD_FAILED,
          `Failed to initialize prover: ${error instanceof Error ? error.message : 'Unknown error'}`,
          error
        );
      }
      // Otherwise fall back to demo mode
      console.warn('[Prover] Initialization failed, falling back to demo mode:', error);
      this.demoMode = true;
      this.initialized = true;
    }
  }

  /**
   * Initialize Web Worker for non-blocking proof generation
   *
   * Uses Vite's ?worker import suffix which returns a Worker constructor.
   * This ensures proper bundling and MIME type handling in both dev and production.
   * Falls back to main thread if worker creation fails.
   */
  private initializeWorker(): void {
    try {
      // Use the imported worker constructor from Vite's ?worker suffix
      // This approach ensures:
      // 1. The worker is properly bundled with its dependencies (snarkjs, etc.)
      // 2. Correct MIME type (application/javascript) is served
      // 3. Works in both dev and production builds
      // 4. Node polyfills from vite.config.ts worker config are applied
      this.worker = new ZkProverWorker();

      this.worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
        const { type, requestId, payload } = event.data;
        const pending = this.pendingRequests.get(requestId);

        if (!pending) {
          console.warn('[Prover] Received response for unknown request:', requestId);
          return;
        }

        switch (type) {
          case 'SUCCESS':
            pending.resolve(payload);
            this.pendingRequests.delete(requestId);
            break;
          case 'ERROR':
            pending.reject(new Error((payload as { message: string }).message));
            this.pendingRequests.delete(requestId);
            break;
          case 'PROGRESS':
            if (pending.onProgress) {
              const progress = payload as { message: string; percent: number };
              pending.onProgress(progress.message, progress.percent);
            }
            break;
        }
      };

      this.worker.onerror = (error) => {
        // Log detailed error info for debugging MIME type issues
        console.error('[Prover] Worker error:', error);
        if (error instanceof ErrorEvent) {
          console.error('[Prover] Worker error details:', {
            message: error.message,
            filename: error.filename,
            lineno: error.lineno,
            colno: error.colno,
          });
        }

        // Reject all pending requests and cleanup
        for (const [requestId, pending] of this.pendingRequests) {
          pending.reject(new Error('Worker initialization failed. Falling back to main thread.'));
          this.pendingRequests.delete(requestId);
        }

        // Cleanup failed worker
        this.worker?.terminate();
        this.worker = null;
      };

      console.log('[Prover] Web Worker initialized for async proof generation');
    } catch (error) {
      console.warn('[Prover] Could not initialize Web Worker, will use main thread:', error);
      this.worker = null;
    }
  }

  /**
   * Check if prover is initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Set demo mode
   * @param enabled - Whether to enable demo mode
   * @param explicit - Whether this is an explicit user setting (default: true)
   */
  setDemoMode(enabled: boolean, explicit: boolean = true): void {
    this.demoMode = enabled;
    if (explicit) {
      this.demoModeExplicitlySet = true;
    }
  }

  /**
   * Check if demo mode was explicitly configured
   */
  isDemoModeExplicitlySet(): boolean {
    return this.demoModeExplicitlySet;
  }

  /**
   * Check if in demo mode
   */
  isDemoMode(): boolean {
    return this.demoMode;
  }

  /**
   * Generate a withdrawal proof
   *
   * @param input - The circuit inputs (private and public)
   * @param onProgress - Optional callback for progress updates
   * @returns The generated proof with public signals
   */
  async generateWithdrawProof(
    input: WithdrawCircuitInput,
    onProgress?: ProofProgressCallback
  ): Promise<WithdrawProof> {
    if (!this.initialized) {
      throw new ZKPoolError(
        ZK_POOL_ERROR_CODES.NOT_INITIALIZED,
        'Prover not initialized. Call initialize() first.'
      );
    }

    try {
      console.log('[Prover] Generating withdrawal proof...');
      const startTime = Date.now();

      if (this.demoMode) {
        // Generate a demo proof
        const proof = await this.generateDemoProof(input);
        console.log(`[Prover] Demo proof generated in ${Date.now() - startTime}ms`);
        return proof;
      }

      // Prepare circuit input
      const circuitInput = {
        // Private inputs
        nullifier: input.nullifier,
        secret: input.secret,
        pathElements: input.pathElements,
        pathIndices: input.pathIndices,
        // Public inputs
        root: input.root,
        nullifierHash: input.nullifierHash,
        recipient: input.recipient,
        relayer: input.relayer,
        fee: input.fee,
        refund: input.refund,
      };

      // Try to use Web Worker for non-blocking generation
      if (this.worker) {
        try {
          const result = await this.generateProofViaWorker(input, onProgress);
          console.log(`[Prover] Proof generated via worker in ${Date.now() - startTime}ms`);
          return result;
        } catch (workerError) {
          console.warn('[Prover] Worker proof generation failed, falling back to main thread:', workerError);
          // Fall through to main thread generation
        }
      }

      // Main thread proof generation using snarkjs directly
      onProgress?.('Loading circuit artifacts...', 10);

      const { proof, publicSignals } = await snarkjs.groth16.fullProve(
        circuitInput,
        this.config.wasmPath,
        this.config.zkeyPath
      );

      onProgress?.('Proof generated successfully', 100);
      console.log(`[Prover] Proof generated in ${Date.now() - startTime}ms`);

      return { proof: proof as Groth16Proof, publicSignals: publicSignals as string[] };
    } catch (error) {
      throw new ZKPoolError(
        ZK_POOL_ERROR_CODES.PROOF_GENERATION_FAILED,
        `Failed to generate proof: ${error instanceof Error ? error.message : 'Unknown error'}`,
        error
      );
    }
  }

  /**
   * Generate proof using Web Worker (non-blocking)
   */
  private generateProofViaWorker(
    input: WithdrawCircuitInput,
    onProgress?: ProofProgressCallback
  ): Promise<WithdrawProof> {
    return new Promise((resolve, reject) => {
      if (!this.worker) {
        reject(new Error('Worker not available'));
        return;
      }

      const requestId = `proof-${Date.now()}-${Math.random().toString(36).slice(2)}`;

      this.pendingRequests.set(requestId, {
        resolve: resolve as (value: unknown) => void,
        reject,
        onProgress,
      });

      this.worker.postMessage({
        type: 'GENERATE_PROOF',
        requestId,
        payload: {
          input,
          wasmPath: this.config.wasmPath,
          zkeyPath: this.config.zkeyPath,
        },
      });
    });
  }

  /**
   * Verify a withdrawal proof locally
   *
   * @param proof - The proof to verify
   * @returns True if the proof is valid
   */
  async verifyProof(proof: WithdrawProof): Promise<boolean> {
    if (!this.initialized) {
      throw new ZKPoolError(
        ZK_POOL_ERROR_CODES.NOT_INITIALIZED,
        'Prover not initialized. Call initialize() first.'
      );
    }

    try {
      console.log('[Prover] Verifying proof...');

      if (this.demoMode) {
        // In demo mode, verify the proof structure
        return this.verifyDemoProof(proof);
      }

      if (!this.verificationKey) {
        throw new Error('Verification key not loaded');
      }

      const isValid = await snarkjs.groth16.verify(
        this.verificationKey,
        proof.publicSignals,
        proof.proof
      );

      console.log(`[Prover] Proof verification: ${isValid ? 'VALID' : 'INVALID'}`);
      return isValid;
    } catch (error) {
      throw new ZKPoolError(
        ZK_POOL_ERROR_CODES.PROOF_VERIFICATION_FAILED,
        `Failed to verify proof: ${error instanceof Error ? error.message : 'Unknown error'}`,
        error
      );
    }
  }

  /**
   * Export proof as Solidity calldata for contract interaction
   *
   * @param proof - The proof to export
   * @returns Solidity-compatible calldata
   */
  async exportSolidityCalldata(proof: WithdrawProof): Promise<SolidityCalldata> {
    try {
      if (this.demoMode) {
        // Generate formatted calldata from proof structure
        return this.formatSolidityCalldata(proof);
      }

      // Use snarkjs to export calldata in the correct format
      const calldata = await snarkjs.groth16.exportSolidityCallData(
        proof.proof,
        proof.publicSignals
      );

      // Parse the calldata string
      return this.parseCalldataString(calldata);
    } catch (error) {
      throw new ZKPoolError(
        ZK_POOL_ERROR_CODES.PROOF_GENERATION_FAILED,
        `Failed to export calldata: ${error instanceof Error ? error.message : 'Unknown error'}`,
        error
      );
    }
  }

  /**
   * Cleanup resources (terminate worker)
   */
  cleanup(): void {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
      console.log('[Prover] Worker terminated');
    }
    this.pendingRequests.clear();
  }

  /**
   * Check if worker is available for async proof generation
   */
  hasWorker(): boolean {
    return this.worker !== null;
  }

  // ===========================================================================
  // Private Methods
  // ===========================================================================

  /**
   * Load the verification key from file
   */
  private async loadVerificationKey(): Promise<void> {
    try {
      const response = await fetch(this.config.vkeyPath);
      if (!response.ok) {
        throw new Error(`Failed to load verification key: ${response.statusText}`);
      }
      this.verificationKey = await response.json();
      console.log('[Prover] Verification key loaded');
    } catch (error) {
      console.warn('[Prover] Could not load verification key:', error);
      // Continue without vkey - will use demo mode for verification
    }
  }

  /**
   * Generate a demo proof (for testing without real circuit)
   */
  private async generateDemoProof(input: WithdrawCircuitInput): Promise<WithdrawProof> {
    // Simulate proof generation delay
    await new Promise((resolve) => setTimeout(resolve, 500));

    // Create a deterministic demo proof based on input
    const demoProof: Groth16Proof = {
      pi_a: [
        this.hashInput(input.nullifier + '0'),
        this.hashInput(input.nullifier + '1'),
        '1',
      ],
      pi_b: [
        [this.hashInput(input.secret + '00'), this.hashInput(input.secret + '01')],
        [this.hashInput(input.secret + '10'), this.hashInput(input.secret + '11')],
        ['1', '0'],
      ],
      pi_c: [
        this.hashInput(input.root + '0'),
        this.hashInput(input.root + '1'),
        '1',
      ],
      protocol: 'groth16',
      curve: 'bn128',
    };

    // Public signals match the circuit outputs
    const publicSignals = [
      input.root,
      input.nullifierHash,
      input.recipient,
      input.relayer,
      input.fee,
      input.refund,
    ];

    return { proof: demoProof, publicSignals };
  }

  /**
   * Verify a demo proof (check structure)
   */
  private verifyDemoProof(proof: WithdrawProof): boolean {
    // Basic structure validation
    if (!proof.proof || !proof.publicSignals) {
      return false;
    }

    const { pi_a, pi_b, pi_c } = proof.proof;

    // Check array lengths
    if (pi_a.length !== 3 || pi_c.length !== 3) {
      return false;
    }

    if (pi_b.length !== 3 || !pi_b.every((row) => row.length === 2)) {
      return false;
    }

    // Check public signals (6 expected)
    if (proof.publicSignals.length !== 6) {
      return false;
    }

    return true;
  }

  /**
   * Simple hash for demo proof generation
   */
  private hashInput(input: string): string {
    // Simple deterministic "hash" for demo purposes
    let hash = BigInt(0);
    for (let i = 0; i < input.length; i++) {
      hash = (hash * BigInt(31) + BigInt(input.charCodeAt(i))) % BigInt(10) ** BigInt(77);
    }
    return hash.toString();
  }

  /**
   * Format proof as Solidity calldata
   */
  private formatSolidityCalldata(proof: WithdrawProof): SolidityCalldata {
    return {
      a: [proof.proof.pi_a[0], proof.proof.pi_a[1]],
      b: [
        [proof.proof.pi_b[0][1], proof.proof.pi_b[0][0]], // Note: reversed for Solidity
        [proof.proof.pi_b[1][1], proof.proof.pi_b[1][0]],
      ],
      c: [proof.proof.pi_c[0], proof.proof.pi_c[1]],
      input: proof.publicSignals,
    };
  }

  /**
   * Parse SnarkJS calldata string to structured format
   *
   * SnarkJS exportSolidityCallData returns a string like:
   * ["0x...", "0x..."], [["0x...", "0x..."], ["0x...", "0x..."]], ["0x...", "0x..."], ["0x...", ...]
   *
   * This is 4 comma-separated JSON arrays. We parse them by wrapping in brackets.
   * The hex strings are kept as strings (not converted to numbers) since BigInt
   * conversion happens later in the withdrawal flow.
   */
  private parseCalldataString(calldata: string): SolidityCalldata {
    try {
      // The calldata is 4 comma-separated JSON arrays
      // Wrap in brackets to make it a valid JSON array of arrays
      // Note: We keep the quotes around hex strings - they parse as strings
      const parts = JSON.parse(`[${calldata}]`);

      if (!Array.isArray(parts) || parts.length < 4) {
        throw new Error(`Expected 4 parts, got ${parts.length}`);
      }

      // Validate structure
      const [a, b, c, input] = parts;

      // a should be [string, string]
      if (!Array.isArray(a) || a.length !== 2) {
        throw new Error(`Invalid 'a' structure: expected array of 2, got ${JSON.stringify(a)}`);
      }

      // b should be [[string, string], [string, string]]
      if (!Array.isArray(b) || b.length !== 2 ||
          !Array.isArray(b[0]) || b[0].length !== 2 ||
          !Array.isArray(b[1]) || b[1].length !== 2) {
        throw new Error(`Invalid 'b' structure: expected 2x2 array, got ${JSON.stringify(b)}`);
      }

      // c should be [string, string]
      if (!Array.isArray(c) || c.length !== 2) {
        throw new Error(`Invalid 'c' structure: expected array of 2, got ${JSON.stringify(c)}`);
      }

      // input should be an array of strings
      if (!Array.isArray(input)) {
        throw new Error(`Invalid 'input' structure: expected array, got ${JSON.stringify(input)}`);
      }

      return {
        a: a as [string, string],
        b: b as [[string, string], [string, string]],
        c: c as [string, string],
        input: input as string[],
      };
    } catch (error) {
      // Log the original calldata for debugging
      console.error('[Prover] Failed to parse calldata:', calldata.slice(0, 200) + '...');
      throw new Error(
        `Invalid calldata format: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }
}

// =============================================================================
// Export
// =============================================================================

/** Singleton instance */
export const proverService = new ProverService();

/** Export class for testing */
export { ProverService };

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Format address as field element for circuit input
 * Converts 0x-prefixed address to decimal string
 */
export function addressToFieldElement(address: string): string {
  if (!address.startsWith('0x')) {
    return address; // Already a field element
  }
  return BigInt(address).toString();
}

/**
 * Format amount as field element for circuit input
 */
export function amountToFieldElement(amount: bigint): string {
  return amount.toString();
}
