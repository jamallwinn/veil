// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

/**
 * @title IVerifier
 * @notice Interface for the Groth16 ZK-SNARK verifier contract
 * @dev Auto-generated verifier from snarkjs trusted setup
 *
 * Public inputs order (matching withdraw.circom):
 * [0] root - Merkle tree root
 * [1] nullifierHash - Hash of nullifier to prevent double-spending
 * [2] recipient - Address receiving withdrawn funds
 * [3] relayer - Address of relayer (0 if self-relay)
 * [4] fee - Fee paid to relayer (in wei)
 * [5] refund - Refund amount for gas rebates
 */
interface IVerifier {
    /**
     * @notice Verifies a Groth16 ZK-SNARK proof
     * @param _pA First proof element (G1 point)
     * @param _pB Second proof element (G2 point)
     * @param _pC Third proof element (G1 point)
     * @param _pubSignals Public inputs array (6 elements)
     * @return True if proof is valid, false otherwise
     */
    function verifyProof(
        uint256[2] calldata _pA,
        uint256[2][2] calldata _pB,
        uint256[2] calldata _pC,
        uint256[6] calldata _pubSignals
    ) external view returns (bool);
}
