// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AdvancedWalletLib} from "./AdvancedWalletLib.sol";
import {AdvancedWalletTypes} from "./AdvancedWalletTypes.sol";

/// @dev Entity M-of-N policy mixed into {Wallet}. Simple mode ignores this storage.
abstract contract AdvancedWalletMixin {
    using AdvancedWalletTypes for *;

    bool public advanced;
    uint8 public threshold;
    uint8 public entityCount;
    uint8 public vetoCount;
    uint256 public entityBitmap;
    uint256 public vetoBitmap;

    mapping(bytes32 entityId => bool exists) internal _entityExists;
    mapping(bytes32 entityId => uint8 bit) internal _entityBit;
    mapping(uint8 bit => bytes32 entityId) internal _entityAtBit;
    mapping(bytes32 entityId => uint8 keyCount) internal _entityKeyCount;
    mapping(bytes32 keyId => AdvancedWalletTypes.KeyRecord) internal _keys;

    event AdvancedEnabled(bytes32 indexed adminEntityId);
    event EntityAdded(bytes32 indexed entityId, uint8 bit);
    event EntityRemoved(bytes32 indexed entityId, uint8 bit);
    event KeyAdded(bytes32 indexed keyId, bytes32 indexed entityId, uint8 keyType);
    event KeyRemoved(bytes32 indexed keyId, bytes32 indexed entityId);
    event ThresholdUpdated(uint8 threshold);
    event VetoUpdated(bytes32 indexed entityId, bool isVeto);

    modifier onlyAdvanced() {
        if (!advanced) revert AdvancedWalletTypes.NotAdvancedMode();
        _;
    }

    modifier onlySimple() {
        if (advanced) revert AdvancedWalletTypes.AdvancedModeActive();
        _;
    }

    function getEntityBit(bytes32 entityId) external view returns (uint8) {
        return _entityBit[entityId];
    }

    function getEntityKeyCount(bytes32 entityId) external view returns (uint8) {
        return _entityKeyCount[entityId];
    }

    function getKeyRecord(bytes32 keyId) external view returns (AdvancedWalletTypes.KeyRecord memory) {
        return _keys[keyId];
    }

    function _validateAdvancedSignatures(bytes32 digest, bytes calldata signature) internal view returns (bool) {
        AdvancedWalletTypes.EntitySig[] memory sigs = AdvancedWalletLib.decodeEntitySigs(signature);
        uint256 signedBits;
        uint256 len = sigs.length;
        for (uint256 i = 0; i < len; ++i) {
            AdvancedWalletTypes.KeyRecord memory key = _keys[sigs[i].keyId];
            if (key.entityId == bytes32(0)) return false;
            if (!AdvancedWalletLib.validateKeySignature(digest, key, sigs[i].sig)) return false;
            if (!_entityExists[key.entityId]) return false;
            uint8 bit = _entityBit[key.entityId];
            uint256 mask = uint256(1) << bit;
            if (signedBits & mask != 0) return false;
            signedBits |= mask;
        }
        if (AdvancedWalletLib.popcount(signedBits) < threshold) return false;
        if (vetoBitmap != 0 && (signedBits & vetoBitmap) == 0) return false;
        return true;
    }

    function _enableAdvanced(bytes32 adminEntityId) internal onlySimple {
        if (_pendingRecoveryActive()) revert AdvancedWalletTypes.CannotEnableWithPendingRecovery();
        advanced = true;
        threshold = 1;
        _registerEntity(adminEntityId);
        _migrateSimpleOwnersToEntity(adminEntityId);
        _disableRecovery();
        emit AdvancedEnabled(adminEntityId);
    }

    function _configureMultisig(
        bytes32[] calldata removeKeyIds,
        bytes32[] calldata entityIds,
        bytes32[] calldata entityIdsForKeys,
        uint8[] calldata keyTypes,
        bytes32[] calldata qx,
        bytes32[] calldata qy,
        address[] calldata eoa,
        uint8 threshold_,
        bytes32[] calldata vetoEntityIds
    ) internal onlyAdvanced {
        uint256 removeLen = removeKeyIds.length;
        for (uint256 i = 0; i < removeLen; ++i) {
            _removeKeyInternal(removeKeyIds[i]);
        }

        uint256 entityLen = entityIds.length;
        for (uint256 i = 0; i < entityLen; ++i) {
            if (!_entityExists[entityIds[i]]) {
                _registerEntity(entityIds[i]);
            }
        }

        uint256 keyLen = keyTypes.length;
        if (keyLen != entityIdsForKeys.length || keyLen != qx.length || keyLen != qy.length || keyLen != eoa.length) {
            revert AdvancedWalletTypes.InvalidEntitySig();
        }
        for (uint256 i = 0; i < keyLen; ++i) {
            _addKeyInternal(entityIdsForKeys[i], keyTypes[i], qx[i], qy[i], eoa[i]);
        }

        _setThresholdInternal(threshold_);

        // Reset veto set, then apply requested veto entities.
        vetoBitmap = 0;
        vetoCount = 0;
        for (uint256 i = 0; i < vetoEntityIds.length; ++i) {
            _setVetoInternal(vetoEntityIds[i], true);
        }
    }

    function _addEntity(bytes32 entityId) internal onlyAdvanced {
        _registerEntity(entityId);
    }

    function _removeEntity(bytes32 entityId) internal onlyAdvanced {
        if (!_entityExists[entityId]) revert AdvancedWalletTypes.EntityNotFound();
        if (_entityKeyCount[entityId] > 0) revert AdvancedWalletTypes.EntityHasKeys();
        if (entityCount - 1 < threshold) revert AdvancedWalletTypes.InvalidThreshold();
        _removeEntityInternal(entityId);
    }

    function _addKey(bytes32 entityId, uint8 keyType, bytes32 qx, bytes32 qy, address eoa) internal onlyAdvanced {
        if (!_entityExists[entityId]) revert AdvancedWalletTypes.EntityNotFound();
        _addKeyInternal(entityId, keyType, qx, qy, eoa);
    }

    function _removeKey(bytes32 keyId) internal onlyAdvanced {
        AdvancedWalletTypes.KeyRecord memory key = _keys[keyId];
        if (key.entityId == bytes32(0)) revert AdvancedWalletTypes.KeyNotFound();
        if (_entityKeyCount[key.entityId] <= 1 && entityCount <= threshold) {
            revert AdvancedWalletTypes.InvalidThreshold();
        }
        _removeKeyInternal(keyId);
    }

    function _setThreshold(uint8 m) internal onlyAdvanced {
        _setThresholdInternal(m);
    }

    function _setVeto(bytes32 entityId, bool isVeto) internal onlyAdvanced {
        _setVetoInternal(entityId, isVeto);
    }

    function _registerEntity(bytes32 entityId) internal {
        if (entityId == bytes32(0)) revert AdvancedWalletTypes.EntityNotFound();
        if (_entityExists[entityId]) revert AdvancedWalletTypes.EntityAlreadyExists();
        if (entityCount >= AdvancedWalletTypes.MAX_ENTITIES) revert AdvancedWalletTypes.TooManyEntities();
        uint8 bit = entityCount;
        _entityExists[entityId] = true;
        _entityBit[entityId] = bit;
        _entityAtBit[bit] = entityId;
        entityBitmap |= uint256(1) << bit;
        unchecked {
            ++entityCount;
        }
        emit EntityAdded(entityId, bit);
    }

    function _removeEntityInternal(bytes32 entityId) internal {
        uint8 removedBit = _entityBit[entityId];
        uint8 lastBit = entityCount - 1;

        if ((vetoBitmap & (uint256(1) << removedBit)) != 0) {
            vetoBitmap &= ~(uint256(1) << removedBit);
            unchecked {
                --vetoCount;
            }
        }
        entityBitmap &= ~(uint256(1) << removedBit);

        if (removedBit != lastBit) {
            bytes32 lastEntityId = _entityAtBit[lastBit];
            _entityBit[lastEntityId] = removedBit;
            _entityAtBit[removedBit] = lastEntityId;
            delete _entityAtBit[lastBit];

            uint256 lastMask = uint256(1) << lastBit;
            uint256 removedMask = uint256(1) << removedBit;
            entityBitmap &= ~lastMask;
            entityBitmap |= removedMask;

            if ((vetoBitmap & lastMask) != 0) {
                vetoBitmap = (vetoBitmap & ~lastMask) | removedMask;
            }
        } else {
            delete _entityAtBit[lastBit];
        }

        delete _entityExists[entityId];
        delete _entityBit[entityId];
        delete _entityKeyCount[entityId];
        unchecked {
            --entityCount;
        }
        emit EntityRemoved(entityId, removedBit);
    }

    function _addKeyInternal(bytes32 entityId, uint8 keyType, bytes32 qx, bytes32 qy, address eoa) internal {
        if (!_entityExists[entityId]) revert AdvancedWalletTypes.EntityNotFound();
        if (keyType > AdvancedWalletTypes.KEY_EOA) revert AdvancedWalletTypes.InvalidKeyType();
        if (keyType == AdvancedWalletTypes.KEY_EOA) {
            if (eoa == address(0)) revert AdvancedWalletTypes.InvalidKeyType();
        } else if (qx == bytes32(0) && qy == bytes32(0)) {
            revert AdvancedWalletTypes.InvalidKeyType();
        }
        bytes32 keyId = AdvancedWalletLib.computeKeyId(entityId, keyType, qx, qy, eoa);
        if (_keys[keyId].entityId != bytes32(0)) revert AdvancedWalletTypes.KeyAlreadyExists();
        _keys[keyId] = AdvancedWalletTypes.KeyRecord({
            entityId: entityId,
            keyType: keyType,
            qx: qx,
            qy: qy,
            eoa: eoa
        });
        unchecked {
            ++_entityKeyCount[entityId];
        }
        emit KeyAdded(keyId, entityId, keyType);
    }

    function _removeKeyInternal(bytes32 keyId) internal {
        AdvancedWalletTypes.KeyRecord memory key = _keys[keyId];
        if (key.entityId == bytes32(0)) revert AdvancedWalletTypes.KeyNotFound();
        bytes32 entityId = key.entityId;
        delete _keys[keyId];
        unchecked {
            --_entityKeyCount[entityId];
        }
        emit KeyRemoved(keyId, entityId);
    }

    function _setThresholdInternal(uint8 m) internal {
        if (m == 0 || m > entityCount) revert AdvancedWalletTypes.InvalidThreshold();
        threshold = m;
        emit ThresholdUpdated(m);
    }

    function _setVetoInternal(bytes32 entityId, bool isVeto) internal {
        if (!_entityExists[entityId]) revert AdvancedWalletTypes.EntityNotFound();
        uint8 bit = _entityBit[entityId];
        if (_entityKeyCount[entityId] == 0) revert AdvancedWalletTypes.EntityHasKeys();
        uint256 mask = uint256(1) << bit;
        bool currentlyVeto = (vetoBitmap & mask) != 0;
        if (isVeto == currentlyVeto) return;
        if (isVeto) {
            vetoBitmap |= mask;
            unchecked {
                ++vetoCount;
            }
        } else {
            vetoBitmap &= ~mask;
            unchecked {
                --vetoCount;
            }
        }
        emit VetoUpdated(entityId, isVeto);
    }

    function _migrateSimpleOwnersToEntity(bytes32 adminEntityId) internal virtual;

    function _pendingRecoveryActive() internal view virtual returns (bool);

    function _disableRecovery() internal virtual;
}
