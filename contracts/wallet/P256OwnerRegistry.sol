// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {WebAuthn} from "@openzeppelin/contracts/utils/cryptography/WebAuthn.sol";

/// @dev WebAuthn P256 owner set with 1-of-N validation for signatures.
abstract contract P256OwnerRegistry {
    struct OwnerKey {
        bytes32 qx;
        bytes32 qy;
    }

    mapping(bytes32 ownerId => bool) internal _owners;
    bytes32[] internal _ownerIds;
    uint256 internal _ownerCount;

    event OwnerAdded(bytes32 indexed ownerId, bytes32 qx, bytes32 qy);
    event OwnerRemoved(bytes32 indexed ownerId);

    error OwnerAlreadyExists();
    error OwnerNotFound();
    error LastOwner();
    error InvalidOwnerKey();

    function ownerCount() public view returns (uint256) {
        return _ownerCount;
    }

    function ownerId(bytes32 qx, bytes32 qy) public pure returns (bytes32) {
        return keccak256(abi.encodePacked(qx, qy));
    }

    function isOwner(bytes32 qx, bytes32 qy) public view returns (bool) {
        return _owners[ownerId(qx, qy)];
    }

    function ownerAt(uint256 index) public view returns (bytes32 qx, bytes32 qy) {
        bytes32 id = _ownerIds[index];
        // ids stored separately in concrete contract via _ownerKeys mapping
        return _ownerKeyById(id);
    }

    function _ownerKeyById(bytes32 id) internal view virtual returns (bytes32 qx, bytes32 qy);

    function _addOwnerKey(bytes32 qx, bytes32 qy) internal {
        if (qx == bytes32(0) && qy == bytes32(0)) revert InvalidOwnerKey();
        bytes32 id = ownerId(qx, qy);
        if (_owners[id]) revert OwnerAlreadyExists();
        _owners[id] = true;
        _ownerIds.push(id);
        _storeOwnerKey(id, qx, qy);
        _ownerCount++;
        emit OwnerAdded(id, qx, qy);
    }

    function _removeOwnerKey(bytes32 qx, bytes32 qy) internal {
        bytes32 id = ownerId(qx, qy);
        if (!_owners[id]) revert OwnerNotFound();
        if (_ownerCount <= 1) revert LastOwner();
        _owners[id] = false;
        _ownerCount--;
        _removeOwnerId(id);
        emit OwnerRemoved(id);
    }

    function _storeOwnerKey(bytes32 id, bytes32 qx, bytes32 qy) internal virtual;

    function _removeOwnerId(bytes32 id) internal virtual;

    function _validateAnyOwner(bytes32 digest, bytes calldata signature) internal view returns (bool) {
        for (uint256 i = 0; i < _ownerIds.length; i++) {
            bytes32 id = _ownerIds[i];
            if (!_owners[id]) continue;
            (bytes32 qx, bytes32 qy) = _ownerKeyById(id);
            if (_validateWebAuthn(digest, signature, qx, qy)) return true;
        }
        return false;
    }

    function _validateWebAuthn(
        bytes32 digest,
        bytes calldata signature,
        bytes32 qx,
        bytes32 qy
    ) internal view returns (bool) {
        (bool decodeSuccess, WebAuthn.WebAuthnAuth calldata auth) = WebAuthn.tryDecodeAuth(signature);
        if (!decodeSuccess) return false;
        return WebAuthn.verify(abi.encodePacked(digest), auth, qx, qy);
    }
}
