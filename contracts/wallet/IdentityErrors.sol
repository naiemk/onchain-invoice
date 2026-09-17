// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @dev Custom errors for identity contracts (declared here so they appear on inheriting ABIs).
abstract contract IdentityErrors {
    error IdentityExists();
    error IdentityNotFound();
    error InvalidIdentity();
    error InvalidMethodKind();
    error InvalidMethod();
    error MethodExists();
    error MethodNotFound();
    error LastMethod();
    error InvalidSignature();
    error RestoreIsDisabled();
    error RestoreRequiresEoa();
    error NotIdentityEoa();
    error RestoreAlreadyDisabled();
    error NotRecoveryOperator();
    error RestoreOperatorUnset();
    error TooManyMethods();
    error SuperAlreadyEnabled();
    error NotSuperWallet();
    error InvalidThreshold();
    error SignerExists();
    error SignerNotFound();
    error ZeroAddress();
}
