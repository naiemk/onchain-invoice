// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IAccount, PackedUserOperation} from "@openzeppelin/contracts/interfaces/draft-IERC4337.sol";

/// @dev Minimal EntryPoint for Playwright local-stack e2e. Bytecode is copied to the
/// canonical v0.9 address via hardhat_setCode so Wallet.entryPoint() matches msg.sender.
contract E2eEntryPoint {
    mapping(address => mapping(uint192 => uint256)) private _nonce;

    event UserOperationEvent(
        bytes32 indexed userOpHash,
        address indexed sender,
        address indexed paymaster,
        uint256 nonce,
        bool success,
        uint256 actualGasCost,
        uint256 actualGasUsed
    );

    receive() external payable {}

    function depositTo(address) external payable {}

    /// @dev Bundler skips ETH prefund when this is already large (Hardhat automine
    /// cannot queue depositTo + handleOps from the same signer).
    function balanceOf(address) external pure returns (uint256) {
        return type(uint128).max;
    }

    function getNonce(address sender, uint192 key) external view returns (uint256) {
        return (uint256(key) << 64) | _nonce[sender][key];
    }

    function getUserOpHash(PackedUserOperation calldata userOp) public view returns (bytes32) {
        bytes32 packed = keccak256(
            abi.encode(
                userOp.sender,
                userOp.nonce,
                keccak256(userOp.initCode),
                keccak256(userOp.callData),
                userOp.accountGasLimits,
                userOp.preVerificationGas,
                userOp.gasFees,
                keccak256(userOp.paymasterAndData)
            )
        );
        return keccak256(abi.encode(packed, address(this), block.chainid));
    }

    function handleOps(PackedUserOperation[] calldata ops, address payable /*beneficiary*/) external {
        uint256 len = ops.length;
        for (uint256 i = 0; i < len; ++i) {
            PackedUserOperation calldata op = ops[i];
            bytes32 userOpHash = getUserOpHash(op);
            uint192 key = uint192(op.nonce >> 64);
            uint256 seq = uint256(uint64(op.nonce));
            require(seq == _nonce[op.sender][key], "bad-nonce");
            uint256 validationData = IAccount(op.sender).validateUserOp(op, userOpHash, 0);
            require(validationData == 0, "AA24");
            _nonce[op.sender][key] = seq + 1;
            (bool ok, bytes memory err) = op.sender.call(op.callData);
            if (!ok) {
                if (err.length > 0) {
                    assembly {
                        revert(add(err, 32), mload(err))
                    }
                }
                revert("inner-call-failed");
            }
            emit UserOperationEvent(userOpHash, op.sender, address(0), op.nonce, true, 0, 0);
        }
    }
}
