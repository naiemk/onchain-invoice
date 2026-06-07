// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ReceiverProxy} from "../proxy/ReceiverProxy.sol";
import {TronBasicReceiver} from "./TronBasicReceiver.sol";
import {TronInvoiceSweeper} from "./TronInvoiceSweeper.sol";

contract TronSystemDeployer {
    event SystemDeployed(address indexed receiver, address indexed sweeper, address indexed forwarderImplementation);

    function deploy(address owner) external returns (address receiver, address sweeper, address forwarderImplementation) {
        address receiverImplementation = address(new TronBasicReceiver());
        ReceiverProxy receiverProxy = new ReceiverProxy(
            receiverImplementation,
            abi.encodeWithSelector(bytes4(keccak256("initialize(address)")), owner)
        );

        receiver = address(receiverProxy);

        TronInvoiceSweeper sweeper_ = new TronInvoiceSweeper(receiver);

        sweeper = address(sweeper_);
        forwarderImplementation = sweeper_.forwarderImplementation();

        emit SystemDeployed(receiver, sweeper, forwarderImplementation);
    }
}
