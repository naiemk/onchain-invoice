// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Wallet} from "../Wallet.sol";
import {AdvancedWalletTypes} from "../AdvancedWalletTypes.sol";

/// @dev Test-only helpers — not deployed to production networks.
contract WalletAdvancedTestHelper is Wallet {
    function exposedAddOwner(bytes32 qx, bytes32 qy) external {
        _addOwnerKey(qx, qy);
    }

    function exposedEnableAdvanced(bytes32 adminEntityId) external {
        _enableAdvanced(adminEntityId);
    }

    function exposedAddEntity(bytes32 entityId) external {
        _addEntity(entityId);
    }

    function exposedAddKey(bytes32 entityId, uint8 keyType, bytes32 qx, bytes32 qy, address eoa) external {
        _addKey(entityId, keyType, qx, qy, eoa);
    }

    function exposedSetThreshold(uint8 m) external {
        _setThreshold(m);
    }

    function exposedSetVeto(bytes32 entityId, bool isVeto) external {
        _setVeto(entityId, isVeto);
    }

    function exposedValidateAdvanced(bytes32 digest, bytes calldata signature) external view returns (bool) {
        return _validateAdvancedSignatures(digest, signature);
    }

    function exposedKeyId(
        bytes32 entityId,
        uint8 keyType,
        bytes32 qx,
        bytes32 qy,
        address eoa
    ) external pure returns (bytes32) {
        return keccak256(abi.encode(entityId, keyType, qx, qy, eoa));
    }
}
