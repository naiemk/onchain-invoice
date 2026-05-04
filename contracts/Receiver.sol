// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {IReceiver} from "./interfaces/IReceiver.sol";

abstract contract Receiver is Initializable, OwnableUpgradeable, UUPSUpgradeable, IReceiver {
    address internal constant NATIVE_TOKEN = address(0);

    struct InvoicePayment {
        address token;
        uint256 amount;
        address forwarder;
        bool paid;
    }

    /// @custom:storage-location erc7201:onchain-invoice.storage.Receiver
    struct ReceiverStorage {
        mapping(bytes32 invoiceId => InvoicePayment payment) invoicePayments;
    }

    // keccak256(abi.encode(uint256(keccak256("onchain-invoice.storage.Receiver")) - 1)) & ~bytes32(uint256(0xff))
    bytes32 private constant RECEIVER_STORAGE_LOCATION =
        0xd74a19038c65953ef17c747ee44dc531286d28b21b2dff24464e3d1f28bf8500;

    event InvoicePaid(
        bytes32 indexed invoiceId,
        address indexed token,
        address indexed forwarder,
        uint256 amount,
        bytes data
    );
    event InvoiceExecuted(bytes32 indexed invoiceId, address indexed token, uint256 amount, bytes result);

    error InvalidInvoiceData();
    error InvoiceAlreadyPaid();
    error NoPayment();

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address initialOwner) public virtual initializer {
        __Ownable_init(initialOwner);
    }

    function invoicePayment(bytes32 invoiceId) external view returns (InvoicePayment memory) {
        return _getReceiverStorage().invoicePayments[invoiceId];
    }

    function receiveEthInvoice(bytes32 invoiceId, bytes calldata data) external payable {
        uint256 amount = msg.value;
        if (amount == 0) revert NoPayment();

        _handleInvoice(invoiceId, NATIVE_TOKEN, msg.sender, amount, data);
    }

    function receiveTokenInvoice(
        address token,
        bytes32 invoiceId,
        uint256 amount,
        bytes calldata data
    ) external {
        if (amount == 0) revert NoPayment();

        _handleInvoice(invoiceId, token, msg.sender, amount, data);
    }

    function executeInvoice(
        bytes32 invoiceId,
        address token,
        uint256 amount,
        bytes calldata data
    ) external onlyOwner returns (bytes memory result) {
        _verifyInvoiceData(invoiceId, data);
        result = _executeInvoice(invoiceId, token, amount, data);
        emit InvoiceExecuted(invoiceId, token, amount, result);
    }

    function _handleInvoice(
        bytes32 invoiceId,
        address token,
        address forwarder,
        uint256 amount,
        bytes calldata data
    ) internal {
        _verifyInvoiceData(invoiceId, data);
        _assignPayment(invoiceId, token, forwarder, amount);
        emit InvoicePaid(invoiceId, token, forwarder, amount, data);

        bytes memory result = _executeInvoice(invoiceId, token, amount, data);
        emit InvoiceExecuted(invoiceId, token, amount, result);
    }

    function _executeInvoice(
        bytes32 invoiceId,
        address token,
        uint256 amount,
        bytes calldata data
    ) internal virtual returns (bytes memory result);

    function _verifyInvoiceData(bytes32 invoiceId, bytes calldata data) internal pure {
        if (keccak256(data) != invoiceId) revert InvalidInvoiceData();
    }

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}

    function _assignPayment(bytes32 invoiceId, address token, address forwarder, uint256 amount) internal {
        ReceiverStorage storage $ = _getReceiverStorage();
        InvoicePayment storage payment = $.invoicePayments[invoiceId];
        if (payment.paid) revert InvoiceAlreadyPaid();

        payment.token = token;
        payment.amount = amount;
        payment.forwarder = forwarder;
        payment.paid = true;
    }

    function _getReceiverStorage() private pure returns (ReceiverStorage storage $) {
        assembly {
            $.slot := RECEIVER_STORAGE_LOCATION
        }
    }
}
