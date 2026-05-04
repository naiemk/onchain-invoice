// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IReceiver {
    function receiveEthInvoice(bytes32 invoiceId, bytes calldata data) external payable;

    function receiveTokenInvoice(
        address token,
        bytes32 invoiceId,
        uint256 amount,
        bytes calldata data
    ) external;
}
