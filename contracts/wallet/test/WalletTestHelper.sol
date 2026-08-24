// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Wallet} from "../Wallet.sol";

/// @dev Test-only helpers — not deployed to production networks.
contract WalletTestHelper is Wallet {
    function exposedAddOwner(bytes32 qx, bytes32 qy) external {
        _addOwnerKey(qx, qy);
    }

    function exposedRemoveOwner(bytes32 qx, bytes32 qy) external {
        _removeOwnerKey(qx, qy);
    }
}
