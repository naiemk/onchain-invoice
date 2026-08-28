// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {ITrc20} from "./interfaces/ITrc20.sol";
import {ITronReceiver} from "./interfaces/ITronReceiver.sol";

abstract contract TronReceiver is Initializable, OwnableUpgradeable, UUPSUpgradeable, ITronReceiver {
    address internal constant NATIVE_TOKEN = address(0);

    struct InvoicePayment {
        address token;
        uint256 amount;
        address forwarder;
        bool paid;
    }

    /// @custom:storage-location erc7201:onchain-invoice.storage.TronReceiver
    struct TronReceiverStorage {
        mapping(bytes32 invoiceId => InvoicePayment payment) invoicePayments;
    }

    // keccak256(abi.encode(uint256(keccak256("onchain-invoice.storage.TronReceiver")) - 1)) & ~bytes32(uint256(0xff))
    bytes32 private constant TRON_RECEIVER_STORAGE_LOCATION =
        0xc797aa9660b6dac35cefbef5c9b1e14ac5bcbb4c3328f45c8a5dfde5edd5ed00;

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
        return _getTronReceiverStorage().invoicePayments[invoiceId];
    }

    function receiveTrxInvoice(bytes32 invoiceId, bytes calldata data) external payable {
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

        uint256 before = ITrc20(token).balanceOf(address(this));
        _safeTransferFrom(token, msg.sender, address(this), amount);
        uint256 received = ITrc20(token).balanceOf(address(this)) - before;
        if (received == 0) revert NoPayment();

        _handleInvoice(invoiceId, token, msg.sender, received, data);
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

    function _authorizeUpgrade(address newImplementation) internal virtual override onlyOwner {}

    function _assignPayment(bytes32 invoiceId, address token, address forwarder, uint256 amount) internal {
        TronReceiverStorage storage $ = _getTronReceiverStorage();
        InvoicePayment storage payment = $.invoicePayments[invoiceId];
        if (payment.paid) revert InvoiceAlreadyPaid();

        payment.token = token;
        payment.amount = amount;
        payment.forwarder = forwarder;
        payment.paid = true;
    }

    function _getTronReceiverStorage() private pure returns (TronReceiverStorage storage $) {
        assembly {
            $.slot := TRON_RECEIVER_STORAGE_LOCATION
        }
    }

    function _safeTransferFrom(address token, address from, address to, uint256 amount) private {
        (bool ok, bytes memory result) =
            token.call(abi.encodeCall(ITrc20.transferFrom, (from, to, amount)));
        if (!ok || (result.length != 0 && !abi.decode(result, (bool)))) revert NoPayment();
    }
}
