// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @dev Shared constants for IdentityStore method kinds and signature blobs.
library IdentityTypes {
    uint8 internal constant METHOD_WEBAUTHN = 0;
    uint8 internal constant METHOD_YUBIKEY = 1;
    uint8 internal constant METHOD_EOA = 2;

    uint8 internal constant MAX_METHODS = 32;

    /// @dev Identity method signature ("IDS1").
    bytes4 internal constant SIG_MAGIC = 0x49445331;
    /// @dev Super-wallet multi-identity signature ("SUP1").
    bytes4 internal constant SUPER_MAGIC = 0x53555031;

    struct Method {
        bytes32 identityId;
        uint8 kind;
        bytes32 qx;
        bytes32 qy;
        address eoa;
        bool exists;
    }

    struct Identity {
        bool exists;
        bool restoreEnabled;
        uint8 methodCount;
        uint8 eoaCount;
        uint8 webauthnCount;
        uint8 yubikeyCount;
    }

    error IdentityExists();
    error IdentityNotFound();
    error InvalidIdentity();
    error InvalidMethodKind();
    error InvalidMethod();
    error MethodExists();
    error MethodNotFound();
    error LastMethod();
    error FirstMethodMustBeWebAuthn();
    error InvalidSignature();
    error RestoreDisabled();
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
    error IdentityRequired();
    error ZeroAddress();
}
