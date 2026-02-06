pragma circom 2.1.0;

// Veil Privacy Pool - Withdrawal Circuit
// Proves ownership of a commitment in the Merkle tree without revealing which one
//
// Privacy guarantees:
// - Commitment (nullifier, secret) is never revealed
// - Which leaf in the tree belongs to the prover is hidden
// - Only the nullifier hash is exposed to prevent double-spending

include "node_modules/circomlib/circuits/poseidon.circom";
include "node_modules/circomlib/circuits/bitify.circom";
include "./merkleTree.circom";

template Withdraw(levels) {
    // ========== PRIVATE INPUTS ==========
    // These remain hidden in the ZK proof
    signal input nullifier;        // Random secret used to derive nullifier hash
    signal input secret;           // Random secret combined with nullifier to form commitment
    signal input pathElements[levels]; // Sibling nodes in Merkle path
    signal input pathIndices[levels];  // 0/1 indicators for left/right position

    // ========== PUBLIC INPUTS ==========
    // These are revealed and verified on-chain
    signal input root;             // Merkle tree root (verified on-chain)
    signal input nullifierHash;    // Prevents double-spending (stored on-chain)
    signal input recipient;        // Address receiving the withdrawn funds
    signal input relayer;          // Address of relayer (0 if self-relay)
    signal input fee;              // Fee paid to relayer (in drops)
    signal input refund;           // Refund amount (for gas rebates)

    // ========== STEP 1: Compute Commitment ==========
    // commitment = Poseidon(nullifier, secret)
    // This commitment was originally deposited into the pool
    component commitmentHasher = Poseidon(2);
    commitmentHasher.inputs[0] <== nullifier;
    commitmentHasher.inputs[1] <== secret;

    // ========== STEP 2: Verify Nullifier Hash ==========
    // nullifierHash = Poseidon(nullifier)
    // This is stored on-chain to prevent the same commitment from being withdrawn twice
    component nullifierHasher = Poseidon(1);
    nullifierHasher.inputs[0] <== nullifier;
    nullifierHash === nullifierHasher.out;

    // ========== STEP 3: Verify Merkle Proof ==========
    // Proves the commitment exists in the tree without revealing its position
    component tree = MerkleTreeChecker(levels);
    tree.leaf <== commitmentHasher.out;
    tree.root <== root;
    for (var i = 0; i < levels; i++) {
        tree.pathElements[i] <== pathElements[i];
        tree.pathIndices[i] <== pathIndices[i];
    }

    // ========== STEP 4: Bind Public Inputs ==========
    // Squaring prevents manipulation of public inputs after proof generation
    // Without this, an attacker could intercept a valid proof and change recipient
    signal recipientSquare;
    signal relayerSquare;
    signal feeSquare;
    signal refundSquare;

    recipientSquare <== recipient * recipient;
    relayerSquare <== relayer * relayer;
    feeSquare <== fee * fee;
    refundSquare <== refund * refund;
}

// Main component with 20 levels (supports ~1M commitments)
// Public inputs: root, nullifierHash, recipient, relayer, fee, refund
component main {public [root, nullifierHash, recipient, relayer, fee, refund]} = Withdraw(20);
