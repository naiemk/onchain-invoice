// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title IAggregatorV3
 * @notice Minimal Chainlink Data Feed interface. The same interface is exposed by
 *         Chainlink feeds on EVM chains and on TRON (Chainlink is the official TRON oracle),
 *         so the LiquidityManager oracle guard is identical across chains.
 */
interface IAggregatorV3 {
    function latestRoundData()
        external
        view
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound);
}
