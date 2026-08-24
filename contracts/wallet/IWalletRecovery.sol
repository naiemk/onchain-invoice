// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Pluggable recovery policy invoked by guardians / future modules.
interface IWalletRecovery {
    function initiateOwnerRecovery(address wallet, bytes calldata newOwnerPubkey) external;

    function executeOwnerRecovery(address wallet) external;
}

/// @notice Recovery-only hooks exposed by each wallet proxy.
interface IWalletRecoveryTarget {
    function recoveryContract() external view returns (address);

    function paused() external view returns (bool);

    function pause() external;

    function unpause() external;

    function authorizeRecoveryUpdate(bytes calldata update) external;

    function recoveryAddOwner(bytes32 qx, bytes32 qy) external;

    function executePendingOwner() external;

    function cancelPendingOwner() external;
}
