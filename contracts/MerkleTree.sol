// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import "./PoseidonT3.sol";

/**
 * @title MerkleTree
 * @notice Incremental Merkle tree for privacy pool commitments
 * @dev Uses Poseidon hash for ZK-SNARK compatibility
 *
 * Structure:
 * - 20 levels deep (supports ~1M commitments)
 * - Leaves are commitment hashes: Poseidon(nullifier, secret)
 * - Each insertion updates the root
 *
 * Gas optimization:
 * - Only stores filled subtrees (20 values instead of 2^20)
 * - Root history for recent roots (30 roots)
 */
contract MerkleTree {
    using PoseidonT3 for uint256;

    // ============ Constants ============

    /// @notice Depth of the Merkle tree (supports 2^20 = ~1M commitments)
    uint32 public constant TREE_LEVELS = 20;

    /// @notice Maximum number of leaves in the tree (2^20 = 1,048,576)
    uint32 public constant MAX_LEAVES = 1048576;

    /// @notice Number of historical roots to store
    uint256 public constant ROOT_HISTORY_SIZE = 30;

    /// @notice Zero value for empty leaves (keccak256("veil") % FIELD_SIZE)
    uint256 public constant ZERO_VALUE =
        uint256(keccak256("veil")) % 21888242871839275222246405745257275088548364400416034343698204186575808495617;

    // ============ State ============

    /// @notice Current root of the Merkle tree
    uint256 public currentRoot;

    /// @notice Index of the next leaf to be inserted
    uint32 public nextLeafIndex;

    /// @notice Filled subtrees (one per level)
    /// @dev filledSubtrees[i] = the most recent filled node at level i
    uint256[TREE_LEVELS] public filledSubtrees;

    /// @notice Circular buffer of historical roots
    uint256[ROOT_HISTORY_SIZE] public roots;

    /// @notice Index pointing to the current position in roots array
    uint256 public currentRootIndex;

    /// @notice Pre-computed zero hashes for each level
    /// @dev zeros[i] = hash of empty subtree at level i
    uint256[TREE_LEVELS] public zeros;

    // ============ Events ============

    /// @notice Emitted when a new leaf is inserted
    event LeafInserted(uint256 indexed commitment, uint32 indexed leafIndex, uint256 timestamp);

    // ============ Errors ============

    error MerkleTreeFull();
    error UnknownRoot();

    // ============ Constructor ============

    constructor() {
        // Initialize zero hashes for each level
        // zeros[0] = ZERO_VALUE (empty leaf)
        // zeros[i] = Poseidon(zeros[i-1], zeros[i-1])
        zeros[0] = ZERO_VALUE;
        for (uint32 i = 1; i < TREE_LEVELS; ) {
            zeros[i] = PoseidonT3.poseidon(zeros[i - 1], zeros[i - 1]);
            unchecked {
                ++i;
            }
        }

        // Initialize filled subtrees with zeros
        for (uint32 i = 0; i < TREE_LEVELS; ) {
            filledSubtrees[i] = zeros[i];
            unchecked {
                ++i;
            }
        }

        // Initialize root as empty tree root
        currentRoot = PoseidonT3.poseidon(zeros[TREE_LEVELS - 1], zeros[TREE_LEVELS - 1]);
        roots[0] = currentRoot;
    }

    // ============ Internal Functions ============

    /**
     * @notice Insert a leaf into the Merkle tree
     * @param _commitment The commitment to insert
     * @return leafIndex The index of the inserted leaf
     *
     * @dev Algorithm:
     * 1. Start at leaf level with the commitment
     * 2. For each level, determine if we're on left or right
     * 3. If left: sibling is zeros[level], store current as filledSubtrees
     * 4. If right: sibling is filledSubtrees[level]
     * 5. Hash together and move up
     */
    function _insertLeaf(uint256 _commitment) internal returns (uint32 leafIndex) {
        if (nextLeafIndex >= MAX_LEAVES) revert MerkleTreeFull();

        leafIndex = nextLeafIndex;
        uint256 currentIndex = leafIndex;
        uint256 currentHash = _commitment;
        uint256 left;
        uint256 right;

        for (uint32 level = 0; level < TREE_LEVELS; ) {
            if (currentIndex % 2 == 0) {
                // We're on the left
                left = currentHash;
                right = zeros[level];
                filledSubtrees[level] = currentHash;
            } else {
                // We're on the right
                left = filledSubtrees[level];
                right = currentHash;
            }

            currentHash = PoseidonT3.poseidon(left, right);
            currentIndex = currentIndex / 2;

            unchecked {
                ++level;
            }
        }

        // Update root
        currentRoot = currentHash;

        // Store in root history
        currentRootIndex = (currentRootIndex + 1) % ROOT_HISTORY_SIZE;
        roots[currentRootIndex] = currentRoot;

        // Increment leaf counter
        unchecked {
            ++nextLeafIndex;
        }

        emit LeafInserted(_commitment, leafIndex, block.timestamp);
    }

    /**
     * @notice Check if a root is known (current or in history)
     * @param _root The root to check
     * @return True if root is known
     */
    function _isKnownRoot(uint256 _root) internal view returns (bool) {
        if (_root == 0) return false;

        // Check root history (circular buffer)
        uint256 rootIdx = currentRootIndex;
        for (uint256 i = 0; i < ROOT_HISTORY_SIZE; ) {
            if (_root == roots[rootIdx]) {
                return true;
            }
            if (rootIdx == 0) {
                rootIdx = ROOT_HISTORY_SIZE - 1;
            } else {
                unchecked {
                    --rootIdx;
                }
            }
            // Stop if we've checked all populated roots
            if (roots[rootIdx] == 0 && i > 0) break;

            unchecked {
                ++i;
            }
        }
        return false;
    }

    // ============ View Functions ============

    /**
     * @notice Check if a root is valid (known in history)
     * @param _root The root to verify
     * @return True if root is known
     */
    function isKnownRoot(uint256 _root) external view returns (bool) {
        return _isKnownRoot(_root);
    }

    /**
     * @notice Get the current Merkle root
     * @return The current root
     */
    function getRoot() external view returns (uint256) {
        return currentRoot;
    }

    /**
     * @notice Get the number of leaves inserted
     * @return Number of commitments in the tree
     */
    function getLeafCount() external view returns (uint32) {
        return nextLeafIndex;
    }

    /**
     * @notice Get a specific root from history
     * @param index Index in root history (0 = oldest, currentRootIndex = newest)
     * @return The root at that index
     */
    function getRootByIndex(uint256 index) external view returns (uint256) {
        require(index < ROOT_HISTORY_SIZE, "Index out of bounds");
        return roots[index];
    }

    /**
     * @notice Get zero hash for a level
     * @param level The tree level (0 = leaf level)
     * @return The zero hash at that level
     */
    function getZeroHash(uint32 level) external view returns (uint256) {
        require(level < TREE_LEVELS, "Level out of bounds");
        return zeros[level];
    }

    /**
     * @notice Get filled subtree at a level
     * @param level The tree level
     * @return The filled subtree hash
     */
    function getFilledSubtree(uint32 level) external view returns (uint256) {
        require(level < TREE_LEVELS, "Level out of bounds");
        return filledSubtrees[level];
    }
}
