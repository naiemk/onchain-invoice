// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AccessControlUpgradeable} from "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import {PausableUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";

/**
 * @title FastSwapCore
 * @notice Chain-agnostic FastSwap logic shared by the EVM `FastSwapReceiver` and the
 *         TRON `TronFastSwapReceiver`. It owns the `SwapIntent`/`SwapState` layout, the
 *         `relaySwap`/`processQueued` flow, liquidity accounting, admin controls and the
 *         `SwapRequested` invoice hook, so a single encoded SwapIntent behaves identically
 *         on every chain.
 *
 *         The only chain-specific pieces are the token primitives, exposed as virtual
 *         hooks: EVM implements them with `SafeERC20`, TRON with low-level TRC20 calls.
 *         Native value transfers (ETH/TRX) are identical across chains and handled here.
 *         The hot payout path (`_processSwap` -> `_transferOut`) performs a single virtual
 *         dispatch to the token hook with no extra storage reads, matching the gas profile
 *         of the previous per-chain implementations.
 *
 *         This contract does not extend a receiver base; each concrete receiver inherits
 *         its chain's base (`Receiver`/`TronReceiver`) plus `FastSwapCore` and wires
 *         `_executeInvoice` to `_executeFastSwapInvoice`.
 */
abstract contract FastSwapCore is AccessControlUpgradeable, PausableUpgradeable {
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    bytes32 public constant RELAYER_ROLE = keccak256("RELAYER_ROLE");
    bytes32 public constant LIQUIDITY_ROLE = keccak256("LIQUIDITY_ROLE");
    bytes32 public constant AGGREGATE_ALL_ROLE = keccak256("AGGREGATE_ALL_ROLE");
    /// @dev Narrow role for an external rebalancer (e.g. the LiquidityManager) to pull
    ///      excess liquidity above the floor without holding the broad ADMIN_ROLE.
    bytes32 public constant REBALANCER_ROLE = keccak256("REBALANCER_ROLE");

    struct SwapIntent {
        uint8 version;
        bytes32 quoteId;
        uint256 sourceChainId;
        address sourceToken;
        uint256 sourceAmount;
        uint256 targetChainId;
        address targetToken;
        uint256 targetAmount;
        address recipient;
        uint64 expiresAt;
        address refundAddress;
    }

    struct SwapState {
        SwapIntent intent;
        bool requested;
        bool relayed;
        bool processed;
        bool queued;
        address paidToken;
        uint256 paidAmount;
    }

    /// @custom:storage-location erc7201:fastswap.storage.FastSwapCore
    struct FastSwapStorage {
        mapping(bytes32 swapId => SwapState state) swaps;
        mapping(address token => uint256 amount) liquidityFloor;
        bytes32[] queuedSwapIds;
    }

    // keccak256(abi.encode(uint256(keccak256("fastswap.storage.FastSwapCore")) - 1)) & ~bytes32(uint256(0xff))
    bytes32 private constant FASTSWAP_STORAGE_LOCATION =
        0xc202e599bf00194ddf9a023608d5682d137afb9d4cebab16a72746b2881aff00;

    event SwapRequested(
        bytes32 indexed swapId,
        bytes32 indexed quoteId,
        uint256 indexed targetChainId,
        address sourceToken,
        uint256 sourceAmount,
        address targetToken,
        uint256 targetAmount,
        address recipient
    );
    event SwapRelayed(bytes32 indexed swapId, uint256 indexed sourceChainId, address relayer);
    event SwapProcessed(bytes32 indexed swapId, address indexed token, address indexed recipient, uint256 amount);
    event SwapQueued(bytes32 indexed swapId, address indexed token, uint256 amount);
    event LiquidityAdded(address indexed token, address indexed from, uint256 amount);
    event LiquidityFloorSet(address indexed token, uint256 amount);
    event AggregatorExecuted(address indexed token, address indexed aggregator, uint256 amountIn, bytes result);
    event AdminSweep(address indexed token, address indexed to, uint256 amount);
    event ExcessWithdrawn(address indexed token, address indexed to, uint256 amount);

    error InvalidIntent();
    error InvalidPayment();
    error InvalidRecipient();
    error SwapAlreadyRequested();
    error SwapAlreadyRelayed();
    error SwapNotQueued();
    error InsufficientLiquidity();
    error ReservedLiquidity();
    error TransferFailed();

    // --- chain-specific token primitives (implemented by each receiver) ---

    /// @dev Transfer `amount` of an ERC20/TRC20 `token` held by this contract to `to`.
    function _transferToken(address token, address to, uint256 amount) internal virtual;

    /// @dev Pull `amount` of `token` from `from` into this contract (requires allowance).
    function _pullToken(address token, address from, uint256 amount) internal virtual;

    /// @dev Set the allowance of `spender` for `token` held by this contract to `amount`.
    function _approveToken(address token, address spender, uint256 amount) internal virtual;

    /// @dev Balance of `token` (an ERC20/TRC20) held by this contract.
    function _tokenBalanceOf(address token) internal view virtual returns (uint256);

    // --- shared initialization ---

    /// @dev Initializes AccessControl/Pausable and grants the full role set to `owner`.
    function __FastSwapCore_init(address owner) internal onlyInitializing {
        __AccessControl_init();
        __Pausable_init();
        _grantRole(DEFAULT_ADMIN_ROLE, owner);
        _grantRole(ADMIN_ROLE, owner);
        _grantRole(RELAYER_ROLE, owner);
        _grantRole(LIQUIDITY_ROLE, owner);
        _grantRole(AGGREGATE_ALL_ROLE, owner);
        _grantRole(REBALANCER_ROLE, owner);
    }

    // --- views ---

    function swapState(bytes32 swapId) external view returns (SwapState memory) {
        return _getFastSwapStorage().swaps[swapId];
    }

    function queuedSwapCount() external view returns (uint256) {
        return _getFastSwapStorage().queuedSwapIds.length;
    }

    function queuedSwapIdAt(uint256 index) external view returns (bytes32) {
        return _getFastSwapStorage().queuedSwapIds[index];
    }

    function liquidityFloor(address token) external view returns (uint256) {
        return _getFastSwapStorage().liquidityFloor[token];
    }

    // --- liquidity & relay ---

    function addLiquidity(address token, uint256 amount) external payable onlyRole(LIQUIDITY_ROLE) {
        if (token == address(0)) {
            if (msg.value != amount || amount == 0) revert InvalidPayment();
        } else {
            if (msg.value != 0 || amount == 0) revert InvalidPayment();
            _pullToken(token, msg.sender, amount);
        }
        emit LiquidityAdded(token, msg.sender, amount);
    }

    function relaySwap(bytes calldata data) external onlyRole(RELAYER_ROLE) whenNotPaused {
        SwapIntent memory intent = _decodeIntent(data);
        bytes32 swapId = keccak256(data);
        FastSwapStorage storage $ = _getFastSwapStorage();
        SwapState storage state = $.swaps[swapId];
        if (state.relayed) revert SwapAlreadyRelayed();

        state.intent = intent;
        state.relayed = true;
        emit SwapRelayed(swapId, intent.sourceChainId, msg.sender);

        if (_availableLiquidity(intent.targetToken) >= intent.targetAmount) {
            _processSwap($, swapId, state);
        } else {
            state.queued = true;
            $.queuedSwapIds.push(swapId);
            emit SwapQueued(swapId, intent.targetToken, intent.targetAmount);
        }
    }

    function processQueued(bytes32 swapId) external onlyRole(LIQUIDITY_ROLE) whenNotPaused {
        FastSwapStorage storage $ = _getFastSwapStorage();
        SwapState storage state = $.swaps[swapId];
        if (!state.queued || state.processed) revert SwapNotQueued();
        if (_availableLiquidity(state.intent.targetToken) < state.intent.targetAmount) revert InsufficientLiquidity();
        _processSwap($, swapId, state);
    }

    function setLiquidityFloor(address token, uint256 amount) external onlyRole(ADMIN_ROLE) {
        _getFastSwapStorage().liquidityFloor[token] = amount;
        emit LiquidityFloorSet(token, amount);
    }

    function pause() external onlyRole(ADMIN_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(ADMIN_ROLE) {
        _unpause();
    }

    function adminSweep(address token, address to, uint256 amount) external onlyRole(ADMIN_ROLE) {
        if (to == address(0)) revert InvalidRecipient();
        uint256 available = _availableLiquidity(token);
        if (amount > available) revert ReservedLiquidity();
        _transferOut(token, to, amount);
        emit AdminSweep(token, to, amount);
    }

    /**
     * @notice Withdraw liquidity above the floor to `to`. Scoped to `REBALANCER_ROLE` so an
     *         automated rebalancer (the LiquidityManager) can pull excess inventory without the
     *         broad powers of `ADMIN_ROLE`. Like `adminSweep`, it can never touch reserved
     *         liquidity below `liquidityFloor`, so the swap-payout path stays protected.
     */
    function withdrawExcess(address token, address to, uint256 amount) external onlyRole(REBALANCER_ROLE) {
        if (to == address(0)) revert InvalidRecipient();
        if (amount > _availableLiquidity(token)) revert ReservedLiquidity();
        _transferOut(token, to, amount);
        emit ExcessWithdrawn(token, to, amount);
    }

    function aggregateAll(
        address token,
        address aggregator,
        uint256 minReserve,
        bytes calldata callData
    ) external onlyRole(AGGREGATE_ALL_ROLE) returns (bytes memory result) {
        if (aggregator == address(0)) revert InvalidRecipient();
        uint256 balance = _balanceOf(token);
        if (balance <= minReserve) revert ReservedLiquidity();
        uint256 amountIn = balance - minReserve;

        if (token == address(0)) {
            (bool ok, bytes memory data) = aggregator.call{value: amountIn}(callData);
            if (!ok) revert InvalidPayment();
            result = data;
        } else {
            _approveToken(token, aggregator, amountIn);
            (bool ok, bytes memory data) = aggregator.call(callData);
            if (!ok) revert InvalidPayment();
            result = data;
            _approveToken(token, aggregator, 0);
        }

        emit AggregatorExecuted(token, aggregator, amountIn, result);
    }

    // --- invoice hook (called by each receiver's _executeInvoice) ---

    function _executeFastSwapInvoice(
        bytes32 invoiceId,
        address token,
        uint256 amount,
        bytes calldata data
    ) internal whenNotPaused returns (bytes memory) {
        SwapIntent memory intent = _decodeIntent(data);
        if (invoiceId != keccak256(data)) revert InvalidIntent();
        if (intent.sourceToken != token || amount < intent.sourceAmount || block.timestamp > intent.expiresAt) {
            revert InvalidPayment();
        }

        FastSwapStorage storage $ = _getFastSwapStorage();
        SwapState storage state = $.swaps[invoiceId];
        if (state.requested) revert SwapAlreadyRequested();

        state.intent = intent;
        state.requested = true;
        state.paidToken = token;
        state.paidAmount = amount;

        emit SwapRequested(
            invoiceId,
            intent.quoteId,
            intent.targetChainId,
            token,
            amount,
            intent.targetToken,
            intent.targetAmount,
            intent.recipient
        );

        return "";
    }

    // --- internal helpers ---

    function _processSwap(FastSwapStorage storage, bytes32 swapId, SwapState storage state) private {
        state.queued = false;
        state.processed = true;
        _transferOut(state.intent.targetToken, state.intent.recipient, state.intent.targetAmount);
        emit SwapProcessed(swapId, state.intent.targetToken, state.intent.recipient, state.intent.targetAmount);
    }

    function _decodeIntent(bytes calldata data) private pure returns (SwapIntent memory intent) {
        intent = abi.decode(data, (SwapIntent));
        if (intent.version != 1 || intent.recipient == address(0) || intent.expiresAt == 0) revert InvalidIntent();
    }

    function _availableLiquidity(address token) private view returns (uint256) {
        FastSwapStorage storage $ = _getFastSwapStorage();
        uint256 balance = _balanceOf(token);
        uint256 floor = $.liquidityFloor[token];
        return balance > floor ? balance - floor : 0;
    }

    function _balanceOf(address token) private view returns (uint256) {
        return token == address(0) ? address(this).balance : _tokenBalanceOf(token);
    }

    function _transferOut(address token, address to, uint256 amount) private {
        if (token == address(0)) {
            (bool ok,) = to.call{value: amount}("");
            if (!ok) revert InvalidPayment();
        } else {
            _transferToken(token, to, amount);
        }
    }

    function supportsInterface(bytes4 interfaceId)
        public
        view
        virtual
        override(AccessControlUpgradeable)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }

    function _getFastSwapStorage() private pure returns (FastSwapStorage storage $) {
        assembly {
            $.slot := FASTSWAP_STORAGE_LOCATION
        }
    }
}
