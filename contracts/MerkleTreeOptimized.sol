// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import "./PoseidonT3.sol";

/**
 * @title MerkleTreeOptimized
 * @notice Gas-optimized Merkle tree with pre-computed zero values
 * @dev Zero values computed offline using circomlibjs Poseidon
 */
contract MerkleTreeOptimized {
    using PoseidonT3 for uint256;

    // ============ Constants ============

    uint32 public constant TREE_LEVELS = 20;
    uint32 public constant MAX_LEAVES = 1048576;
    uint256 public constant ROOT_HISTORY_SIZE = 30;

    // Pre-computed zero values (keccak256("veil") % FIELD, then Poseidon chain)
    uint256 constant ZERO_0 = 20282559595580390386239320972589885322571241193217477968281590821058153745105;
    uint256 constant ZERO_1 = 3274439366190977746073845188500475046446520114041572123218230963853477152652;
    uint256 constant ZERO_2 = 21824696504143889823808000405652102073630578351459095501572688600629305197061;
    uint256 constant ZERO_3 = 4829882791870146971335996492782653226712763398568263169937574164058019279763;
    uint256 constant ZERO_4 = 19727944145920873032916231804390263655607021350360944996762502777010006047232;
    uint256 constant ZERO_5 = 12573616683620136186358076578923106319443727918715988430556975051719972102048;
    uint256 constant ZERO_6 = 20405764044244033966783614370100035550454543400854684595867636436287473374230;
    uint256 constant ZERO_7 = 7098593250002836498039706892886264767966219678786136596135924683362313216949;
    uint256 constant ZERO_8 = 10614461445763314670098655164277864019426687644326705180250511057194315579246;
    uint256 constant ZERO_9 = 16126229332654394463116787064431180585243709535536964509568907083276419220720;
    uint256 constant ZERO_10 = 13260706536739717135161925486362785721164009104353869003025642793429652376723;
    uint256 constant ZERO_11 = 21724731140591664080916319881133883044719500025782445336921685983880721634670;
    uint256 constant ZERO_12 = 12485256800448034846922129861121743630219421178381117121924516717857326507717;
    uint256 constant ZERO_13 = 15356968726074633924886273751460462503048149542957754123020595671249255383445;
    uint256 constant ZERO_14 = 17589149050941078564770579918837254372671706970705658580717390011385999912276;
    uint256 constant ZERO_15 = 6906365566047511210450524710679464510839320728492097571769860075033593263841;
    uint256 constant ZERO_16 = 11772834041673690955723535883322245291285761724475948631352422726028620232375;
    uint256 constant ZERO_17 = 2441162013776382406394170084280306821308201105576789065210555600748327343742;
    uint256 constant ZERO_18 = 8787895828041719154842134501079118746313815157330466076596732642977139060888;
    uint256 constant ZERO_19 = 4655049255717070280843259395955534038865636352540410624644680554571210614192;
    uint256 constant INITIAL_ROOT = 13546294577423271505168199062432089901524488312967713856172645361755944246785;

    // ============ State ============

    uint256 public currentRoot;
    uint32 public nextLeafIndex;
    uint256[20] public filledSubtrees;
    uint256[30] public roots;
    uint256 public currentRootIndex;

    // ============ Events ============

    event LeafInserted(uint256 indexed commitment, uint32 indexed leafIndex, uint256 timestamp);

    // ============ Errors ============

    error MerkleTreeFull();
    error UnknownRoot();

    // ============ Constructor ============

    constructor() {
        // Initialize with pre-computed values (no loops!)
        filledSubtrees[0] = ZERO_0;
        filledSubtrees[1] = ZERO_1;
        filledSubtrees[2] = ZERO_2;
        filledSubtrees[3] = ZERO_3;
        filledSubtrees[4] = ZERO_4;
        filledSubtrees[5] = ZERO_5;
        filledSubtrees[6] = ZERO_6;
        filledSubtrees[7] = ZERO_7;
        filledSubtrees[8] = ZERO_8;
        filledSubtrees[9] = ZERO_9;
        filledSubtrees[10] = ZERO_10;
        filledSubtrees[11] = ZERO_11;
        filledSubtrees[12] = ZERO_12;
        filledSubtrees[13] = ZERO_13;
        filledSubtrees[14] = ZERO_14;
        filledSubtrees[15] = ZERO_15;
        filledSubtrees[16] = ZERO_16;
        filledSubtrees[17] = ZERO_17;
        filledSubtrees[18] = ZERO_18;
        filledSubtrees[19] = ZERO_19;

        currentRoot = INITIAL_ROOT;
        roots[0] = INITIAL_ROOT;
    }

    // ============ Internal Functions ============

    function _getZero(uint32 level) internal pure returns (uint256) {
        if (level == 0) return ZERO_0;
        if (level == 1) return ZERO_1;
        if (level == 2) return ZERO_2;
        if (level == 3) return ZERO_3;
        if (level == 4) return ZERO_4;
        if (level == 5) return ZERO_5;
        if (level == 6) return ZERO_6;
        if (level == 7) return ZERO_7;
        if (level == 8) return ZERO_8;
        if (level == 9) return ZERO_9;
        if (level == 10) return ZERO_10;
        if (level == 11) return ZERO_11;
        if (level == 12) return ZERO_12;
        if (level == 13) return ZERO_13;
        if (level == 14) return ZERO_14;
        if (level == 15) return ZERO_15;
        if (level == 16) return ZERO_16;
        if (level == 17) return ZERO_17;
        if (level == 18) return ZERO_18;
        return ZERO_19;
    }

    function _insertLeaf(uint256 _commitment) internal returns (uint32 leafIndex) {
        if (nextLeafIndex >= MAX_LEAVES) revert MerkleTreeFull();

        leafIndex = nextLeafIndex;
        uint256 currentIndex = leafIndex;
        uint256 currentHash = _commitment;
        uint256 left;
        uint256 right;

        for (uint32 level = 0; level < TREE_LEVELS; ) {
            if (currentIndex % 2 == 0) {
                left = currentHash;
                right = _getZero(level);
                filledSubtrees[level] = currentHash;
            } else {
                left = filledSubtrees[level];
                right = currentHash;
            }

            currentHash = PoseidonT3.poseidon(left, right);
            currentIndex = currentIndex / 2;

            unchecked { ++level; }
        }

        currentRoot = currentHash;
        currentRootIndex = (currentRootIndex + 1) % ROOT_HISTORY_SIZE;
        roots[currentRootIndex] = currentRoot;

        unchecked { ++nextLeafIndex; }

        emit LeafInserted(_commitment, leafIndex, block.timestamp);
    }

    function _isKnownRoot(uint256 _root) internal view returns (bool) {
        if (_root == 0) return false;

        uint256 rootIdx = currentRootIndex;
        for (uint256 i = 0; i < ROOT_HISTORY_SIZE; ) {
            if (_root == roots[rootIdx]) return true;
            if (rootIdx == 0) {
                rootIdx = ROOT_HISTORY_SIZE - 1;
            } else {
                unchecked { --rootIdx; }
            }
            if (roots[rootIdx] == 0 && i > 0) break;
            unchecked { ++i; }
        }
        return false;
    }

    // ============ View Functions ============

    function isKnownRoot(uint256 _root) external view returns (bool) {
        return _isKnownRoot(_root);
    }

    function getRoot() external view returns (uint256) {
        return currentRoot;
    }

    function getLeafCount() external view returns (uint32) {
        return nextLeafIndex;
    }
}
