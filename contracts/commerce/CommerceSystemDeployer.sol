// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {CommerceInvoiceSweeper} from "./CommerceInvoiceSweeper.sol";

contract CommerceSystemDeployer {
    event CommerceSystemDeployed(
        address indexed sweeper,
        address indexed feeRecipient,
        address forwarderImplementation,
        uint16 feeBps
    );

    function deploy(
        address feeRecipient,
        uint16 feeBps,
        address owner
    ) external returns (CommerceInvoiceSweeper sweeper) {
        sweeper = new CommerceInvoiceSweeper(feeRecipient, feeBps, owner);
        emit CommerceSystemDeployed(
            address(sweeper),
            feeRecipient,
            sweeper.forwarderImplementation(),
            feeBps
        );
    }
}
