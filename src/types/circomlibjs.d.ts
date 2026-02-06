/**
 * Type declarations for circomlibjs
 *
 * circomlibjs provides ZK-SNARK compatible hash functions (Poseidon, MiMC, etc.)
 */

declare module 'circomlibjs' {
  export interface PoseidonHasher {
    (inputs: bigint[]): bigint;
    F: {
      toObject: (val: unknown) => bigint;
      toString: (val: bigint, radix?: number) => string;
    };
  }

  /**
   * Build the Poseidon hash function
   * @returns Promise resolving to Poseidon hasher function
   */
  export function buildPoseidon(): Promise<PoseidonHasher>;

  /**
   * Build the Poseidon reference implementation
   */
  export function buildPoseidonReference(): Promise<PoseidonHasher>;
}
