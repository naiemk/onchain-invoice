// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import {WebAuthn} from "@openzeppelin/contracts/utils/cryptography/WebAuthn.sol";
import {AdvancedWalletTypes} from "./AdvancedWalletTypes.sol";

/// @dev Hot-path helpers for advanced wallet signature validation.
library AdvancedWalletLib {
    using AdvancedWalletTypes for AdvancedWalletTypes.KeyRecord;

    function computeKeyId(
        bytes32 entityId,
        uint8 keyType,
        bytes32 qx,
        bytes32 qy,
        address eoa
    ) internal pure returns (bytes32) {
        return keccak256(abi.encode(entityId, keyType, qx, qy, eoa));
    }

    function popcount(uint256 x) internal pure returns (uint8 count) {
        while (x != 0) {
            count += uint8(x & 1);
            x >>= 1;
        }
    }

    function decodeEntitySigs(bytes calldata signature) internal pure returns (AdvancedWalletTypes.EntitySig[] memory sigs) {
        if (signature.length < 4) revert AdvancedWalletTypes.InvalidEntitySig();
        if (bytes4(signature[:4]) != AdvancedWalletTypes.ADVANCED_SIG_MAGIC) {
            revert AdvancedWalletTypes.InvalidEntitySig();
        }
        return abi.decode(signature[4:], (AdvancedWalletTypes.EntitySig[]));
    }

    function validateKeySignature(
        bytes32 digest,
        AdvancedWalletTypes.KeyRecord memory key,
        bytes memory sig
    ) internal view returns (bool) {
        if (key.keyType == AdvancedWalletTypes.KEY_EOA) {
            if (key.eoa == address(0)) return false;
            bytes32 ethSigned = MessageHashUtils.toEthSignedMessageHash(abi.encodePacked(digest));
            return ECDSA.recover(ethSigned, sig) == key.eoa;
        }
        if (key.keyType == AdvancedWalletTypes.KEY_WEBAUTHN || key.keyType == AdvancedWalletTypes.KEY_YUBIKEY) {
            if (key.qx == bytes32(0) && key.qy == bytes32(0)) return false;
            bytes calldata sigCalldata = _asCalldata(sig);
            (bool decodeSuccess, WebAuthn.WebAuthnAuth calldata auth) = WebAuthn.tryDecodeAuth(sigCalldata);
            if (!decodeSuccess) return false;
            return WebAuthn.verify(abi.encodePacked(digest), auth, key.qx, key.qy);
        }
        return false;
    }

    function _asCalldata(bytes memory data) private pure returns (bytes calldata result) {
        assembly ("memory-safe") {
            result.offset := add(data, 32)
            result.length := mload(data)
        }
    }
}
