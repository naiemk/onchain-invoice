// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IdentityStore} from "./IdentityStore.sol";
import {IdentityErrors} from "./IdentityErrors.sol";

/// @notice Delayed break-glass for IdentityStore owner actions.
/// Production store owner is this contract. A proposer (multisig) schedules;
/// anyone may execute after `delay`.
contract IdentityStoreTimelock is IdentityErrors {
    IdentityStore public immutable store;
    uint64 public immutable delay;
    address public proposer;

    address public pendingOperator;
    uint64 public operatorReadyAt;
    bool public operatorPending;

    uint64 public pendingDelay;
    uint64 public delayReadyAt;
    bool public delayPending;

    event ProposerSet(address indexed proposer);
    event RecoveryOperatorScheduled(address indexed next, uint64 readyAt);
    event RestoreDelayScheduled(uint64 next, uint64 readyAt);
    event RecoveryOperatorExecuted(address indexed next);
    event RestoreDelayExecuted(uint64 next);

    constructor(IdentityStore store_, address proposer_, uint64 delay_) {
        if (address(store_) == address(0) || proposer_ == address(0)) revert ZeroAddress();
        if (delay_ == 0) revert InvalidThreshold();
        store = store_;
        proposer = proposer_;
        delay = delay_;
    }

    function setProposer(address next) external {
        if (msg.sender != proposer) revert NotProposer();
        if (next == address(0)) revert ZeroAddress();
        proposer = next;
        emit ProposerSet(next);
    }

    function scheduleRecoveryOperator(address next) external {
        if (msg.sender != proposer) revert NotProposer();
        pendingOperator = next;
        operatorReadyAt = uint64(block.timestamp) + delay;
        operatorPending = true;
        emit RecoveryOperatorScheduled(next, operatorReadyAt);
    }

    function executeRecoveryOperator(address next) external {
        if (!operatorPending || pendingOperator != next) revert TimelockNotScheduled();
        if (block.timestamp < operatorReadyAt) revert TimelockNotReady();
        operatorPending = false;
        store.setRecoveryOperator(next);
        emit RecoveryOperatorExecuted(next);
    }

    function scheduleRestoreDelay(uint64 next) external {
        if (msg.sender != proposer) revert NotProposer();
        pendingDelay = next;
        delayReadyAt = uint64(block.timestamp) + delay;
        delayPending = true;
        emit RestoreDelayScheduled(next, delayReadyAt);
    }

    function executeRestoreDelay(uint64 next) external {
        if (!delayPending || pendingDelay != next) revert TimelockNotScheduled();
        if (block.timestamp < delayReadyAt) revert TimelockNotReady();
        delayPending = false;
        store.setRestoreDelay(next);
        emit RestoreDelayExecuted(next);
    }
}
