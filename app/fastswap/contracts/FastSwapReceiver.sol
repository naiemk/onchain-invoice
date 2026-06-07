// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Receiver} from "../../../contracts/Receiver.sol";
import {FastSwapCore} from "./FastSwapCore.sol";

/**
 * @title FastSwapReceiver
 * @notice EVM FastSwap receiver: combines the forwarder-based invoice sweeping of
 *         `Receiver` with the chain-agnostic FastSwap logic in `FastSwapCore`. Token
 *         primitives use `SafeERC20`; ETH is the native asset.
 */
contract FastSwapReceiver is Receiver, FastSwapCore {
    using SafeERC20 for IERC20;

    receive() external payable {}

    function initialize(address initialOwner) public override(Receiver) initializer {
        __Ownable_init(initialOwner);
        __FastSwapCore_init(initialOwner);
    }

    function _executeInvoice(
        bytes32 invoiceId,
        address token,
        uint256 amount,
        bytes calldata data
    ) internal override(Receiver) returns (bytes memory) {
        return _executeFastSwapInvoice(invoiceId, token, amount, data);
    }

    function _transferToken(address token, address to, uint256 amount) internal override {
        IERC20(token).safeTransfer(to, amount);
    }

    function _pullToken(address token, address from, uint256 amount) internal override {
        IERC20(token).safeTransferFrom(from, address(this), amount);
    }

    function _approveToken(address token, address spender, uint256 amount) internal override {
        IERC20(token).forceApprove(spender, amount);
    }

    function _tokenBalanceOf(address token) internal view override returns (uint256) {
        return IERC20(token).balanceOf(address(this));
    }

    function _authorizeUpgrade(address newImplementation) internal override(Receiver) onlyRole(ADMIN_ROLE) {}
}
