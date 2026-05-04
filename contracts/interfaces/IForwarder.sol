// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IForwarder {
    function sweepEth(bytes32 invoiceId, bytes calldata data) external returns (uint256 amount);

    function sweepToken(
        address token,
        bytes32 invoiceId,
        bytes calldata data
    ) external returns (uint256 amount);
}
