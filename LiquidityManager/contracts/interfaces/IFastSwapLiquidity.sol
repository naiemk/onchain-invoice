// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title IFastSwapLiquidity
 * @notice The subset of `FastSwapCore` the LiquidityManager calls on each managed receiver:
 *         `withdrawExcess` (REBALANCER_ROLE) to pull inventory above the floor, and
 *         `addLiquidity` (LIQUIDITY_ROLE) to deposit inventory. The LiquidityManager must hold
 *         both roles on every receiver it manages.
 */
interface IFastSwapLiquidity {
    function withdrawExcess(address token, address to, uint256 amount) external;

    function addLiquidity(address token, uint256 amount) external payable;
}
