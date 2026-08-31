// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @dev Shared types for advanced (entity M-of-N) wallet policy.
library AdvancedWalletTypes {
    uint8 internal constant KEY_WEBAUTHN = 0;
    uint8 internal constant KEY_YUBIKEY = 1;
    uint8 internal constant KEY_EOA = 2;

    uint8 internal constant MAX_ENTITIES = 255;
    bytes4 internal constant ADVANCED_SIG_MAGIC = 0x41574431; // "AWD1"

    struct KeyRecord {
        bytes32 entityId;
        uint8 keyType;
        bytes32 qx;
        bytes32 qy;
        address eoa;
    }

    struct EntitySig {
        bytes32 keyId;
        bytes sig;
    }

    error AdvancedModeActive();
    error NotAdvancedMode();
    error EntityAlreadyExists();
    error EntityNotFound();
    error KeyAlreadyExists();
    error KeyNotFound();
    error InvalidThreshold();
    error InvalidKeyType();
    error InvalidEntitySig();
    error DuplicateEntityVote();
    error InsufficientEntityVotes();
    error VetoRequired();
    error EntityHasKeys();
    error RecoveryDisabledInAdvanced();
    error CannotEnableWithPendingRecovery();
    error TooManyEntities();
}
