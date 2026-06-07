// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ReceiverProxy} from "../../proxy/ReceiverProxy.sol";
import {TronInvoiceSweeper} from "../TronInvoiceSweeper.sol";
import {TronFastSwapReceiver} from "./TronFastSwapReceiver.sol";

/**
 * @notice One-shot deployer for the TRON FastSwap stack: a `TronFastSwapReceiver`
 *         behind a `ReceiverProxy`, plus a `TronInvoiceSweeper` bound to it. Mirrors
 *         the EVM FastSwap deploy flow used in `fastSwapDemo/deploy.ts`.
 */
contract TronFastSwapDeployer {
    event FastSwapDeployed(address indexed receiver, address indexed sweeper, address indexed forwarderImplementation);

    function deploy(address owner) external returns (address receiver, address sweeper, address forwarderImplementation) {
        address receiverImplementation = address(new TronFastSwapReceiver());
        ReceiverProxy receiverProxy = new ReceiverProxy(
            receiverImplementation,
            abi.encodeWithSelector(bytes4(keccak256("initialize(address)")), owner)
        );

        receiver = address(receiverProxy);

        TronInvoiceSweeper sweeper_ = new TronInvoiceSweeper(receiver);

        sweeper = address(sweeper_);
        forwarderImplementation = sweeper_.forwarderImplementation();

        emit FastSwapDeployed(receiver, sweeper, forwarderImplementation);
    }
}
