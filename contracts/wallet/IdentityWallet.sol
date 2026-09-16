// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Account} from "@openzeppelin/contracts/account/Account.sol";
import {ERC7821} from "@openzeppelin/contracts/account/extensions/draft-ERC7821.sol";
import {Initializable} from "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import {IdentityStore} from "./IdentityStore.sol";
import {IdentitySigLib} from "./IdentitySigLib.sol";
import {IdentityTypes} from "./IdentityTypes.sol";
import {IdentityErrors} from "./IdentityErrors.sol";

/// @notice Wallet that authenticates via IdentityStore. Super mode is a list of identityIds.
contract IdentityWallet is Account, ERC7821, Initializable, IdentityErrors {
    IdentityStore public store;
    bytes32 public identityId;
    bool public superWallet;
    uint8 public threshold;
    uint8 public signerCount;
    mapping(bytes32 identityId => bool) public isSigner;
    mapping(uint8 index => bytes32 identityId) public signerAt;

    event SuperEnabled(uint8 threshold);
    event SignerAdded(bytes32 indexed identityId);
    event SignerRemoved(bytes32 indexed identityId);
    event ThresholdUpdated(uint8 threshold);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address store_, bytes32 identityId_) external initializer {
        if (store_ == address(0)) revert ZeroAddress();
        if (identityId_ == bytes32(0)) revert InvalidIdentity();
        store = IdentityStore(store_);
        if (!store.identityExists(identityId_)) revert IdentityNotFound();
        identityId = identityId_;
    }

    function enableSuper(bytes32[] calldata extraIdentities, uint8 threshold_) external onlyEntryPointOrSelf {
        if (superWallet) revert SuperAlreadyEnabled();
        if (threshold_ < 1) revert InvalidThreshold();
        _addSigner(identityId);
        uint256 len = extraIdentities.length;
        for (uint256 i = 0; i < len; ++i) {
            _addSigner(extraIdentities[i]);
        }
        if (signerCount < threshold_) revert InvalidThreshold();
        superWallet = true;
        threshold = threshold_;
        emit SuperEnabled(threshold_);
    }

    function addSigner(bytes32 signerId) external onlyEntryPointOrSelf {
        if (!superWallet) revert NotSuperWallet();
        _addSigner(signerId);
    }

    function removeSigner(bytes32 signerId) external onlyEntryPointOrSelf {
        if (!superWallet) revert NotSuperWallet();
        if (!isSigner[signerId]) revert SignerNotFound();
        if (signerCount <= threshold) revert InvalidThreshold();
        isSigner[signerId] = false;
        signerCount -= 1;
        uint8 count = signerCount + 1;
        for (uint8 i = 0; i < count; ++i) {
            if (signerAt[i] == signerId) {
                signerAt[i] = signerAt[signerCount];
                delete signerAt[signerCount];
                break;
            }
        }
        emit SignerRemoved(signerId);
    }

    function setThreshold(uint8 threshold_) external onlyEntryPointOrSelf {
        if (!superWallet) revert NotSuperWallet();
        if (threshold_ < 1 || threshold_ > signerCount) revert InvalidThreshold();
        threshold = threshold_;
        emit ThresholdUpdated(threshold_);
    }

    function _addSigner(bytes32 signerId) internal {
        if (signerId == bytes32(0)) revert InvalidIdentity();
        if (!store.identityExists(signerId)) revert IdentityNotFound();
        if (isSigner[signerId]) revert SignerExists();
        isSigner[signerId] = true;
        signerAt[signerCount] = signerId;
        signerCount += 1;
        emit SignerAdded(signerId);
    }

    function _erc7821AuthorizedExecutor(
        address caller,
        bytes32 mode,
        bytes calldata executionData
    ) internal view override returns (bool) {
        return caller == address(entryPoint()) || super._erc7821AuthorizedExecutor(caller, mode, executionData);
    }

    function _rawSignatureValidation(bytes32 hash, bytes calldata signature) internal view override returns (bool) {
        if (superWallet) {
            if (signature.length >= 4 && bytes4(signature[:4]) == IdentityTypes.SUPER_MAGIC) {
                bytes[] memory blobs = IdentitySigLib.decodeSuperBlobs(signature);
                return _validateSuper(hash, blobs);
            }
            // Single identity blob still valid when threshold is 1.
            bytes32 id = store.verify(hash, signature);
            return id != bytes32(0) && isSigner[id] && threshold <= 1;
        }
        return store.verify(hash, signature) == identityId;
    }

    function _validateSuper(bytes32 hash, bytes[] memory blobs) internal view returns (bool) {
        uint8 votes;
        uint256 seen;
        uint256 len = blobs.length;
        for (uint256 i = 0; i < len; ++i) {
            bytes32 id = store.verify(hash, blobs[i]);
            if (id == bytes32(0) || !isSigner[id]) return false;
            uint8 bit;
            bool found;
            uint8 count = signerCount;
            for (uint8 b = 0; b < count; ++b) {
                if (signerAt[b] == id) {
                    bit = b;
                    found = true;
                    break;
                }
            }
            if (!found) return false;
            uint256 mask = uint256(1) << bit;
            if (seen & mask != 0) return false;
            seen |= mask;
            votes += 1;
        }
        return votes >= threshold;
    }
}
