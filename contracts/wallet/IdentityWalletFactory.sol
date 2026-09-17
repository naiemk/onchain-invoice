// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IdentityWallet} from "./IdentityWallet.sol";
import {IdentityStore} from "./IdentityStore.sol";
import {IdentityTypes} from "./IdentityTypes.sol";
import {IdentityErrors} from "./IdentityErrors.sol";

/// @notice CREATE2 clones of IdentityWallet pointing at an IdentityStore identity.
contract IdentityWalletFactory is Ownable, IdentityErrors {
    address public immutable walletImplementation;
    IdentityStore public immutable store;

    event WalletCreated(address indexed wallet, bytes32 indexed salt, bytes32 indexed identityId);

    constructor(address walletImplementation_, address store_, address initialOwner) Ownable(initialOwner) {
        if (walletImplementation_ == address(0) || store_ == address(0)) revert ZeroAddress();
        walletImplementation = walletImplementation_;
        store = IdentityStore(store_);
    }

    function predictAddress(bytes32 salt) public view returns (address) {
        return Clones.predictDeterministicAddress(walletImplementation, salt, address(this));
    }

    function createAccount(bytes32 identityId, bytes32 salt) external returns (address wallet) {
        if (!store.identityExists(identityId)) revert IdentityNotFound();
        wallet = predictAddress(salt);
        if (wallet.code.length == 0) {
            wallet = Clones.cloneDeterministic(walletImplementation, salt);
            IdentityWallet(payable(wallet)).initialize(address(store), identityId);
        }
        emit WalletCreated(wallet, salt, identityId);
    }
}
