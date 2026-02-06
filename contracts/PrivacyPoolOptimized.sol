// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "./MerkleTreeOptimized.sol";
import "./interfaces/IVerifier.sol";

/**
 * @title PrivacyPoolOptimized
 * @notice Gas-optimized privacy pool for XRPL EVM mainnet deployment
 */
contract PrivacyPoolOptimized is MerkleTreeOptimized, ReentrancyGuard {
    using SafeERC20 for IERC20;

    IVerifier public immutable verifier;
    IERC20 public immutable token;
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

    constructor(IVerifier _verifier, IERC20 _token, uint256 _denomination) {
        if (_denomination == 0) revert InvalidDenomination();
        verifier = _verifier;
        token = _token;
        denomination = _denomination;
    }

    function deposit(uint256 _commitment) external nonReentrant {
        if (_commitment == 0) revert InvalidProof();
        if (commitments[_commitment]) revert CommitmentAlreadyExists();

        commitments[_commitment] = true;
        uint32 leafIndex = _insertLeaf(_commitment);
        token.safeTransferFrom(msg.sender, address(this), denomination);

        emit Deposit(_commitment, leafIndex, block.timestamp);
    }

    function withdraw(
        Proof calldata _proof,
        uint256 _root,
        uint256 _nullifierHash,
        address _recipient,
        address _relayer,
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
            uint256(uint160(_recipient)),
            uint256(uint160(_relayer)),
            _fee,
            _refund
        ];

        bool isValid = verifier.verifyProof(_proof.a, _proof.b, _proof.c, publicInputs);
        if (!isValid) revert InvalidProof();

        nullifierHashes[_nullifierHash] = true;

        uint256 recipientAmount = denomination - _fee;
        token.safeTransfer(_recipient, recipientAmount);

        if (_fee > 0 && _relayer != address(0)) {
            token.safeTransfer(_relayer, _fee);
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
        return (denomination, address(token), address(verifier), nextLeafIndex, currentRoot);
    }
}

struct Proof {
    uint256[2] a;
    uint256[2][2] b;
    uint256[2] c;
}
