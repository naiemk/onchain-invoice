import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  AbiCoder,
  concat,
  getCreate2Address,
  hexlify,
  keccak256,
  toUtf8Bytes,
} from "ethers";

/** Nick's CREATE2 deployer — same address on Ethereum, Sepolia, most L2s. */
export const DEFAULT_CREATE2_FACTORY = "0x4e59b44847b379578588920cA78FbF26c0B4956C";

export type SweeperCreate2Plan = {
  salt: string;
  initCode: string;
  initCodeHash: string;
  predictedSweeper: string;
  factory: string;
  /** calldata = salt ‖ initCode (Nick factory convention) */
  deployCalldata: string;
  constructorArgs: [string, number, string];
};

export function saltFor(seed: string, chainId: number, name: string): string {
  return keccak256(toUtf8Bytes(`${seed.trim()}|${chainId}|${name}`));
}

export function loadSweeperArtifact(repoRoot: string): { bytecode: string; abi: unknown[] } {
  const path = resolve(
    repoRoot,
    "artifacts/contracts/commerce/CommerceInvoiceSweeper.sol/CommerceInvoiceSweeper.json"
  );
  const json = JSON.parse(readFileSync(path, "utf8")) as {
    bytecode: string;
    abi: unknown[];
  };
  if (!json.bytecode || json.bytecode === "0x") {
    throw new Error("CommerceInvoiceSweeper bytecode missing — run hardhat compile");
  }
  return json;
}

export function planSweeperCreate2(opts: {
  seed: string;
  chainId: number;
  feeRecipient: string;
  feeBps: number;
  owner: string;
  bytecode: string;
  factory?: string;
}): SweeperCreate2Plan {
  const factory = opts.factory ?? DEFAULT_CREATE2_FACTORY;
  const salt = saltFor(opts.seed, opts.chainId, "CommerceInvoiceSweeper");
  const constructorArgs: [string, number, string] = [opts.feeRecipient, opts.feeBps, opts.owner];
  const encodedArgs = AbiCoder.defaultAbiCoder().encode(
    ["address", "uint16", "address"],
    constructorArgs
  );
  const initCode = concat([opts.bytecode, encodedArgs]);
  const initCodeHash = keccak256(initCode);
  const predictedSweeper = getCreate2Address(factory, salt, initCodeHash);
  const deployCalldata = hexlify(concat([salt, initCode]));
  return {
    salt,
    initCode: hexlify(initCode),
    initCodeHash,
    predictedSweeper,
    factory,
    deployCalldata,
    constructorArgs,
  };
}
