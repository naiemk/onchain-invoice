// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {TronReceiver} from "../TronReceiver.sol";

contract RecordingTronReceiver is TronReceiver {
    /// @custom:storage-location erc7201:onchain-invoice.storage.RecordingTronReceiver
    struct RecordingTronReceiverStorage {
        bytes32 lastInvoiceId;
        address lastToken;
        uint256 lastAmount;
        bytes lastData;
        uint256 handledCount;
        bool shouldRevert;
    }

    // keccak256(abi.encode(uint256(keccak256("onchain-invoice.storage.RecordingTronReceiver")) - 1)) & ~bytes32(uint256(0xff))
    bytes32 private constant RECORDING_TRON_RECEIVER_STORAGE_LOCATION =
        0x36b13921c6b6064dc29e5943bfa0401d7f2cf851e2d6b9b16502df12a489ec00;

    error ForcedRevert();

    function lastInvoiceId() external view returns (bytes32) {
        return _getRecordingTronReceiverStorage().lastInvoiceId;
    }

    function lastToken() external view returns (address) {
        return _getRecordingTronReceiverStorage().lastToken;
    }

    function lastAmount() external view returns (uint256) {
        return _getRecordingTronReceiverStorage().lastAmount;
    }

    function lastData() external view returns (bytes memory) {
        return _getRecordingTronReceiverStorage().lastData;
    }

    function handledCount() external view returns (uint256) {
        return _getRecordingTronReceiverStorage().handledCount;
    }

    function shouldRevert() external view returns (bool) {
        return _getRecordingTronReceiverStorage().shouldRevert;
    }

    function setShouldRevert(bool shouldRevert_) external {
        _getRecordingTronReceiverStorage().shouldRevert = shouldRevert_;
    }

    function _executeInvoice(
        bytes32 invoiceId,
        address token,
        uint256 amount,
        bytes calldata data
    ) internal override returns (bytes memory result) {
        RecordingTronReceiverStorage storage $ = _getRecordingTronReceiverStorage();
        if ($.shouldRevert) revert ForcedRevert();

        $.lastInvoiceId = invoiceId;
        $.lastToken = token;
        $.lastAmount = amount;
        $.lastData = data;

        unchecked {
            ++$.handledCount;
        }

        return data;
    }

    function _getRecordingTronReceiverStorage() private pure returns (RecordingTronReceiverStorage storage $) {
        assembly {
            $.slot := RECORDING_TRON_RECEIVER_STORAGE_LOCATION
        }
    }
}
