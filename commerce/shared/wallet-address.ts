import {
  AbiCoder,
  getAddress,
  getCreate2Address,
  keccak256,
  solidityPacked,
  solidityPackedKeccak256,
} from "ethers";

const WALLET_SALT_VERSION = "TC-WALLET-V1";

/** OpenZeppelin Clones minimal proxy init code (WalletFactory uses cloneDeterministic). */
function cloneInitCodeHash(implementation: string): string {
  const impl = getAddress(implementation);
  const initCode = solidityPacked(
    ["bytes", "address", "bytes"],
    ["0x3d602d80600a3d3981f3363d3d373d3d3d363d73", impl, "0x5af43d82803e903d91602b57fd5bf3"]
  );
  return solidityPackedKeccak256(["bytes"], [initCode]);
}

/** Deterministic salt from passkey owner coordinates (same on all EVM chains). */
export function deriveWalletSalt(qx: string, qy: string): string {
  const coder = AbiCoder.defaultAbiCoder();
  return keccak256(coder.encode(["string", "bytes32", "bytes32"], [WALLET_SALT_VERSION, qx, qy]));
}

/** Predict counterfactual wallet clone address without RPC. */
export function predictWalletAddress(factory: string, implementation: string, salt: string): string {
  return getCreate2Address(getAddress(factory), salt, cloneInitCodeHash(implementation));
}
