// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Account} from "@openzeppelin/contracts/account/Account.sol";
import {ERC7821} from "@openzeppelin/contracts/account/extensions/draft-ERC7821.sol";
import {ERC4337Utils} from "@openzeppelin/contracts/account/utils/draft-ERC4337Utils.sol";
import {Initializable} from "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import {P256OwnerRegistry} from "./P256OwnerRegistry.sol";
import {IWalletRecoveryTarget} from "./IWalletRecovery.sol";

/// @notice Passkey smart wallet with pluggable recovery module hooks.
contract Wallet is Account, ERC7821, Initializable, P256OwnerRegistry, IWalletRecoveryTarget {
    mapping(bytes32 id => OwnerKey) private _ownerKeys;

    address public recoveryContract;
    uint256 public recoveryTimelock;

    bool public paused;
    bytes public recoveryMetadata;

    struct PendingOwner {
        bytes32 qx;
        bytes32 qy;
        uint64 executableAt;
        bytes32 requestId;
        bool active;
    }

    PendingOwner public pendingOwner;

    event Paused(address indexed by);
    event Unpaused(address indexed by);
    event RecoveryMetadataUpdated(bytes update);
    event PendingOwnerScheduled(bytes32 indexed requestId, bytes32 qx, bytes32 qy, uint64 executableAt);
    event PendingOwnerExecuted(bytes32 indexed requestId, bytes32 qx, bytes32 qy);
    event PendingOwnerCancelled(bytes32 indexed requestId);

    error AlreadyInitialized();
    error NotRecovery();
    error WalletPaused();
    error WalletNotPaused();
    error NoPendingOwner();
    error PendingOwnerNotReady();
    error PendingOwnerActive();
    error InvalidSignature();

    modifier whenNotPaused() {
        if (paused) revert WalletPaused();
        _;
    }

    modifier onlyRecovery() {
        if (msg.sender != recoveryContract) revert NotRecovery();
        _;
    }

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(
        bytes32 qx,
        bytes32 qy,
        address recoveryContract_,
        uint256 recoveryTimelock_
    ) external initializer {
        if (recoveryContract_ == address(0)) revert InvalidOwnerKey();
        recoveryContract = recoveryContract_;
        recoveryTimelock = recoveryTimelock_;
        _addOwnerKey(qx, qy);
    }

    // --- IWalletRecoveryTarget ---

    function pause() external onlyRecovery {
        if (paused) return;
        paused = true;
        emit Paused(msg.sender);
    }

    function unpause() external onlyRecovery {
        if (!paused) return;
        paused = false;
        emit Unpaused(msg.sender);
    }

    function authorizeRecoveryUpdate(bytes calldata update) external onlyRecovery {
        recoveryMetadata = update;
        emit RecoveryMetadataUpdated(update);
    }

    function recoveryAddOwner(bytes32 qx, bytes32 qy) external onlyRecovery {
        if (pendingOwner.active) revert PendingOwnerActive();
        bytes32 requestId = keccak256(abi.encodePacked(address(this), qx, qy, block.timestamp));
        pendingOwner = PendingOwner({
            qx: qx,
            qy: qy,
            executableAt: uint64(block.timestamp + recoveryTimelock),
            requestId: requestId,
            active: true
        });
        emit PendingOwnerScheduled(requestId, qx, qy, pendingOwner.executableAt);
    }

    function executePendingOwner() external {
        if (!pendingOwner.active) revert NoPendingOwner();
        if (block.timestamp < pendingOwner.executableAt) revert PendingOwnerNotReady();
        bytes32 qx = pendingOwner.qx;
        bytes32 qy = pendingOwner.qy;
        bytes32 requestId = pendingOwner.requestId;
        pendingOwner.active = false;
        _addOwnerKey(qx, qy);
        paused = false;
        emit PendingOwnerExecuted(requestId, qx, qy);
        emit Unpaused(address(this));
    }

    function cancelPendingOwner() external {
        if (!pendingOwner.active) revert NoPendingOwner();
        if (paused) revert WalletPaused();
        _cancelPendingOwner();
    }

    /// @notice Cancel recovery while paused; any owner passkey signature required.
    function cancelPendingOwnerWithSignature(bytes calldata signature) external {
        if (!paused) revert WalletNotPaused();
        if (!pendingOwner.active) revert NoPendingOwner();
        bytes32 digest = keccak256(abi.encodePacked("cancelPendingOwner", pendingOwner.requestId));
        if (!_validateAnyOwner(digest, signature)) revert InvalidSignature();
        _cancelPendingOwner();
        paused = false;
        emit Unpaused(msg.sender);
    }

    // --- Owner management (immediate, not recovery) ---

    function addOwner(bytes32 qx, bytes32 qy) external onlyEntryPointOrSelf whenNotPaused {
        _addOwnerKey(qx, qy);
    }

    function removeOwner(bytes32 qx, bytes32 qy) external onlyEntryPointOrSelf whenNotPaused {
        _removeOwnerKey(qx, qy);
    }

    // --- Account / ERC7821 ---

    function _erc7821AuthorizedExecutor(
        address caller,
        bytes32 mode,
        bytes calldata executionData
    ) internal view override returns (bool) {
        if (paused) return false;
        return caller == address(entryPoint()) || super._erc7821AuthorizedExecutor(caller, mode, executionData);
    }

    function _rawSignatureValidation(bytes32 hash, bytes calldata signature) internal view override returns (bool) {
        if (paused) return false;
        return _validateAnyOwner(hash, signature);
    }

    function _ownerKeyById(bytes32 id) internal view override returns (bytes32 qx, bytes32 qy) {
        OwnerKey memory key = _ownerKeys[id];
        return (key.qx, key.qy);
    }

    function _storeOwnerKey(bytes32 id, bytes32 qx, bytes32 qy) internal override {
        _ownerKeys[id] = OwnerKey({qx: qx, qy: qy});
    }

    function _removeOwnerId(bytes32 id) internal override {
        delete _ownerKeys[id];
        for (uint256 i = 0; i < _ownerIds.length; i++) {
            if (_ownerIds[i] == id) {
                _ownerIds[i] = _ownerIds[_ownerIds.length - 1];
                _ownerIds.pop();
                break;
            }
        }
    }

    function _cancelPendingOwner() internal {
        if (!pendingOwner.active) revert NoPendingOwner();
        bytes32 requestId = pendingOwner.requestId;
        pendingOwner.active = false;
        emit PendingOwnerCancelled(requestId);
    }
}
