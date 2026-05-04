// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Receiver} from "../Receiver.sol";

contract RecordingReceiver is Receiver {
    /// @custom:storage-location erc7201:onchain-invoice.storage.RecordingReceiver
    struct RecordingReceiverStorage {
        bytes32 lastInvoiceId;
        address lastToken;
        uint256 lastAmount;
        bytes lastData;
        uint256 handledCount;
        bool shouldRevert;
    }

    // keccak256(abi.encode(uint256(keccak256("onchain-invoice.storage.RecordingReceiver")) - 1)) & ~bytes32(uint256(0xff))
    bytes32 private constant RECORDING_RECEIVER_STORAGE_LOCATION =
        0xdb90c3475422dd470a6667acd2af7e69d38e29eb5699bd54afe027df4598db00;

    error ForcedRevert();

    function lastInvoiceId() external view returns (bytes32) {
        return _getRecordingReceiverStorage().lastInvoiceId;
    }

    function lastToken() external view returns (address) {
        return _getRecordingReceiverStorage().lastToken;
    }

    function lastAmount() external view returns (uint256) {
        return _getRecordingReceiverStorage().lastAmount;
    }

    function lastData() external view returns (bytes memory) {
        return _getRecordingReceiverStorage().lastData;
    }

    function handledCount() external view returns (uint256) {
        return _getRecordingReceiverStorage().handledCount;
    }

    function shouldRevert() external view returns (bool) {
        return _getRecordingReceiverStorage().shouldRevert;
    }

    function setShouldRevert(bool shouldRevert_) external {
        _getRecordingReceiverStorage().shouldRevert = shouldRevert_;
    }

    function _executeInvoice(
        bytes32 invoiceId,
        address token,
        uint256 amount,
        bytes calldata data
    ) internal override returns (bytes memory result) {
        RecordingReceiverStorage storage $ = _getRecordingReceiverStorage();
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

    function _getRecordingReceiverStorage() private pure returns (RecordingReceiverStorage storage $) {
        assembly {
            $.slot := RECORDING_RECEIVER_STORAGE_LOCATION
        }
    }
}
