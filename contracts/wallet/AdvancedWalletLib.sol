// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {WebAuthn} from "@openzeppelin/contracts/utils/cryptography/WebAuthn.sol";
import {AdvancedWalletTypes} from "./AdvancedWalletTypes.sol";
import {WalletEip712} from "./WalletEip712.sol";

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
            return WalletEip712.recoverUserOp(address(this), digest, key.eoa, sig);
        }
        if (key.keyType == AdvancedWalletTypes.KEY_WEBAUTHN || key.keyType == AdvancedWalletTypes.KEY_YUBIKEY) {
            if (key.qx == bytes32(0) && key.qy == bytes32(0)) return false;
            // `sig` is already a memory copy from AWD1 decode. Casting it to
            // calldata and calling tryDecodeAuth reads the *transaction*
            // calldata at that memory address — AA24 for a valid passkey.
            if (sig.length < 0xC0) return false;
            (
                bytes32 r,
                bytes32 s,
                uint256 challengeIndex,
                uint256 typeIndex,
                bytes memory authenticatorData,
                string memory clientDataJSON
            ) = abi.decode(sig, (bytes32, bytes32, uint256, uint256, bytes, string));
            WebAuthn.WebAuthnAuth memory auth = WebAuthn.WebAuthnAuth({
                r: r,
                s: s,
                challengeIndex: challengeIndex,
                typeIndex: typeIndex,
                authenticatorData: authenticatorData,
                clientDataJSON: clientDataJSON
            });
            return WebAuthn.verify(abi.encodePacked(digest), auth, key.qx, key.qy);
        }
        return false;
    }
}
