// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {TronReceiver} from "./TronReceiver.sol";

contract TronBasicReceiver is TronReceiver {
    function _executeInvoice(
        bytes32,
        address,
        uint256,
        bytes calldata
    ) internal pure override returns (bytes memory result) {
        return "";
    }
}
