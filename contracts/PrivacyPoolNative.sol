// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./MerkleTreeOptimized.sol";
import "./interfaces/IVerifier.sol";

/**
 * @title PrivacyPoolNative
 * @notice Privacy pool that accepts NATIVE XRP (not ERC20)
 * @dev For XRPL EVM where XRP is the native gas token
 */
contract PrivacyPoolNative is MerkleTreeOptimized, ReentrancyGuard {

    IVerifier public immutable verifier;
    uint256 public immutable denomination;

    mapping(uint256 => bool) public nullifierHashes;
    mapping(uint256 => bool) public commitments;

    event Deposit(uint256 indexed commitment, uint32 indexed leafIndex, uint256 timestamp);
    event Withdrawal(address indexed recipient, uint256 indexed nullifierHash, address indexed relayer, uint256 fee);

    error InvalidDenomination();
    error CommitmentAlreadyExists();
    error InvalidProof();
    error NullifierAlreadySpent();
    error InvalidRecipient();
    error FeeTooHigh();
    error IncorrectPayment();
    error TransferFailed();

    constructor(IVerifier _verifier, uint256 _denomination) {
        if (_denomination == 0) revert InvalidDenomination();
        verifier = _verifier;
        denomination = _denomination;
    }

    /**
     * @notice Deposit native XRP into the privacy pool
     * @param _commitment The commitment hash: Poseidon(nullifier, secret)
     * @dev Must send exactly `denomination` amount of XRP as msg.value
     */
    function deposit(uint256 _commitment) external payable nonReentrant {
        if (_commitment == 0) revert InvalidProof();
        if (commitments[_commitment]) revert CommitmentAlreadyExists();
        if (msg.value != denomination) revert IncorrectPayment();

        commitments[_commitment] = true;
        uint32 leafIndex = _insertLeaf(_commitment);

        emit Deposit(_commitment, leafIndex, block.timestamp);
    }

    /**
     * @notice Withdraw funds using a ZK proof
     * @param _proof Groth16 proof
     * @param _root Merkle root
     * @param _nullifierHash Hash of nullifier
     * @param _recipient Address to receive funds
     * @param _relayer Relayer address (0 for self-relay)
     * @param _fee Fee for relayer
     * @param _refund Refund amount (usually 0)
     */
    function withdraw(
        Proof calldata _proof,
        uint256 _root,
        uint256 _nullifierHash,
        address payable _recipient,
        address payable _relayer,
        uint256 _fee,
        uint256 _refund
    ) external nonReentrant {
        if (_recipient == address(0)) revert InvalidRecipient();
        if (_fee > denomination) revert FeeTooHigh();
        if (_nullifierHash == 0) revert InvalidProof();
        if (nullifierHashes[_nullifierHash]) revert NullifierAlreadySpent();
        if (!_isKnownRoot(_root)) revert UnknownRoot();

        uint256[6] memory publicInputs = [
            _root,
            _nullifierHash,
            uint256(uint160(address(_recipient))),
            uint256(uint160(address(_relayer))),
            _fee,
            _refund
        ];

        bool isValid = verifier.verifyProof(_proof.a, _proof.b, _proof.c, publicInputs);
        if (!isValid) revert InvalidProof();

        nullifierHashes[_nullifierHash] = true;

        // Transfer native XRP to recipient
        uint256 recipientAmount = denomination - _fee;
        (bool success, ) = _recipient.call{value: recipientAmount}("");
        if (!success) revert TransferFailed();

        // Transfer fee to relayer (if applicable)
        if (_fee > 0 && _relayer != address(0)) {
            (bool feeSuccess, ) = _relayer.call{value: _fee}("");
            if (!feeSuccess) revert TransferFailed();
        }

        emit Withdrawal(_recipient, _nullifierHash, _relayer, _fee);
    }

    function isSpent(uint256 _nullifierHash) external view returns (bool) {
        return nullifierHashes[_nullifierHash];
    }

    function isCommitmentExists(uint256 _commitment) external view returns (bool) {
        return commitments[_commitment];
    }

    function getPoolInfo() external view returns (
        uint256 _denomination,
        address _tokenAddress,
        address _verifierAddress,
        uint32 _leafCount,
        uint256 _root
    ) {
        // Return 0xEeee... to indicate native token
        return (denomination, 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE, address(verifier), nextLeafIndex, currentRoot);
    }

    // Allow contract to receive XRP
    receive() external payable {}
}

struct Proof {
    uint256[2] a;
    uint256[2][2] b;
    uint256[2] c;
}
