pragma circom 2.1.0;

// Merkle Tree Verification Circuit for Veil Privacy Pool
// Uses Poseidon hash for ZK-efficiency (~300 constraints per hash)

include "node_modules/circomlib/circuits/poseidon.circom";

// Hash two child nodes to produce parent hash
template HashLeftRight() {
    signal input left;
    signal input right;
    signal output hash;

    component hasher = Poseidon(2);
    hasher.inputs[0] <== left;
    hasher.inputs[1] <== right;
    hash <== hasher.out;
}

// Dual multiplexer - swaps inputs based on selector bit
// If s=0: out[0]=in[0], out[1]=in[1]
// If s=1: out[0]=in[1], out[1]=in[0]
template DualMux() {
    signal input in[2];
    signal input s;
    signal output out[2];

    // Linear interpolation for swap
    out[0] <== (in[1] - in[0]) * s + in[0];
    out[1] <== (in[0] - in[1]) * s + in[1];
}

// Merkle Tree membership proof verifier
// Verifies that a leaf exists in a Merkle tree with given root
// Parameters:
//   levels: depth of the Merkle tree (20 for ~1M commitments)
template MerkleTreeChecker(levels) {
    signal input leaf;
    signal input root;
    signal input pathElements[levels];
    signal input pathIndices[levels];

    component selectors[levels];
    component hashers[levels];

    for (var i = 0; i < levels; i++) {
        selectors[i] = DualMux();

        // First level uses leaf, subsequent levels use previous hash
        selectors[i].in[0] <== i == 0 ? leaf : hashers[i - 1].hash;
        selectors[i].in[1] <== pathElements[i];
        selectors[i].s <== pathIndices[i];

        hashers[i] = HashLeftRight();
        hashers[i].left <== selectors[i].out[0];
        hashers[i].right <== selectors[i].out[1];
    }

    // Final computed root must match provided root
    root === hashers[levels - 1].hash;
}
