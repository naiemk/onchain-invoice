// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {CommerceForwarder} from "./CommerceForwarder.sol";

/// @notice Trustless invoice sweeper: CREATE2 salt binds merchant `to`, so a sweep
/// cannot send funds to any address other than the salt-bound destination (minus fee).
contract CommerceInvoiceSweeper is Ownable {
    struct SweepCall {
        address token;
        uint256 amount;
        address to;
        bytes32 invoiceId;
    }

    uint16 public constant MAX_FEE_BPS = 1_000; // 10%
    uint16 public constant BPS_DENOMINATOR = 10_000;

    address public immutable forwarderImplementation;
    address public feeRecipient;
    uint16 public feeBps;

    /// @dev Minimum platform fee per token (native = address(0)). Enforced as max(bps fee, minFee).
    mapping(address token => uint256 minFee) public minFeeByToken;

    event InvoiceCreated(bytes32 indexed invoiceId, address indexed to, address indexed forwarder);
    event InvoiceSwept(
        bytes32 indexed invoiceId,
        address indexed token,
        address indexed to,
        address forwarder,
        uint256 amount,
        uint256 fee
    );
    event FeeRecipientUpdated(address indexed feeRecipient);
    event FeeBpsUpdated(uint16 feeBps);
    event MinFeeUpdated(address indexed token, uint256 minFee);

    error InvalidTo();
    error InvalidAmount();
    error InvalidFeeRecipient();
    error FeeBpsTooHigh();
    error FeeExceedsAmount();

    constructor(address feeRecipient_, uint16 feeBps_, address initialOwner) Ownable(initialOwner) {
        if (feeRecipient_ == address(0)) revert InvalidFeeRecipient();
        if (feeBps_ > MAX_FEE_BPS) revert FeeBpsTooHigh();

        feeRecipient = feeRecipient_;
        feeBps = feeBps_;
        forwarderImplementation = address(new CommerceForwarder(address(this)));
    }

    function getInvoiceAddress(address to, bytes32 invoiceId) public view returns (address) {
        return Clones.predictDeterministicAddress(
            forwarderImplementation,
            _invoiceSalt(to, invoiceId),
            address(this)
        );
    }

    function createInvoice(address to, bytes32 invoiceId) public returns (address forwarder) {
        if (to == address(0)) revert InvalidTo();

        forwarder = getInvoiceAddress(to, invoiceId);
        if (forwarder.code.length != 0) return forwarder;

        forwarder = Clones.cloneDeterministic(forwarderImplementation, _invoiceSalt(to, invoiceId));
        emit InvoiceCreated(invoiceId, to, forwarder);
    }

    /// @notice Sweep `amount` of `token` (address(0) = native) from the invoice proxy to `to`.
    /// `to` must match the CREATE2 salt used for this invoice; otherwise a different empty
    /// address is targeted and the funded invoice is untouched.
    function sweep(
        address token,
        uint256 amount,
        address to,
        bytes32 invoiceId
    ) public returns (address forwarder, uint256 fee) {
        if (to == address(0)) revert InvalidTo();
        if (amount == 0) revert InvalidAmount();

        fee = quoteFee(token, amount);
        if (fee > amount) revert FeeExceedsAmount();

        forwarder = createInvoice(to, invoiceId);
        uint256 toMerchant = amount - fee;

        CommerceForwarder proxy = CommerceForwarder(payable(forwarder));
        if (token == address(0)) {
            if (fee != 0) proxy.sweepEth(feeRecipient, fee);
            if (toMerchant != 0) proxy.sweepEth(to, toMerchant);
        } else {
            if (fee != 0) proxy.sweepToken(token, feeRecipient, fee);
            if (toMerchant != 0) proxy.sweepToken(token, to, toMerchant);
        }

        emit InvoiceSwept(invoiceId, token, to, forwarder, amount, fee);
    }

    function bulkSweep(SweepCall[] calldata calls) external returns (uint256[] memory fees) {
        uint256 length = calls.length;
        fees = new uint256[](length);

        for (uint256 i; i < length; ) {
            SweepCall calldata call_ = calls[i];
            (, fees[i]) = sweep(call_.token, call_.amount, call_.to, call_.invoiceId);
            unchecked {
                ++i;
            }
        }
    }

    function quoteFee(address token, uint256 amount) public view returns (uint256 fee) {
        fee = (amount * uint256(feeBps)) / uint256(BPS_DENOMINATOR);
        uint256 minFee = minFeeByToken[token];
        if (fee < minFee) fee = minFee;
        if (fee > amount) fee = amount;
    }

    function setFeeRecipient(address feeRecipient_) external onlyOwner {
        if (feeRecipient_ == address(0)) revert InvalidFeeRecipient();
        feeRecipient = feeRecipient_;
        emit FeeRecipientUpdated(feeRecipient_);
    }

    function setFeeBps(uint16 feeBps_) external onlyOwner {
        if (feeBps_ > MAX_FEE_BPS) revert FeeBpsTooHigh();
        feeBps = feeBps_;
        emit FeeBpsUpdated(feeBps_);
    }

    function setMinFee(address token, uint256 minFee) external onlyOwner {
        minFeeByToken[token] = minFee;
        emit MinFeeUpdated(token, minFee);
    }

    function _invoiceSalt(address to, bytes32 invoiceId) private pure returns (bytes32) {
        return keccak256(abi.encodePacked(to, invoiceId));
    }
}
