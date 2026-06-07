// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @dev Minimal DEX router used only in tests. The caller (LiquidityManager) precomputes the exact
 *      output and encodes a `swap` call; the router pulls `amountIn` of `tokenIn` (native via
 *      msg.value or ERC20 via allowance) and sends `amountOut` of `tokenOut` back to the caller.
 *      Setting `amountOut` below the fair value lets tests exercise the slippage / oracle guards.
 *      Must be pre-funded with the output token.
 */
contract MockSwapRouter {
    address private constant NATIVE = address(0);

    receive() external payable {}

    function swap(address tokenIn, uint256 amountIn, address tokenOut, uint256 amountOut) external payable {
        if (tokenIn == NATIVE) {
            require(msg.value == amountIn, "bad value");
        } else {
            require(msg.value == 0, "no value");
            IERC20(tokenIn).transferFrom(msg.sender, address(this), amountIn);
        }

        if (tokenOut == NATIVE) {
            (bool ok,) = msg.sender.call{value: amountOut}("");
            require(ok, "native out failed");
        } else {
            IERC20(tokenOut).transfer(msg.sender, amountOut);
        }
    }
}
