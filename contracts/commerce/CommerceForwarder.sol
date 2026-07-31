// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @notice Minimal invoice proxy implementation. Only the sweeper may move funds.
/// Destination `to` is validated by CommerceInvoiceSweeper via CREATE2 salt before calling.
contract CommerceForwarder {
    using SafeERC20 for IERC20;

    address public immutable SWEEPER;

    error OnlySweeper();
    error ZeroAmount();
    error InsufficientBalance();
    error EthTransferFailed();

    constructor(address sweeper_) {
        SWEEPER = sweeper_;
    }

    receive() external payable {}

    function sweepEth(address to, uint256 amount) external returns (uint256) {
        if (msg.sender != SWEEPER) revert OnlySweeper();
        if (amount == 0) revert ZeroAmount();
        if (address(this).balance < amount) revert InsufficientBalance();

        (bool ok, ) = to.call{value: amount}("");
        if (!ok) revert EthTransferFailed();
        return amount;
    }

    function sweepToken(address token, address to, uint256 amount) external returns (uint256) {
        if (msg.sender != SWEEPER) revert OnlySweeper();
        if (amount == 0) revert ZeroAmount();
        if (IERC20(token).balanceOf(address(this)) < amount) revert InsufficientBalance();

        IERC20(token).safeTransfer(to, amount);
        return amount;
    }
}
