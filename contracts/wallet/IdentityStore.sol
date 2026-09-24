// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IdentitySigLib} from "./IdentitySigLib.sol";
import {IdentityTypes} from "./IdentityTypes.sol";
import {IdentityErrors} from "./IdentityErrors.sol";

/// @notice On-chain identity: WebAuthn / YubiKey / EOA methods. Wallets point at identityId.
contract IdentityStore is Ownable, IdentityErrors {
    bytes32 private constant EIP712_DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes32 private constant NAME_HASH = keccak256("Trustless Commerce Identity");
    bytes32 private constant VERSION_HASH = keccak256("1");
    bytes32 private constant VERIFY_TYPEHASH = keccak256("Verify(bytes32 message)");
    bytes32 private constant ADD_METHOD_TYPEHASH =
        keccak256("AddMethod(bytes32 identityId,uint8 kind,bytes32 qx,bytes32 qy,address eoa)");
    bytes32 private constant REMOVE_METHOD_TYPEHASH = keccak256("RemoveMethod(bytes32 identityId,bytes32 methodId)");
    bytes32 private constant CANCEL_RESTORE_TYPEHASH = keccak256("CancelRestore(bytes32 identityId)");

    struct PendingRestore {
        uint8 kind;
        bytes32 qx;
        bytes32 qy;
        address eoa;
        uint64 executeAfter;
        bool active;
    }

    address public recoveryOperator;
    uint64 public restoreDelay;

    mapping(bytes32 identityId => IdentityTypes.Identity) private _identities;
    mapping(bytes32 methodId => IdentityTypes.Method) private _methods;
    mapping(bytes32 identityId => bytes32[] methodIds) private _methodIds;
    mapping(bytes32 identityId => PendingRestore) public pendingRestores;

    event IdentityRegistered(bytes32 indexed identityId, bytes32 indexed methodId, uint8 kind);
    event MethodAdded(bytes32 indexed identityId, bytes32 indexed methodId, uint8 kind);
    event MethodRemoved(bytes32 indexed identityId, bytes32 indexed methodId);
    event RestoreDisabled(bytes32 indexed identityId, address indexed by);
    event RestoreInitiated(bytes32 indexed identityId, uint8 kind, uint64 executeAfter);
    event RestoreCancelled(bytes32 indexed identityId);
    event MethodRestored(bytes32 indexed identityId, bytes32 indexed methodId, uint8 kind);
    event RecoveryOperatorUpdated(address indexed recoveryOperator);
    event RestoreDelayUpdated(uint64 restoreDelay);

    constructor(address recoveryOperator_, address initialOwner) Ownable(initialOwner) {
        recoveryOperator = recoveryOperator_;
        emit RecoveryOperatorUpdated(recoveryOperator_);
    }

    function setRecoveryOperator(address recoveryOperator_) external onlyOwner {
        recoveryOperator = recoveryOperator_;
        emit RecoveryOperatorUpdated(recoveryOperator_);
    }

    function setRestoreDelay(uint64 restoreDelay_) external onlyOwner {
        restoreDelay = restoreDelay_;
        emit RestoreDelayUpdated(restoreDelay_);
    }

    function domainSeparator() public view returns (bytes32) {
        return keccak256(abi.encode(EIP712_DOMAIN_TYPEHASH, NAME_HASH, VERSION_HASH, block.chainid, address(this)));
    }

    function hashVerify(bytes32 message) public view returns (bytes32) {
        return MessageHashUtils.toTypedDataHash(domainSeparator(), keccak256(abi.encode(VERIFY_TYPEHASH, message)));
    }

    function hashAddMethod(
        bytes32 identityId,
        uint8 kind,
        bytes32 qx,
        bytes32 qy,
        address eoa
    ) public view returns (bytes32) {
        return MessageHashUtils.toTypedDataHash(
            domainSeparator(),
            keccak256(abi.encode(ADD_METHOD_TYPEHASH, identityId, kind, qx, qy, eoa))
        );
    }

    function hashRemoveMethod(bytes32 identityId, bytes32 methodId) public view returns (bytes32) {
        return MessageHashUtils.toTypedDataHash(
            domainSeparator(),
            keccak256(abi.encode(REMOVE_METHOD_TYPEHASH, identityId, methodId))
        );
    }

    function hashCancelRestore(bytes32 identityId) public view returns (bytes32) {
        return MessageHashUtils.toTypedDataHash(
            domainSeparator(),
            keccak256(abi.encode(CANCEL_RESTORE_TYPEHASH, identityId))
        );
    }

    function computeMethodId(
        bytes32 identityId,
        uint8 kind,
        bytes32 qx,
        bytes32 qy,
        address eoa
    ) public pure returns (bytes32) {
        return IdentitySigLib.computeMethodId(identityId, kind, qx, qy, eoa);
    }

    function identityExists(bytes32 identityId) public view returns (bool) {
        return _identities[identityId].exists;
    }

    function getIdentity(bytes32 identityId) external view returns (IdentityTypes.Identity memory) {
        return _identities[identityId];
    }

    function getMethod(bytes32 methodId) external view returns (IdentityTypes.Method memory) {
        return _methods[methodId];
    }

    function methodIdsOf(bytes32 identityId) external view returns (bytes32[] memory) {
        return _methodIds[identityId];
    }

    function hasKind(bytes32 identityId, uint8 kind) public view returns (bool) {
        IdentityTypes.Identity storage idn = _identities[identityId];
        if (!idn.exists) return false;
        if (kind == IdentityTypes.METHOD_WEBAUTHN) return idn.webauthnCount > 0;
        if (kind == IdentityTypes.METHOD_YUBIKEY) return idn.yubikeyCount > 0;
        if (kind == IdentityTypes.METHOD_EOA) return idn.eoaCount > 0;
        return false;
    }

    /// @notice First method must be a passkey. `identityId` is a random off-chain id (email lives in the DB).
    function register(bytes32 identityId, bytes32 qx, bytes32 qy) external {
        if (identityId == bytes32(0)) revert InvalidIdentity();
        if (_identities[identityId].exists) revert IdentityExists();
        _assertP256(qx, qy);
        bytes32 id = IdentitySigLib.computeMethodId(identityId, IdentityTypes.METHOD_WEBAUTHN, qx, qy, address(0));
        _identities[identityId] = IdentityTypes.Identity({
            exists: true,
            restoreEnabled: true,
            methodCount: 1,
            eoaCount: 0,
            webauthnCount: 1,
            yubikeyCount: 0
        });
        _storeMethod(id, identityId, IdentityTypes.METHOD_WEBAUTHN, qx, qy, address(0));
        emit IdentityRegistered(identityId, id, IdentityTypes.METHOD_WEBAUTHN);
    }

    /// @notice Add a method. `authorization` is an IDS1 blob from an existing method over `hashAddMethod(...)`.
    function addMethod(
        bytes32 identityId,
        uint8 kind,
        bytes32 qx,
        bytes32 qy,
        address eoa,
        bytes calldata authorization
    ) external {
        if (verify(hashAddMethod(identityId, kind, qx, qy, eoa), authorization) != identityId) {
            revert InvalidSignature();
        }
        _addMethod(identityId, kind, qx, qy, eoa);
    }

    /// @notice Pay gas with a crypto wallet already on the identity (no bundler).
    function addMethodByEoa(bytes32 identityId, uint8 kind, bytes32 qx, bytes32 qy, address eoa) external {
        if (!_isIdentityEoa(identityId, msg.sender)) revert NotIdentityEoa();
        _addMethod(identityId, kind, qx, qy, eoa);
    }

    function removeMethod(bytes32 identityId, bytes32 methodId, bytes calldata authorization) external {
        IdentityTypes.Method storage m = _methods[methodId];
        if (!m.exists || m.identityId != identityId) revert MethodNotFound();
        IdentityTypes.Identity storage idn = _identities[identityId];
        if (idn.methodCount <= 1) revert LastMethod();
        if (verify(hashRemoveMethod(identityId, methodId), authorization) != identityId) {
            revert InvalidSignature();
        }
        _removeMethod(identityId, methodId);
    }

    /// @notice Direct call from an EOA on the identity. No bundler. Etherscan-ok.
    function disableRestore(bytes32 identityId) external {
        IdentityTypes.Identity storage idn = _identities[identityId];
        if (!idn.exists) revert IdentityNotFound();
        if (!idn.restoreEnabled) revert RestoreAlreadyDisabled();
        if (idn.eoaCount == 0) revert RestoreRequiresEoa();
        if (!_isIdentityEoa(identityId, msg.sender)) revert NotIdentityEoa();
        idn.restoreEnabled = false;
        if (pendingRestores[identityId].active) {
            delete pendingRestores[identityId];
            emit RestoreCancelled(identityId);
        }
        emit RestoreDisabled(identityId, msg.sender);
    }

    /// @notice Email-recovery path: operator starts (and, if delay is 0, finishes) adding a method.
    function restoreAddMethod(
        bytes32 identityId,
        uint8 kind,
        bytes32 qx,
        bytes32 qy,
        address eoa
    ) external {
        _initiateRestore(identityId, kind, qx, qy, eoa);
        if (restoreDelay == 0) {
            _executeRestore(identityId);
        }
    }

    /// @notice Operator starts a delayed restore. Same as restoreAddMethod when delay is 0 after executeRestore.
    function initiateRestore(
        bytes32 identityId,
        uint8 kind,
        bytes32 qx,
        bytes32 qy,
        address eoa
    ) external {
        _initiateRestore(identityId, kind, qx, qy, eoa);
    }

    /// @notice Existing method cancels a pending restore (old passkey / YubiKey / EOA).
    function cancelRestore(bytes32 identityId, bytes calldata authorization) external {
        if (!pendingRestores[identityId].active) revert RestoreNotPending();
        if (verify(hashCancelRestore(identityId), authorization) != identityId) {
            revert InvalidSignature();
        }
        delete pendingRestores[identityId];
        emit RestoreCancelled(identityId);
    }

    /// @notice Anyone may finalize after the delay while restore is still enabled.
    function executeRestore(bytes32 identityId) external {
        _executeRestore(identityId);
    }

    /// @return identityId when the blob is valid; `bytes32(0)` otherwise (no revert on bad crypto).
    function verify(bytes32 message, bytes memory blob) public view returns (bytes32) {
        if (blob.length < 4) return bytes32(0);
        bytes4 magic;
        assembly {
            magic := mload(add(blob, 32))
        }
        if (magic != IdentityTypes.SIG_MAGIC) return bytes32(0);
        bytes memory encoded = new bytes(blob.length - 4);
        for (uint256 i = 4; i < blob.length; ++i) {
            encoded[i - 4] = blob[i];
        }
        (uint8 kind, bytes32 identityId, bytes32 id, bytes memory inner) =
            abi.decode(encoded, (uint8, bytes32, bytes32, bytes));
        IdentityTypes.Method storage m = _methods[id];
        if (!m.exists || m.identityId != identityId || m.kind != kind) return bytes32(0);
        if (!_checkMethodSig(message, m, inner)) return bytes32(0);
        return identityId;
    }

    function _initiateRestore(
        bytes32 identityId,
        uint8 kind,
        bytes32 qx,
        bytes32 qy,
        address eoa
    ) internal {
        if (recoveryOperator == address(0)) revert RestoreOperatorUnset();
        if (msg.sender != recoveryOperator) revert NotRecoveryOperator();
        IdentityTypes.Identity storage idn = _identities[identityId];
        if (!idn.exists) revert IdentityNotFound();
        if (!idn.restoreEnabled) revert RestoreIsDisabled();
        if (pendingRestores[identityId].active) revert RestorePending();
        _assertMethodFields(kind, qx, qy, eoa);
        uint64 executeAfter = uint64(block.timestamp) + restoreDelay;
        pendingRestores[identityId] = PendingRestore({
            kind: kind,
            qx: qx,
            qy: qy,
            eoa: eoa,
            executeAfter: executeAfter,
            active: true
        });
        emit RestoreInitiated(identityId, kind, executeAfter);
    }

    function _executeRestore(bytes32 identityId) internal {
        PendingRestore storage pending = pendingRestores[identityId];
        if (!pending.active) revert RestoreNotPending();
        if (block.timestamp < pending.executeAfter) revert RestoreNotReady();
        IdentityTypes.Identity storage idn = _identities[identityId];
        if (!idn.exists) revert IdentityNotFound();
        if (!idn.restoreEnabled) revert RestoreIsDisabled();
        uint8 kind = pending.kind;
        bytes32 qx = pending.qx;
        bytes32 qy = pending.qy;
        address eoa = pending.eoa;
        delete pendingRestores[identityId];
        bytes32 id = _addMethod(identityId, kind, qx, qy, eoa);
        emit MethodRestored(identityId, id, kind);
    }

    function _addMethod(
        bytes32 identityId,
        uint8 kind,
        bytes32 qx,
        bytes32 qy,
        address eoa
    ) internal returns (bytes32 id) {
        IdentityTypes.Identity storage idn = _identities[identityId];
        if (!idn.exists) revert IdentityNotFound();
        if (idn.methodCount >= IdentityTypes.MAX_METHODS) revert TooManyMethods();
        _assertMethodFields(kind, qx, qy, eoa);
        id = IdentitySigLib.computeMethodId(identityId, kind, qx, qy, eoa);
        if (_methods[id].exists) revert MethodExists();
        idn.methodCount += 1;
        if (kind == IdentityTypes.METHOD_WEBAUTHN) idn.webauthnCount += 1;
        else if (kind == IdentityTypes.METHOD_YUBIKEY) idn.yubikeyCount += 1;
        else idn.eoaCount += 1;
        _storeMethod(id, identityId, kind, qx, qy, eoa);
        emit MethodAdded(identityId, id, kind);
    }

    function _removeMethod(bytes32 identityId, bytes32 methodId) internal {
        IdentityTypes.Method storage m = _methods[methodId];
        uint8 kind = m.kind;
        IdentityTypes.Identity storage idn = _identities[identityId];
        idn.methodCount -= 1;
        if (kind == IdentityTypes.METHOD_WEBAUTHN) idn.webauthnCount -= 1;
        else if (kind == IdentityTypes.METHOD_YUBIKEY) idn.yubikeyCount -= 1;
        else idn.eoaCount -= 1;
        delete _methods[methodId];
        bytes32[] storage list = _methodIds[identityId];
        uint256 len = list.length;
        for (uint256 i = 0; i < len; ++i) {
            if (list[i] == methodId) {
                list[i] = list[len - 1];
                list.pop();
                break;
            }
        }
        emit MethodRemoved(identityId, methodId);
    }

    function _storeMethod(
        bytes32 id,
        bytes32 identityId,
        uint8 kind,
        bytes32 qx,
        bytes32 qy,
        address eoa
    ) internal {
        _methods[id] = IdentityTypes.Method({
            identityId: identityId,
            kind: kind,
            qx: qx,
            qy: qy,
            eoa: eoa,
            exists: true
        });
        _methodIds[identityId].push(id);
    }

    function _checkMethodSig(
        bytes32 message,
        IdentityTypes.Method storage m,
        bytes memory inner
    ) internal view returns (bool) {
        if (m.kind == IdentityTypes.METHOD_EOA) {
            if (m.eoa == address(0) || inner.length != 65) return false;
            // Prefer the message digest itself (EIP-712 AddMethod / RemoveMethod) so wallets
            // can show the struct. Legacy Verify(bytes32) wrapping remains valid.
            (address recovered, ECDSA.RecoverError err, ) = ECDSA.tryRecover(message, inner);
            if (err == ECDSA.RecoverError.NoError && recovered == m.eoa) return true;
            (recovered, err, ) = ECDSA.tryRecover(hashVerify(message), inner);
            return err == ECDSA.RecoverError.NoError && recovered == m.eoa;
        }
        if (m.kind == IdentityTypes.METHOD_WEBAUTHN || m.kind == IdentityTypes.METHOD_YUBIKEY) {
            return IdentitySigLib.verifyWebAuthn(message, inner, m.qx, m.qy);
        }
        return false;
    }

    function _isIdentityEoa(bytes32 identityId, address who) internal view returns (bool) {
        if (who == address(0) || !_identities[identityId].exists) return false;
        bytes32 id = IdentitySigLib.computeMethodId(identityId, IdentityTypes.METHOD_EOA, bytes32(0), bytes32(0), who);
        IdentityTypes.Method storage m = _methods[id];
        return m.exists && m.kind == IdentityTypes.METHOD_EOA && m.eoa == who;
    }

    function _assertMethodFields(uint8 kind, bytes32 qx, bytes32 qy, address eoa) internal pure {
        if (kind == IdentityTypes.METHOD_EOA) {
            if (eoa == address(0) || qx != bytes32(0) || qy != bytes32(0)) revert InvalidMethod();
            return;
        }
        if (kind == IdentityTypes.METHOD_WEBAUTHN || kind == IdentityTypes.METHOD_YUBIKEY) {
            if (eoa != address(0)) revert InvalidMethod();
            _assertP256(qx, qy);
            return;
        }
        revert InvalidMethodKind();
    }

    function _assertP256(bytes32 qx, bytes32 qy) internal pure {
        if (qx == bytes32(0) && qy == bytes32(0)) revert InvalidMethod();
    }
}
