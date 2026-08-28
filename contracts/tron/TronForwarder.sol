// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ITrc20} from "./interfaces/ITrc20.sol";
import {ITronReceiver} from "./interfaces/ITronReceiver.sol";

contract TronForwarder {
    address public immutable RECEIVER;

    error InvalidReceiver();
    error NoBalance();
    error TransferFailed();

    constructor(address receiver_) {
        if (receiver_ == address(0)) revert InvalidReceiver();
        RECEIVER = receiver_;
    }

    receive() external payable {}

    function sweepTrx(bytes32 invoiceId, bytes calldata data) external returns (uint256 amount) {
        amount = address(this).balance;
        if (amount == 0) revert NoBalance();

        ITronReceiver(RECEIVER).receiveTrxInvoice{value: amount}(invoiceId, data);
    }

    function sweepToken(
        address token,
        bytes32 invoiceId,
        bytes calldata data
    ) external returns (uint256 amount) {
        amount = ITrc20(token).balanceOf(address(this));
        if (amount == 0) revert NoBalance();

        _safeApprove(token, RECEIVER, amount);
        ITronReceiver(RECEIVER).receiveTokenInvoice(token, invoiceId, amount, data);
        _safeApprove(token, RECEIVER, 0);
    }

    function _safeTransfer(address token, address to, uint256 amount) private {
        (bool ok, bytes memory result) = token.call(abi.encodeCall(ITrc20.transfer, (to, amount)));
        if (!ok || (result.length != 0 && !abi.decode(result, (bool)))) revert TransferFailed();
    }

    function _safeApprove(address token, address spender, uint256 amount) private {
        (bool ok, bytes memory result) = token.call(abi.encodeCall(ITrc20.approve, (spender, amount)));
        if (!ok || (result.length != 0 && !abi.decode(result, (bool)))) revert TransferFailed();
    }
}
