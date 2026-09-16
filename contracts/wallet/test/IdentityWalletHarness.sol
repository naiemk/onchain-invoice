// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IdentityWallet} from "../IdentityWallet.sol";

/// @dev Test-only helpers — not deployed to production networks.
contract IdentityWalletHarness is IdentityWallet {
    function exposedValidate(bytes32 digest, bytes calldata signature) external view returns (bool) {
        return _rawSignatureValidation(digest, signature);
    }
}
