// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IAggregatorV3} from "../../../LiquidityManager/contracts/interfaces/IAggregatorV3.sol";

/// @dev Settable Chainlink-style price feed for tests.
contract MockAggregator is IAggregatorV3 {
    int256 private _answer;
    uint256 private _updatedAt;

    constructor(int256 answer_) {
        _answer = answer_;
        _updatedAt = block.timestamp;
    }

    function setAnswer(int256 answer_) external {
        _answer = answer_;
        _updatedAt = block.timestamp;
    }

    function setUpdatedAt(uint256 updatedAt_) external {
        _updatedAt = updatedAt_;
    }

    function latestRoundData()
        external
        view
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)
    {
        return (1, _answer, _updatedAt, _updatedAt, 1);
    }
}
