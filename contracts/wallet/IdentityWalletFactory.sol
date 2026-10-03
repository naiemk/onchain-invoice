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

    /// @dev Same preimage as `deriveIdentityWalletSalt` off chain.
    function walletSalt(bytes32 identityId, uint256 index) public pure returns (bytes32) {
        return keccak256(abi.encode("TC-IDENTITY-WALLET-V1", identityId, index));
    }

    function predictAddress(bytes32 salt) public view returns (address) {
        return Clones.predictDeterministicAddress(walletImplementation, salt, address(this));
    }

    /// @notice Deploy the clone for `identityId` at `index`, or return it when that identity already owns it.
    function createAccount(bytes32 identityId, uint256 index) external returns (address wallet) {
        if (!store.identityExists(identityId)) revert IdentityNotFound();
        bytes32 salt = walletSalt(identityId, index);
        wallet = predictAddress(salt);
        if (wallet.code.length == 0) {
            wallet = Clones.cloneDeterministic(walletImplementation, salt);
            IdentityWallet(payable(wallet)).initialize(address(store), identityId);
            emit WalletCreated(wallet, salt, identityId);
            return wallet;
        }
        if (IdentityWallet(payable(wallet)).identityId() != identityId) revert IdentityMismatch();
    }
}
