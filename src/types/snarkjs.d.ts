/**
 * Type declarations for snarkjs
 *
 * SnarkJS is a JavaScript library for zkSNARK operations.
 * This declaration file provides TypeScript types for the groth16 module.
 *
 * @see https://github.com/iden3/snarkjs
 */

declare module 'snarkjs' {
  /**
   * Groth16 proof structure
   */
  export interface Groth16Proof {
    pi_a: string[];
    pi_b: string[][];
    pi_c: string[];
    protocol: string;
    curve: string;
  }

  /**
   * Verification key structure
   */
  export interface VerificationKey {
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
   * Groth16 proving system module
   */
  export namespace groth16 {
    /**
     * Generate a Groth16 proof
     *
     * @param input - Circuit inputs (private and public)
     * @param wasmPath - Path to the circuit WASM file
     * @param zkeyPath - Path to the proving key (zkey) file
     * @param logger - Optional logger for progress output
     * @returns Promise containing the proof and public signals
     */
    function fullProve(
      input: Record<string, string | string[] | number | number[]>,
      wasmPath: string,
      zkeyPath: string,
      logger?: {
        info: (message: string) => void;
        error: (message: string) => void;
        debug: (message: string) => void;
      }
    ): Promise<{
      proof: Groth16Proof;
      publicSignals: string[];
    }>;

    /**
     * Verify a Groth16 proof
     *
     * @param verificationKey - The verification key
     * @param publicSignals - The public signals from proof generation
     * @param proof - The proof to verify
     * @returns Promise resolving to true if proof is valid
     */
    function verify(
      verificationKey: VerificationKey | unknown,
      publicSignals: string[],
      proof: Groth16Proof
    ): Promise<boolean>;

    /**
     * Export proof and public signals as Solidity calldata
     *
     * @param proof - The Groth16 proof
     * @param publicSignals - The public signals
     * @returns Promise resolving to formatted calldata string
     */
    function exportSolidityCallData(
      proof: Groth16Proof,
      publicSignals: string[]
    ): Promise<string>;

    /**
     * Verify proof from JSON files
     *
     * @param vKeyPath - Path to verification key JSON
     * @param publicSignalsPath - Path to public signals JSON
     * @param proofPath - Path to proof JSON
     * @returns Promise resolving to true if proof is valid
     */
    function verifyFromFiles(
      vKeyPath: string,
      publicSignalsPath: string,
      proofPath: string
    ): Promise<boolean>;
  }

  /**
   * PLONK proving system module
   */
  export namespace plonk {
    function fullProve(
      input: Record<string, string | string[] | number | number[]>,
      wasmPath: string,
      zkeyPath: string,
      logger?: unknown
    ): Promise<{
      proof: unknown;
      publicSignals: string[];
    }>;

    function verify(
      verificationKey: unknown,
      publicSignals: string[],
      proof: unknown
    ): Promise<boolean>;

    function exportSolidityCallData(
      proof: unknown,
      publicSignals: string[]
    ): Promise<string>;
  }

  /**
   * Powers of tau ceremony utilities
   */
  export namespace powersOfTau {
    function newAccumulator(
      curve: string,
      power: number,
      output: string,
      logger?: unknown
    ): Promise<void>;

    function contribute(
      input: string,
      output: string,
      name: string,
      entropy: string,
      logger?: unknown
    ): Promise<void>;

    function beacon(
      input: string,
      output: string,
      name: string,
      beaconHash: string,
      numIterations: number,
      logger?: unknown
    ): Promise<void>;

    function preparePhase2(
      input: string,
      output: string,
      logger?: unknown
    ): Promise<void>;

    function verify(ptau: string, logger?: unknown): Promise<boolean>;
  }

  /**
   * zkey utilities
   */
  export namespace zKey {
    function newZKey(
      r1csPath: string,
      ptauPath: string,
      zkeyPath: string,
      logger?: unknown
    ): Promise<void>;

    function contribute(
      oldZkeyPath: string,
      newZkeyPath: string,
      name: string,
      entropy: string,
      logger?: unknown
    ): Promise<void>;

    function beacon(
      oldZkeyPath: string,
      newZkeyPath: string,
      name: string,
      beaconHash: string,
      numIterations: number,
      logger?: unknown
    ): Promise<void>;

    function exportVerificationKey(
      zkeyPath: string,
      logger?: unknown
    ): Promise<VerificationKey>;

    function exportSolidityVerifier(
      zkeyPath: string,
      templatePath?: string,
      logger?: unknown
    ): Promise<string>;

    function verify(
      r1csPath: string,
      ptauPath: string,
      zkeyPath: string,
      logger?: unknown
    ): Promise<boolean>;
  }

  /**
   * R1CS utilities
   */
  export namespace r1cs {
    function info(r1csPath: string, logger?: unknown): Promise<{
      n8: number;
      prime: bigint;
      nVars: number;
      nOutputs: number;
      nPubInputs: number;
      nPrvInputs: number;
      nLabels: number;
      nConstraints: number;
      useCustomGates: boolean;
    }>;

    function print(r1csPath: string, symPath: string, logger?: unknown): Promise<void>;

    function exportJson(r1csPath: string, logger?: unknown): Promise<unknown>;
  }

  /**
   * Witness calculator utilities
   */
  export namespace wtns {
    function calculate(
      input: Record<string, string | string[] | number | number[]>,
      wasmPath: string,
      wtnsPath: string,
      logger?: unknown
    ): Promise<void>;

    function exportJson(wtnsPath: string): Promise<unknown>;

    function debug(
      input: Record<string, string | string[] | number | number[]>,
      wasmPath: string,
      wtnsPath: string,
      symPath: string,
      options?: unknown,
      logger?: unknown
    ): Promise<void>;
  }
}
