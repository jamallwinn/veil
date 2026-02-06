// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "./MerkleTree.sol";
import "./interfaces/IVerifier.sol";

/**
 * @title PrivacyPool
 * @notice Private XRP payment pool using ZK-SNARKs on XRPL EVM Sidechain
 * @dev Main contract for Veil - deposits and withdrawals with privacy
 *
 * Privacy Model:
 * - Deposit: User commits to pool, commitment stored in Merkle tree
 * - Withdraw: User proves ownership via ZK proof, nullifier prevents double-spend
 * - Anonymity set: All deposits of same denomination are indistinguishable
 *
 * Flow:
 * XRPL → Axelar Bridge → wXRP on EVM → Deposit to Pool → Withdraw → Axelar Bridge → XRPL
 */
contract PrivacyPool is MerkleTree, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ============ Immutables ============

    /// @notice The Groth16 verifier contract
    IVerifier public immutable verifier;

    /// @notice The wrapped XRP token (wXRP from Axelar)
    IERC20 public immutable token;

    /// @notice Fixed denomination for deposits (100 XRP = 100e18 wei)
    uint256 public immutable denomination;

    // ============ State ============

    /// @notice Track spent nullifiers to prevent double-spending
    mapping(uint256 => bool) public nullifierHashes;

    /// @notice Track commitments that have been deposited
    mapping(uint256 => bool) public commitments;

    // ============ Events ============

    /**
     * @notice Emitted when a deposit is made
     * @param commitment The Poseidon(nullifier, secret) hash
     * @param leafIndex Index in the Merkle tree
     * @param timestamp Block timestamp
     */
    event Deposit(uint256 indexed commitment, uint32 indexed leafIndex, uint256 timestamp);

    /**
     * @notice Emitted when a withdrawal is made
     * @param recipient Address receiving the funds
     * @param nullifierHash Hash of the nullifier (prevents double-spend)
     * @param relayer Address of the relayer (or zero if self-relay)
     * @param fee Fee paid to relayer
     */
    event Withdrawal(
        address indexed recipient,
        uint256 indexed nullifierHash,
        address indexed relayer,
        uint256 fee
    );

    // ============ Errors ============

    error InvalidDenomination();
    error CommitmentAlreadyExists();
    error InvalidProof();
    error NullifierAlreadySpent();
    error InvalidRecipient();
    error InvalidRelayer();
    error FeeTooHigh();
    error TransferFailed();

    // ============ Constructor ============

    /**
     * @notice Deploy a new PrivacyPool
     * @param _verifier Address of the Groth16 verifier contract
     * @param _token Address of the wXRP token
     * @param _denomination Fixed deposit amount in wei (e.g., 100e18 for 100 XRP)
     */
    constructor(IVerifier _verifier, IERC20 _token, uint256 _denomination) {
        if (_denomination == 0) revert InvalidDenomination();
        verifier = _verifier;
        token = _token;
        denomination = _denomination;
    }

    // ============ External Functions ============

    /**
     * @notice Deposit funds into the privacy pool
     * @param _commitment The commitment hash: Poseidon(nullifier, secret)
     *
     * @dev Requirements:
     * - Commitment must be unique (not already deposited)
     * - Caller must have approved `denomination` amount of tokens
     *
     * @dev Gas: ~120,000 (majority from Merkle tree insertion)
     */
    function deposit(uint256 _commitment) external nonReentrant {
        // Validate commitment
        if (_commitment == 0) revert InvalidProof();
        if (commitments[_commitment]) revert CommitmentAlreadyExists();

        // Mark commitment as used
        commitments[_commitment] = true;

        // Insert into Merkle tree
        uint32 leafIndex = _insertLeaf(_commitment);

        // Transfer tokens from depositor
        token.safeTransferFrom(msg.sender, address(this), denomination);

        emit Deposit(_commitment, leafIndex, block.timestamp);
    }

    /**
     * @notice Withdraw funds from the privacy pool using a ZK proof
     * @param _proof Groth16 proof (a, b, c points)
     * @param _root Merkle root the proof is against
     * @param _nullifierHash Hash of the nullifier
     * @param _recipient Address to receive the funds
     * @param _relayer Address of the relayer (address(0) for self-relay)
     * @param _fee Fee to pay to relayer (0 if self-relay)
     * @param _refund Extra refund amount (for gas rebates, usually 0)
     *
     * @dev Requirements:
     * - Proof must be valid
     * - Nullifier must not have been spent
     * - Root must be known (current or in history)
     * - Fee must be less than denomination
     *
     * @dev Public inputs order (must match circuit):
     * [0] root
     * [1] nullifierHash
     * [2] recipient (as uint256)
     * [3] relayer (as uint256)
     * [4] fee
     * [5] refund
     *
     * @dev Gas: ~250,000 (majority from ZK verification)
     */
    function withdraw(
        Proof calldata _proof,
        uint256 _root,
        uint256 _nullifierHash,
        address _recipient,
        address _relayer,
        uint256 _fee,
        uint256 _refund
    ) external nonReentrant {
        // Validate inputs
        if (_recipient == address(0)) revert InvalidRecipient();
        if (_fee > denomination) revert FeeTooHigh();
        if (_nullifierHash == 0) revert InvalidProof();

        // Check nullifier hasn't been spent (prevent double-spend)
        if (nullifierHashes[_nullifierHash]) revert NullifierAlreadySpent();

        // Check root is valid (current or in history)
        if (!_isKnownRoot(_root)) revert UnknownRoot();

        // Construct public inputs (must match circuit order)
        uint256[6] memory publicInputs = [
            _root,
            _nullifierHash,
            uint256(uint160(_recipient)),
            uint256(uint160(_relayer)),
            _fee,
            _refund
        ];

        // Verify the ZK proof
        bool isValid = verifier.verifyProof(_proof.a, _proof.b, _proof.c, publicInputs);
        if (!isValid) revert InvalidProof();

        // Mark nullifier as spent
        nullifierHashes[_nullifierHash] = true;

        // Calculate amounts
        uint256 recipientAmount = denomination - _fee;

        // Transfer to recipient
        token.safeTransfer(_recipient, recipientAmount);

        // Transfer fee to relayer (if applicable)
        if (_fee > 0 && _relayer != address(0)) {
            token.safeTransfer(_relayer, _fee);
        }

        emit Withdrawal(_recipient, _nullifierHash, _relayer, _fee);
    }

    // ============ View Functions ============

    /**
     * @notice Check if a nullifier has been spent
     * @param _nullifierHash The nullifier hash to check
     * @return True if already spent
     */
    function isSpent(uint256 _nullifierHash) external view returns (bool) {
        return nullifierHashes[_nullifierHash];
    }

    /**
     * @notice Check if a commitment exists in the pool
     * @param _commitment The commitment to check
     * @return True if commitment exists
     */
    function isCommitmentExists(uint256 _commitment) external view returns (bool) {
        return commitments[_commitment];
    }

    /**
     * @notice Get pool information
     * @return _denomination Fixed deposit amount
     * @return _tokenAddress wXRP token address
     * @return _verifierAddress Verifier contract address
     * @return _leafCount Number of deposits
     * @return _root Current Merkle root
     */
    function getPoolInfo()
        external
        view
        returns (
            uint256 _denomination,
            address _tokenAddress,
            address _verifierAddress,
            uint32 _leafCount,
            uint256 _root
        )
    {
        return (denomination, address(token), address(verifier), nextLeafIndex, currentRoot);
    }
}

/**
 * @notice Groth16 proof structure
 * @dev Matches the output format from snarkjs
 */
struct Proof {
    uint256[2] a;   // G1 point
    uint256[2][2] b; // G2 point (note: swapped order in snarkjs)
    uint256[2] c;   // G1 point
}
