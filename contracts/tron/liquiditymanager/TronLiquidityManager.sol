// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {ITrc20} from "../interfaces/ITrc20.sol";
import {LiquidityManagerCore} from "../../../LiquidityManager/contracts/LiquidityManagerCore.sol";

/**
 * @title TronLiquidityManager
 * @notice TRON (TVM) treasury + rebalancer. Mirrors the EVM `LiquidityManager` but implements the
 *         token primitives with low-level TRC20 calls via `ITrc20` (TRC20 return values are
 *         non-standard) and treats TRX as the native asset, so the same `LiquidityManagerCore`
 *         logic, oracle guard and rebalance flow behave identically across chains. Chainlink is the
 *         official TRON oracle, so the `IAggregatorV3` guard in the core needs no TRON-specific code.
 */
contract TronLiquidityManager is Initializable, UUPSUpgradeable, LiquidityManagerCore {
    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    receive() external payable {}

    function initialize(address initialOwner) external initializer {
        __LiquidityManagerCore_init(initialOwner);
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

    function _authorizeUpgrade(address newImplementation) internal override onlyRole(ADMIN_ROLE) {}
}
