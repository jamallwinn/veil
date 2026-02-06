/**
 * ZK Prover Web Worker
 *
 * Handles proof generation in a separate thread to avoid blocking the main UI.
 * Uses SnarkJS for Groth16 proof generation with the withdraw circuit.
 *
 * Communication:
 * - Main thread sends WithdrawCircuitInput
 * - Worker responds with WithdrawProof or error
 */

import * as snarkjs from 'snarkjs';

// =============================================================================
// Types (duplicated to avoid import issues in worker context)
// =============================================================================

interface Groth16Proof {
  pi_a: [string, string, string];
  pi_b: [[string, string], [string, string], [string, string]];
  pi_c: [string, string, string];
  protocol: 'groth16';
  curve: 'bn128';
}

interface WithdrawProof {
  proof: Groth16Proof;
  publicSignals: string[];
}

interface WithdrawCircuitInput {
  nullifier: string;
  secret: string;
  pathElements: string[];
  pathIndices: number[];
  root: string;
  nullifierHash: string;
  recipient: string;
  relayer: string;
  fee: string;
  refund: string;
}

// Worker message types
interface WorkerRequest {
  type: 'GENERATE_PROOF' | 'VERIFY_PROOF' | 'LOAD_ARTIFACTS';
  payload: unknown;
  requestId: string;
}

interface GenerateProofPayload {
  input: WithdrawCircuitInput;
  wasmPath: string;
  zkeyPath: string;
}

interface VerifyProofPayload {
  proof: WithdrawProof;
  vkeyPath: string;
}

interface WorkerResponse {
  type: 'SUCCESS' | 'ERROR' | 'PROGRESS';
  requestId: string;
  payload: unknown;
}

// =============================================================================
// State
// =============================================================================

let isInitialized = false;
let cachedVkey: unknown = null;

// =============================================================================
// Message Handler
// =============================================================================

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const { type, payload, requestId } = event.data;

  try {
    switch (type) {
      case 'GENERATE_PROOF': {
        const { input, wasmPath, zkeyPath } = payload as GenerateProofPayload;
        const result = await generateProof(input, wasmPath, zkeyPath, requestId);
        sendResponse({ type: 'SUCCESS', requestId, payload: result });
        break;
      }

      case 'VERIFY_PROOF': {
        const { proof, vkeyPath } = payload as VerifyProofPayload;
        const isValid = await verifyProof(proof, vkeyPath);
        sendResponse({ type: 'SUCCESS', requestId, payload: { isValid } });
        break;
      }

      case 'LOAD_ARTIFACTS': {
        const { vkeyPath } = payload as { vkeyPath: string };
        await loadArtifacts(vkeyPath);
        sendResponse({ type: 'SUCCESS', requestId, payload: { loaded: true } });
        break;
      }

      default:
        throw new Error(`Unknown message type: ${type}`);
    }
  } catch (error) {
    sendResponse({
      type: 'ERROR',
      requestId,
      payload: {
        message: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
      },
    });
  }
};

// =============================================================================
// Core Functions
// =============================================================================

/**
 * Generate a Groth16 withdrawal proof
 */
async function generateProof(
  input: WithdrawCircuitInput,
  wasmPath: string,
  zkeyPath: string,
  requestId: string
): Promise<WithdrawProof> {
  // Send progress update
  sendProgress(requestId, 'Loading circuit artifacts...', 10);

  // Prepare circuit input (convert to snarkjs format)
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

  sendProgress(requestId, 'Generating witness...', 30);

  // Generate the proof using snarkjs
  const { proof, publicSignals } = await snarkjs.groth16.fullProve(
    circuitInput,
    wasmPath,
    zkeyPath
  );

  sendProgress(requestId, 'Proof generated successfully', 100);

  return {
    proof: proof as Groth16Proof,
    publicSignals: publicSignals as string[],
  };
}

/**
 * Verify a Groth16 proof locally
 */
async function verifyProof(
  withdrawProof: WithdrawProof,
  vkeyPath: string
): Promise<boolean> {
  // Load verification key if not cached
  if (!cachedVkey) {
    const response = await fetch(vkeyPath);
    if (!response.ok) {
      throw new Error(`Failed to load verification key: ${response.statusText}`);
    }
    cachedVkey = await response.json();
  }

  // Verify using snarkjs
  return await snarkjs.groth16.verify(
    cachedVkey,
    withdrawProof.publicSignals,
    withdrawProof.proof
  );
}

/**
 * Pre-load circuit artifacts for faster proof generation
 */
async function loadArtifacts(vkeyPath: string): Promise<void> {
  // Load and cache verification key
  const response = await fetch(vkeyPath);
  if (!response.ok) {
    throw new Error(`Failed to load verification key: ${response.statusText}`);
  }
  cachedVkey = await response.json();
  isInitialized = true;
}

// =============================================================================
// Helpers
// =============================================================================

function sendResponse(response: WorkerResponse): void {
  self.postMessage(response);
}

function sendProgress(requestId: string, message: string, percent: number): void {
  sendResponse({
    type: 'PROGRESS',
    requestId,
    payload: { message, percent },
  });
}

// Silence TypeScript error about unused variable
void isInitialized;
