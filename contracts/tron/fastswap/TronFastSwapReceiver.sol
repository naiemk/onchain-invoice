// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ITrc20} from "../interfaces/ITrc20.sol";
import {TronReceiver} from "../TronReceiver.sol";
import {FastSwapCore} from "../../../app/fastswap/contracts/FastSwapCore.sol";

/**
 * @title TronFastSwapReceiver
 * @notice TRON (TVM) FastSwap receiver: combines the forwarder-based invoice sweeping of
 *         `TronReceiver` with the chain-agnostic FastSwap logic in `FastSwapCore`, so a
 *         single encoded SwapIntent behaves identically across EVM and TRON. Token
 *         primitives use low-level TRC20 calls via `ITrc20` (TRC20 return values are
 *         non-standard), and TRX is the native asset.
 */
contract TronFastSwapReceiver is TronReceiver, FastSwapCore {
    receive() external payable {}

    function initialize(address initialOwner) public override(TronReceiver) initializer {
        __Ownable_init(initialOwner);
        __FastSwapCore_init(initialOwner);
    }

    function _executeInvoice(
        bytes32 invoiceId,
        address token,
        uint256 amount,
        bytes calldata data
    ) internal override(TronReceiver) returns (bytes memory) {
        return _executeFastSwapInvoice(invoiceId, token, amount, data);
    }

    function _transferToken(address token, address to, uint256 amount) internal override {
        (bool ok, bytes memory result) = token.call(abi.encodeCall(ITrc20.transfer, (to, amount)));
        if (!ok || (result.length != 0 && !abi.decode(result, (bool)))) revert TransferFailed();
    }

    function _pullToken(address token, address from, uint256 amount) internal override {
        (bool ok, bytes memory result) =
            token.call(abi.encodeWithSignature("transferFrom(address,address,uint256)", from, address(this), amount));
        if (!ok || (result.length != 0 && !abi.decode(result, (bool)))) revert TransferFailed();
    }

    function _approveToken(address token, address spender, uint256 amount) internal override {
        (bool ok, bytes memory result) =
            token.call(abi.encodeWithSignature("approve(address,uint256)", spender, amount));
        if (!ok || (result.length != 0 && !abi.decode(result, (bool)))) revert TransferFailed();
    }

    function _tokenBalanceOf(address token) internal view override returns (uint256) {
        return ITrc20(token).balanceOf(address(this));
    }

    function _authorizeUpgrade(address newImplementation) internal override(TronReceiver) onlyRole(ADMIN_ROLE) {}
}
