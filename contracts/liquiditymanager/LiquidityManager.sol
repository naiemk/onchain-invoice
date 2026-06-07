// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

// Compile wrapper so Hardhat (sources = contracts/) builds the top-level LiquidityManager app
// contract and its dependency graph. Mirrors contracts/fastswap/FastSwapReceiver.sol.
import {LiquidityManager as AppLiquidityManager} from "../../LiquidityManager/contracts/LiquidityManager.sol";

contract LiquidityManager is AppLiquidityManager {}
