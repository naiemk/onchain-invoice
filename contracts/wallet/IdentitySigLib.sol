// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {WebAuthn} from "@openzeppelin/contracts/utils/cryptography/WebAuthn.sol";
import {IdentityTypes} from "./IdentityTypes.sol";

/// @dev WebAuthn P-256 check for IdentityStore blobs (memory-encoded auth, not tx calldata).
library IdentitySigLib {
    function verifyWebAuthn(bytes32 message, bytes memory sig, bytes32 qx, bytes32 qy) internal view returns (bool) {
        if (qx == bytes32(0) && qy == bytes32(0)) return false;
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
        return WebAuthn.verify(abi.encodePacked(message), auth, qx, qy);
    }

    function computeMethodId(
        bytes32 identityId,
        uint8 kind,
        bytes32 qx,
        bytes32 qy,
        address eoa
    ) internal pure returns (bytes32) {
        return keccak256(abi.encode(identityId, kind, qx, qy, eoa));
    }

    function decodeSuperBlobs(bytes calldata blob) internal pure returns (bytes[] memory inner) {
        if (blob.length < 4 || bytes4(blob[:4]) != IdentityTypes.SUPER_MAGIC) {
            revert IdentityTypes.InvalidSignature();
        }
        return abi.decode(blob[4:], (bytes[]));
    }
}
