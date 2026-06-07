// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AccessControlUpgradeable} from "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import {PausableUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import {IAggregatorV3} from "./interfaces/IAggregatorV3.sol";
import {IFastSwapLiquidity} from "./interfaces/IFastSwapLiquidity.sol";

/**
 * @title LiquidityManagerCore
 * @notice Chain-agnostic treasury + rebalancing engine shared by the EVM `LiquidityManager`
 *         and the TRON `TronLiquidityManager`. It holds a stablecoin reserve and rebalances the
 *         FastSwap receivers' per-token inventory by:
 *           - pulling excess inventory out of a receiver (`pullFromReceiver` -> receiver.withdrawExcess),
 *           - swapping the volatile leg through a whitelisted DEX router/aggregator (`swap`),
 *           - depositing inventory back into a receiver (`pushToReceiver` -> receiver.addLiquidity),
 *         and can batch all three in one atomic `rebalance` call.
 *
 *         Policy (bands, cadence, the economic gas/notional gate, route selection) lives off-chain
 *         in the rebalancer bot. This contract is the *safe executor*: it only enforces invariants
 *         that protect funds and cannot be delegated off-chain:
 *           - routers must be whitelisted,
 *           - swap output must clear both the bot-supplied `minOut` and an independent Chainlink
 *             oracle floor (deviation + freshness), measured from real balance deltas,
 *           - per-token single-swap caps bound the blast radius of any one call,
 *           - pausable, reentrancy-guarded, role-gated, with an admin emergency withdraw.
 *
 *         The only chain-specific pieces are the token primitives, exposed as virtual hooks:
 *         EVM implements them with `SafeERC20`, TRON with low-level TRC20 calls. Native value
 *         (ETH/TRX) is handled here. The Chainlink oracle interface is identical on both chains.
 */
abstract contract LiquidityManagerCore is AccessControlUpgradeable, PausableUpgradeable {
    address internal constant NATIVE_TOKEN = address(0);
    uint256 private constant BPS_DENOMINATOR = 10_000;
    uint256 private constant USD_SCALE = 1e18;
    uint256 private constant _NOT_ENTERED = 1;
    uint256 private constant _ENTERED = 2;

    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    /// @dev Hot rebalancer bot: may execute swaps and move inventory within the on-chain guardrails.
    bytes32 public constant REBALANCER_ROLE = keccak256("REBALANCER_ROLE");

    enum ActionKind {
        Pull,
        Swap,
        Push
    }

    /// @param kind        which primitive to run
    /// @param receiver    target FastSwap receiver (Pull/Push)
    /// @param router      whitelisted DEX router/aggregator (Swap)
    /// @param tokenIn     token spent (Swap) or moved (Pull/Push); address(0) = native
    /// @param tokenOut    token received (Swap)
    /// @param amount      amountIn (Swap) or amount moved (Pull/Push)
    /// @param minOut      minimum acceptable output, bot-supplied slippage bound (Swap)
    /// @param data        router calldata produced off-chain by the aggregator (Swap)
    struct Action {
        ActionKind kind;
        address receiver;
        address router;
        address tokenIn;
        address tokenOut;
        uint256 amount;
        uint256 minOut;
        bytes data;
    }

    /// @param feed         Chainlink aggregator for token/USD
    /// @param feedDecimals decimals of the feed answer (Chainlink USD feeds are typically 8)
    /// @param tokenDecimals decimals of the token itself (18 for ETH, 6 for USDT/TRX, ...)
    /// @param maxStaleness max age (seconds) of the feed answer before it is rejected
    /// @param set          whether this token has a configured oracle
    struct OracleConfig {
        address feed;
        uint8 feedDecimals;
        uint8 tokenDecimals;
        uint64 maxStaleness;
        bool set;
    }

    /// @custom:storage-location erc7201:liquiditymanager.storage.LiquidityManagerCore
    struct LMStorage {
        mapping(address router => bool allowed) allowedRouter;
        mapping(address token => OracleConfig config) oracle;
        mapping(address token => uint256 cap) maxSwap; // 0 = no cap
        uint32 maxDeviationBps; // allowed shortfall vs the oracle-implied output
        bool requireOracle; // when true, a swap whose tokens lack oracles reverts
        uint256 reentrancyStatus;
    }

    // keccak256(abi.encode(uint256(keccak256("liquiditymanager.storage.LiquidityManagerCore")) - 1)) & ~bytes32(uint256(0xff))
    bytes32 private constant LM_STORAGE_LOCATION =
        0xfd3c7c6bfed2114c7ed8b7a7a5552e991545f3aa3f341aaa5e62e169fedc9b00;

    event RouterAllowed(address indexed router, bool allowed);
    event OracleSet(address indexed token, address indexed feed, uint8 feedDecimals, uint8 tokenDecimals, uint64 maxStaleness);
    event OracleCleared(address indexed token);
    event MaxSwapSet(address indexed token, uint256 cap);
    event DeviationSet(uint32 maxDeviationBps);
    event RequireOracleSet(bool required);
    event Swapped(address indexed router, address indexed tokenIn, address indexed tokenOut, uint256 amountIn, uint256 amountOut);
    event PulledFromReceiver(address indexed receiver, address indexed token, uint256 amount);
    event PushedToReceiver(address indexed receiver, address indexed token, uint256 amount);
    event EmergencyWithdraw(address indexed token, address indexed to, uint256 amount);

    error RouterNotAllowed();
    error SwapCapExceeded();
    error Slippage();
    error OracleMissing();
    error OracleDeviation();
    error StaleOracle();
    error BadPrice();
    error SwapCallFailed();
    error InvalidRecipient();
    error InvalidAmount();
    error NativeBothSides();
    error NativeTransferFailed();
    error TransferFailed();
    error ReentrantCall();

    /// @dev Minimal reentrancy guard (the slim contracts-upgradeable build here lacks
    ///      ReentrancyGuardUpgradeable, and the shanghai EVM target rules out transient storage).
    modifier nonReentrant() {
        LMStorage storage $ = _lm();
        if ($.reentrancyStatus == _ENTERED) revert ReentrantCall();
        $.reentrancyStatus = _ENTERED;
        _;
        $.reentrancyStatus = _NOT_ENTERED;
    }

    // --- chain-specific token primitives (implemented by each adapter) ---

    function _transferToken(address token, address to, uint256 amount) internal virtual;

    function _pullToken(address token, address from, uint256 amount) internal virtual;

    function _approveToken(address token, address spender, uint256 amount) internal virtual;

    function _tokenBalanceOf(address token) internal view virtual returns (uint256);

    // --- initialization ---

    function __LiquidityManagerCore_init(address owner) internal onlyInitializing {
        __AccessControl_init();
        __Pausable_init();
        _grantRole(DEFAULT_ADMIN_ROLE, owner);
        _grantRole(ADMIN_ROLE, owner);
        _grantRole(REBALANCER_ROLE, owner);
        LMStorage storage $ = _lm();
        $.maxDeviationBps = 200; // 2% default backstop
        $.requireOracle = true;
        $.reentrancyStatus = _NOT_ENTERED;
    }

    // --- admin config ---

    function setRouterAllowed(address router, bool allowed) external onlyRole(ADMIN_ROLE) {
        if (router == address(0)) revert InvalidRecipient();
        _lm().allowedRouter[router] = allowed;
        emit RouterAllowed(router, allowed);
    }

    function setOracle(
        address token,
        address feed,
        uint8 feedDecimals,
        uint8 tokenDecimals,
        uint64 maxStaleness
    ) external onlyRole(ADMIN_ROLE) {
        if (feed == address(0) || maxStaleness == 0) revert InvalidAmount();
        _lm().oracle[token] =
            OracleConfig({feed: feed, feedDecimals: feedDecimals, tokenDecimals: tokenDecimals, maxStaleness: maxStaleness, set: true});
        emit OracleSet(token, feed, feedDecimals, tokenDecimals, maxStaleness);
    }

    function clearOracle(address token) external onlyRole(ADMIN_ROLE) {
        delete _lm().oracle[token];
        emit OracleCleared(token);
    }

    function setMaxSwap(address token, uint256 cap) external onlyRole(ADMIN_ROLE) {
        _lm().maxSwap[token] = cap;
        emit MaxSwapSet(token, cap);
    }

    function setMaxDeviationBps(uint32 newMaxDeviationBps) external onlyRole(ADMIN_ROLE) {
        if (newMaxDeviationBps >= BPS_DENOMINATOR) revert InvalidAmount();
        _lm().maxDeviationBps = newMaxDeviationBps;
        emit DeviationSet(newMaxDeviationBps);
    }

    function setRequireOracle(bool required) external onlyRole(ADMIN_ROLE) {
        _lm().requireOracle = required;
        emit RequireOracleSet(required);
    }

    function pause() external onlyRole(ADMIN_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(ADMIN_ROLE) {
        _unpause();
    }

    function emergencyWithdraw(address token, address to, uint256 amount) external onlyRole(ADMIN_ROLE) {
        if (to == address(0)) revert InvalidRecipient();
        _transferOut(token, to, amount);
        emit EmergencyWithdraw(token, to, amount);
    }

    // --- views ---

    function isRouterAllowed(address router) external view returns (bool) {
        return _lm().allowedRouter[router];
    }

    function oracleConfig(address token) external view returns (OracleConfig memory) {
        return _lm().oracle[token];
    }

    function maxSwap(address token) external view returns (uint256) {
        return _lm().maxSwap[token];
    }

    function maxDeviationBps() external view returns (uint32) {
        return _lm().maxDeviationBps;
    }

    function requireOracle() external view returns (bool) {
        return _lm().requireOracle;
    }

    function reserveBalance(address token) external view returns (uint256) {
        return _balanceOf(token);
    }

    // --- rebalancing actions (REBALANCER_ROLE) ---

    function swap(
        address router,
        address tokenIn,
        uint256 amountIn,
        address tokenOut,
        uint256 minOut,
        bytes calldata data
    ) external onlyRole(REBALANCER_ROLE) whenNotPaused nonReentrant returns (uint256 amountOut) {
        return _swap(router, tokenIn, amountIn, tokenOut, minOut, data);
    }

    function pullFromReceiver(address receiver, address token, uint256 amount)
        external
        onlyRole(REBALANCER_ROLE)
        whenNotPaused
        nonReentrant
    {
        _pull(receiver, token, amount);
    }

    function pushToReceiver(address receiver, address token, uint256 amount)
        external
        onlyRole(REBALANCER_ROLE)
        whenNotPaused
        nonReentrant
    {
        _push(receiver, token, amount);
    }

    /// @notice Execute a batch of pull/swap/push actions atomically. Reverts the whole batch on
    ///         any failure so the rebalance never leaves a half-applied state.
    function rebalance(Action[] calldata actions) external onlyRole(REBALANCER_ROLE) whenNotPaused nonReentrant {
        uint256 len = actions.length;
        for (uint256 i; i < len; ++i) {
            Action calldata a = actions[i];
            if (a.kind == ActionKind.Pull) {
                _pull(a.receiver, a.tokenIn, a.amount);
            } else if (a.kind == ActionKind.Push) {
                _push(a.receiver, a.tokenIn, a.amount);
            } else {
                _swap(a.router, a.tokenIn, a.amount, a.tokenOut, a.minOut, a.data);
            }
        }
    }

    // --- internals ---

    function _swap(
        address router,
        address tokenIn,
        uint256 amountIn,
        address tokenOut,
        uint256 minOut,
        bytes calldata data
    ) private returns (uint256 amountOut) {
        if (amountIn == 0) revert InvalidAmount();
        if (tokenIn == NATIVE_TOKEN && tokenOut == NATIVE_TOKEN) revert NativeBothSides();
        LMStorage storage $ = _lm();
        if (!$.allowedRouter[router]) revert RouterNotAllowed();
        uint256 cap = $.maxSwap[tokenIn];
        if (cap != 0 && amountIn > cap) revert SwapCapExceeded();

        uint256 outBefore = _balanceOf(tokenOut);

        if (tokenIn == NATIVE_TOKEN) {
            (bool ok,) = router.call{value: amountIn}(data);
            if (!ok) revert SwapCallFailed();
        } else {
            _approveToken(tokenIn, router, amountIn);
            (bool ok,) = router.call(data);
            if (!ok) revert SwapCallFailed();
            _approveToken(tokenIn, router, 0);
        }

        amountOut = _balanceOf(tokenOut) - outBefore;
        if (amountOut < minOut) revert Slippage();
        _enforceOracleFloor($, tokenIn, tokenOut, amountIn, amountOut);

        emit Swapped(router, tokenIn, tokenOut, amountIn, amountOut);
    }

    function _pull(address receiver, address token, uint256 amount) private {
        if (amount == 0) revert InvalidAmount();
        IFastSwapLiquidity(receiver).withdrawExcess(token, address(this), amount);
        emit PulledFromReceiver(receiver, token, amount);
    }

    function _push(address receiver, address token, uint256 amount) private {
        if (amount == 0) revert InvalidAmount();
        if (token == NATIVE_TOKEN) {
            IFastSwapLiquidity(receiver).addLiquidity{value: amount}(token, amount);
        } else {
            _approveToken(token, receiver, amount);
            IFastSwapLiquidity(receiver).addLiquidity(token, amount);
            _approveToken(token, receiver, 0);
        }
        emit PushedToReceiver(receiver, token, amount);
    }

    /// @dev Reject swaps that return materially less than the Chainlink-implied output. The bot's
    ///      `minOut` is the primary slippage bound; this is an independent backstop that holds even
    ///      if the bot key is compromised or fed a manipulated quote.
    function _enforceOracleFloor(
        LMStorage storage $,
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 amountOut
    ) private view {
        OracleConfig storage inC = $.oracle[tokenIn];
        OracleConfig storage outC = $.oracle[tokenOut];
        if (!inC.set || !outC.set) {
            if ($.requireOracle) revert OracleMissing();
            return;
        }

        uint256 priceInUsd = _priceUsd(inC); // 1e18-scaled USD per whole token
        uint256 priceOutUsd = _priceUsd(outC);

        // expectedOut (tokenOut base units) = amountIn * priceInUsd / priceOutUsd, adjusted for token decimals
        uint256 expectedOut = (amountIn * priceInUsd * (10 ** outC.tokenDecimals))
            / (priceOutUsd * (10 ** inC.tokenDecimals));
        uint256 floorOut = (expectedOut * (BPS_DENOMINATOR - $.maxDeviationBps)) / BPS_DENOMINATOR;
        if (amountOut < floorOut) revert OracleDeviation();
    }

    function _priceUsd(OracleConfig storage c) private view returns (uint256) {
        (, int256 answer,, uint256 updatedAt,) = IAggregatorV3(c.feed).latestRoundData();
        if (answer <= 0) revert BadPrice();
        if (block.timestamp - updatedAt > c.maxStaleness) revert StaleOracle();
        return (uint256(answer) * USD_SCALE) / (10 ** c.feedDecimals);
    }

    function _balanceOf(address token) private view returns (uint256) {
        return token == NATIVE_TOKEN ? address(this).balance : _tokenBalanceOf(token);
    }

    function _transferOut(address token, address to, uint256 amount) private {
        if (amount == 0) revert InvalidAmount();
        if (token == NATIVE_TOKEN) {
            (bool ok,) = to.call{value: amount}("");
            if (!ok) revert NativeTransferFailed();
        } else {
            _transferToken(token, to, amount);
        }
    }

    function _lm() private pure returns (LMStorage storage $) {
        assembly {
            $.slot := LM_STORAGE_LOCATION
        }
    }
}
