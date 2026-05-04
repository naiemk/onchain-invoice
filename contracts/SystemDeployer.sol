// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {BasicReceiver} from "./BasicReceiver.sol";
import {InvoiceSweeper} from "./InvoiceSweeper.sol";
import {ReceiverProxy} from "./proxy/ReceiverProxy.sol";

contract SystemDeployer {
    event SystemDeployed(address indexed receiver, address indexed sweeper, address indexed forwarderImplementation);

    function deploy(address owner) external returns (address receiver, address sweeper, address forwarderImplementation) {
        address receiverImplementation = address(new BasicReceiver());
        ReceiverProxy receiverProxy = new ReceiverProxy(
            receiverImplementation,
            abi.encodeWithSelector(bytes4(keccak256("initialize(address)")), owner)
        );

        receiver = address(receiverProxy);

        InvoiceSweeper sweeper_ = new InvoiceSweeper(receiver);

        sweeper = address(sweeper_);
        forwarderImplementation = sweeper_.forwarderImplementation();

        emit SystemDeployed(receiver, sweeper, forwarderImplementation);
    }
}
