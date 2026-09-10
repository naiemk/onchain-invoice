// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

/// @dev EIP-712 hashes for EOA owners / keys. No storage — safe for clones.
library WalletEip712 {
    bytes32 internal constant EIP712_DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes32 internal constant NAME_HASH = keccak256("Trustless Commerce Wallet");
    bytes32 internal constant VERSION_HASH = keccak256("1");
    bytes32 internal constant ADD_OWNER_TYPEHASH = keccak256("AddOwner(address wallet,address owner)");
    bytes32 internal constant ADD_KEY_TYPEHASH = keccak256("AddKey(address wallet,bytes32 entityId,address owner)");
    bytes32 internal constant USER_OP_TYPEHASH = keccak256("UserOp(bytes32 userOpHash)");

    /// @dev Sentinel `qy` for simple-wallet EOA owners (`qx` is the padded address).
    bytes32 internal constant EOA_OWNER_QY = keccak256("TrustlessCommerce.EOAOwner");

    function domainSeparator(address wallet) public view returns (bytes32) {
        return keccak256(abi.encode(EIP712_DOMAIN_TYPEHASH, NAME_HASH, VERSION_HASH, block.chainid, wallet));
    }

    function hashAddOwner(address wallet, address owner) public view returns (bytes32) {
        return MessageHashUtils.toTypedDataHash(
            domainSeparator(wallet),
            keccak256(abi.encode(ADD_OWNER_TYPEHASH, wallet, owner))
        );
    }

    function hashAddKey(address wallet, bytes32 entityId, address owner) public view returns (bytes32) {
        return MessageHashUtils.toTypedDataHash(
            domainSeparator(wallet),
            keccak256(abi.encode(ADD_KEY_TYPEHASH, wallet, entityId, owner))
        );
    }

    function hashUserOp(address wallet, bytes32 userOpHash) public view returns (bytes32) {
        return MessageHashUtils.toTypedDataHash(
            domainSeparator(wallet),
            keccak256(abi.encode(USER_OP_TYPEHASH, userOpHash))
        );
    }

    function eoaOwnerQx(address owner) public pure returns (bytes32) {
        return bytes32(uint256(uint160(owner)));
    }

    function eoaFromQx(bytes32 qx) public pure returns (address) {
        return address(uint160(uint256(qx)));
    }

    function isEoaOwnerQy(bytes32 qy) public pure returns (bool) {
        return qy == EOA_OWNER_QY;
    }

    function eoaOwnerCoords(address owner) public pure returns (bytes32 qx, bytes32 qy) {
        return (eoaOwnerQx(owner), EOA_OWNER_QY);
    }

    function recover(bytes32 digest, bytes memory signature) public pure returns (address) {
        (address recovered, ECDSA.RecoverError err, ) = ECDSA.tryRecover(digest, signature);
        if (err != ECDSA.RecoverError.NoError) return address(0);
        return recovered;
    }

    function recoverAddOwner(address wallet, address owner, bytes memory signature) public view returns (bool) {
        return recover(hashAddOwner(wallet, owner), signature) == owner;
    }

    function recoverAddKey(
        address wallet,
        bytes32 entityId,
        address owner,
        bytes memory signature
    ) public view returns (bool) {
        return recover(hashAddKey(wallet, entityId, owner), signature) == owner;
    }

    function recoverUserOp(
        address wallet,
        bytes32 userOpHash,
        address owner,
        bytes memory signature
    ) public view returns (bool) {
        return recover(hashUserOp(wallet, userOpHash), signature) == owner;
    }
}
