// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface ITrc20 {
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
}
