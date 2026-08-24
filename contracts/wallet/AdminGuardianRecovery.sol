// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IWalletRecovery, IWalletRecoveryTarget} from "./IWalletRecovery.sol";

/// @notice MVP recovery: single admin guardian can start timelocked owner recovery.
contract AdminGuardianRecovery is IWalletRecovery, Ownable {
    address public guardian;

    event GuardianUpdated(address indexed guardian);

    error NotGuardian();
    error InvalidWallet();
    error InvalidOwnerPubkey();

    modifier onlyGuardian() {
        if (msg.sender != guardian) revert NotGuardian();
        _;
    }

    constructor(address guardian_, address initialOwner) Ownable(initialOwner) {
        guardian = guardian_;
    }

    function setGuardian(address guardian_) external onlyOwner {
        guardian = guardian_;
        emit GuardianUpdated(guardian_);
    }

    function initiateOwnerRecovery(address wallet, bytes calldata newOwnerPubkey) external onlyGuardian {
        if (wallet.code.length == 0) revert InvalidWallet();
        (bytes32 qx, bytes32 qy) = abi.decode(newOwnerPubkey, (bytes32, bytes32));
        if (qx == bytes32(0) && qy == bytes32(0)) revert InvalidOwnerPubkey();
        IWalletRecoveryTarget target = IWalletRecoveryTarget(wallet);
        target.pause();
        target.recoveryAddOwner(qx, qy);
    }

    function executeOwnerRecovery(address wallet) external {
        if (wallet.code.length == 0) revert InvalidWallet();
        IWalletRecoveryTarget(wallet).executePendingOwner();
    }

    function authorizeRecoveryUpdate(address wallet, bytes calldata update) external onlyGuardian {
        if (wallet.code.length == 0) revert InvalidWallet();
        IWalletRecoveryTarget(wallet).authorizeRecoveryUpdate(update);
    }
}
