// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Wallet} from "./Wallet.sol";

/// @notice Deploys wallet clones wired to a shared recovery implementation.
contract WalletFactory is Ownable {
    address public immutable walletImplementation;
    address public recoveryImpl;
    uint256 public recoveryTimelock;

    event WalletCreated(address indexed wallet, bytes32 indexed salt, bytes32 qx, bytes32 qy);
    event RecoveryImplUpdated(address indexed recoveryImpl);
    event RecoveryTimelockUpdated(uint256 recoveryTimelock);

    error ZeroAddress();

    constructor(
        address walletImplementation_,
        address recoveryImpl_,
        uint256 recoveryTimelock_,
        address initialOwner
    ) Ownable(initialOwner) {
        if (walletImplementation_ == address(0) || recoveryImpl_ == address(0)) revert ZeroAddress();
        walletImplementation = walletImplementation_;
        recoveryImpl = recoveryImpl_;
        recoveryTimelock = recoveryTimelock_;
    }

    function setRecoveryImpl(address recoveryImpl_) external onlyOwner {
        if (recoveryImpl_ == address(0)) revert ZeroAddress();
        recoveryImpl = recoveryImpl_;
        emit RecoveryImplUpdated(recoveryImpl_);
    }

    function setRecoveryTimelock(uint256 recoveryTimelock_) external onlyOwner {
        recoveryTimelock = recoveryTimelock_;
        emit RecoveryTimelockUpdated(recoveryTimelock_);
    }

    function predictAddress(bytes32 salt) public view returns (address) {
        return Clones.predictDeterministicAddress(walletImplementation, salt, address(this));
    }

    function createAccount(bytes32 qx, bytes32 qy, bytes32 salt) external returns (address wallet) {
        wallet = predictAddress(salt);
        if (wallet.code.length == 0) {
            wallet = Clones.cloneDeterministic(walletImplementation, salt);
            Wallet(payable(wallet)).initialize(qx, qy, recoveryImpl, recoveryTimelock);
        }
        emit WalletCreated(wallet, salt, qx, qy);
    }
}
