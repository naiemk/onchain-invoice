// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IReceiver} from "./interfaces/IReceiver.sol";

contract Forwarder {
    using SafeERC20 for IERC20;

    address public immutable RECEIVER;

    error InvalidReceiver();
    error NoBalance();

    constructor(address receiver_) {
        if (receiver_ == address(0)) revert InvalidReceiver();
        RECEIVER = receiver_;
    }

    receive() external payable {}

    function sweepEth(bytes32 invoiceId, bytes calldata data) external returns (uint256 amount) {
        amount = address(this).balance;
        if (amount == 0) revert NoBalance();

        IReceiver(RECEIVER).receiveEthInvoice{value: amount}(invoiceId, data);
    }

    function sweepToken(
        address token,
        bytes32 invoiceId,
        bytes calldata data
    ) external returns (uint256 amount) {
        amount = IERC20(token).balanceOf(address(this));
        if (amount == 0) revert NoBalance();

        IERC20(token).forceApprove(RECEIVER, amount);
        IReceiver(RECEIVER).receiveTokenInvoice(token, invoiceId, amount, data);
        IERC20(token).forceApprove(RECEIVER, 0);
    }
}
