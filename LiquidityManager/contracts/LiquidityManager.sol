// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {LiquidityManagerCore} from "./LiquidityManagerCore.sol";

/**
 * @title LiquidityManager
 * @notice EVM treasury + rebalancer. Holds a stablecoin reserve and rebalances FastSwap receivers
 *         via `LiquidityManagerCore`. Token primitives use `SafeERC20`; ETH is the native asset.
 *         Deployed behind an ERC-1967 proxy (UUPS).
 */
contract LiquidityManager is Initializable, UUPSUpgradeable, LiquidityManagerCore {
    using SafeERC20 for IERC20;

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    receive() external payable {}

    function initialize(address initialOwner) external initializer {
        __LiquidityManagerCore_init(initialOwner);
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

    function _authorizeUpgrade(address newImplementation) internal override onlyRole(ADMIN_ROLE) {}
}
