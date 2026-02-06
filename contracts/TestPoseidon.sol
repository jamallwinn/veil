// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import "./PoseidonT3.sol";

contract TestPoseidon {
    function testHash(uint256 left, uint256 right) external pure returns (uint256) {
        return PoseidonT3.poseidon(left, right);
    }
}
