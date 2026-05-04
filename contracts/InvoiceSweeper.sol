// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {Forwarder} from "./Forwarder.sol";
import {IForwarder} from "./interfaces/IForwarder.sol";

contract InvoiceSweeper {
    struct SweepCall {
        bytes32 invoiceId;
        address token;
        bytes data;
    }

    address public immutable receiver;
    address public immutable forwarderImplementation;

    event InvoiceCreated(bytes32 indexed invoiceId, address indexed forwarder);
    event InvoiceSwept(bytes32 indexed invoiceId, address indexed token, address indexed forwarder, uint256 amount);

    error InvalidReceiver();

    constructor(address receiver_) {
        if (receiver_ == address(0)) revert InvalidReceiver();

        receiver = receiver_;
        forwarderImplementation = address(new Forwarder(receiver_));
    }

    function getInvoiceAddress(bytes32 invoiceId) public view returns (address) {
        return Clones.predictDeterministicAddress(
            forwarderImplementation,
            _invoiceSalt(invoiceId),
            address(this)
        );
    }

    function createInvoice(bytes32 invoiceId) public returns (address forwarder) {
        forwarder = getInvoiceAddress(invoiceId);
        if (forwarder.code.length != 0) return forwarder;

        forwarder = Clones.cloneDeterministic(forwarderImplementation, _invoiceSalt(invoiceId));
        emit InvoiceCreated(invoiceId, forwarder);
    }

    function sweepEth(bytes32 invoiceId, bytes calldata data) public returns (address forwarder, uint256 amount) {
        forwarder = createInvoice(invoiceId);
        amount = IForwarder(forwarder).sweepEth(invoiceId, data);

        emit InvoiceSwept(invoiceId, address(0), forwarder, amount);
    }

    function sweepToken(
        bytes32 invoiceId,
        address token,
        bytes calldata data
    ) public returns (address forwarder, uint256 amount) {
        forwarder = createInvoice(invoiceId);
        amount = IForwarder(forwarder).sweepToken(token, invoiceId, data);

        emit InvoiceSwept(invoiceId, token, forwarder, amount);
    }

    function bulkExecute(SweepCall[] calldata calls) external returns (uint256[] memory amounts) {
        uint256 length = calls.length;
        amounts = new uint256[](length);

        for (uint256 i; i < length;) {
            SweepCall calldata call_ = calls[i];
            (, amounts[i]) = call_.token == address(0)
                ? sweepEth(call_.invoiceId, call_.data)
                : sweepToken(call_.invoiceId, call_.token, call_.data);

            unchecked {
                ++i;
            }
        }
    }

    function _invoiceSalt(bytes32 invoiceId) private pure returns (bytes32) {
        return keccak256(abi.encodePacked(invoiceId));
    }
}
