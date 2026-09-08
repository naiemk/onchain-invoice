// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @dev Tiny target for Super Wallet contract-call e2e (non-token execute).
contract E2ePing {
    bytes32 public lastPing;

    function ping(bytes32 value) external {
        lastPing = value;
    }
}
