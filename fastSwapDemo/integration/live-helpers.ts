import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  Contract,
  ContractFactory,
  JsonRpcProvider,
  Wallet,
  concat,
  formatUnits,
  keccak256,
  type Signer,
} from "ethers";
import { TronWeb } from "tronweb";
import { readArtifact, type ContractArtifact } from "../../app/fastswap/cli/artifacts.js";

/* ------------------------------------------------------------------ *
 * Human-readable logging — the log stream should read like a story.
 * ------------------------------------------------------------------ */

let stepCounter = 0;

export const log = {
  section(title: string) {
    console.log(`\n${"=".repeat(64)}\n  ${title}\n${"=".repeat(64)}`);
  },
  scenario(title: string) {
    stepCounter = 0;
    console.log(`\n──── ${title} ${"─".repeat(Math.max(0, 55 - title.length))}`);
  },
  step(message: string) {
    console.log(`  ${String(++stepCounter).padStart(2, " ")}. ${message}`);
  },
  ok(message: string) {
    console.log(`      ✓ ${message}`);
  },
  info(message: string) {
    console.log(`      • ${message}`);
  },
  warn(message: string) {
    console.log(`      ! ${message}`);
  },
};

export function fmt(amount: bigint, decimals: number, symbol: string): string {
  return `${formatUnits(amount, decimals)} ${symbol}`;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

/* ------------------------------------------------------------------ *
 * EVM helpers (ethers)
 * ------------------------------------------------------------------ */

/** Human-readable ABI for ethers (EVM side). */
export const ERC20_FULL_ABI = [
  "function balanceOf(address account) view returns (uint256)",
  "function transfer(address to, uint256 amount) returns (bool)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function mint(address to, uint256 amount)",
  "function decimals() view returns (uint8)",
] as const;

/** JSON ABI for TronWeb (it does not accept ethers human-readable strings). */
export const TRON_ERC20_ABI = [
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "account", type: "address" }], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "transfer", stateMutability: "nonpayable", inputs: [{ name: "to", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ name: "", type: "bool" }] },
  { type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ name: "", type: "bool" }] },
  { type: "function", name: "mint", stateMutability: "nonpayable", inputs: [{ name: "to", type: "address" }, { name: "amount", type: "uint256" }], outputs: [] },
  { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint8" }] },
] as const;

export type EvmContext = {
  provider: JsonRpcProvider;
  wallet: Wallet;
  address: string;
};

export function makeEvm(rpcUrl: string, privateKey: string): EvmContext {
  const provider = new JsonRpcProvider(rpcUrl);
  const wallet = new Wallet(privateKey, provider);
  return { provider, wallet, address: wallet.address };
}

export async function deployEvm(signer: Signer, artifact: ContractArtifact, ...args: unknown[]): Promise<string> {
  const factory = new ContractFactory(artifact.abi, artifact.bytecode, signer);
  const contract = await factory.deploy(...args);
  await contract.waitForDeployment();
  return String(contract.target);
}

export async function evmHasCode(provider: JsonRpcProvider, address: string): Promise<boolean> {
  try {
    return (await provider.getCode(address)) !== "0x";
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ *
 * TRON helpers (tronweb)
 * ------------------------------------------------------------------ */

export type TronContext = {
  tronWeb: any;
  address: string;
};

export const TRON_ZERO_ADDRESS = "T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb";

export function makeTron(fullHost: string, privateKey: string): TronContext {
  const tronWeb = new TronWeb({ fullHost, privateKey: privateKey.replace(/^0x/, "") });
  return { tronWeb, address: tronWeb.defaultAddress.base58 as string };
}

export async function deployTron(
  tronWeb: any,
  artifact: { abi: unknown; bytecode: string },
  feeLimit: number,
  parameters: unknown[] = []
): Promise<string> {
  const result = await tronWeb.contract().new({
    abi: artifact.abi as never,
    bytecode: artifact.bytecode.replace(/^0x/, ""),
    feeLimit,
    parameters: parameters as never,
  } as never);
  const address: string = (result as { address: string }).address;
  return address.startsWith("T") ? address : tronWeb.address.fromHex(address);
}

/** Poll until a TRON tx is confirmed; throws on revert / energy failure / timeout. */
export async function waitTron(
  tronWeb: any,
  txId: string,
  { timeoutMs = 120_000, intervalMs = 3_000 }: { timeoutMs?: number; intervalMs?: number } = {}
): Promise<any> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const info = await tronWeb.trx.getTransactionInfo(txId).catch(() => ({}));
    if (info && (info.blockNumber || info.id)) {
      const receiptResult = info.receipt?.result as string | undefined;
      if (receiptResult && receiptResult !== "SUCCESS") {
        throw new Error(`TRON tx ${txId} reverted (${receiptResult})`);
      }
      if (info.result === "FAILED") {
        throw new Error(`TRON tx ${txId} failed`);
      }
      return info;
    }
    await sleep(intervalMs);
  }
  throw new Error(`TRON tx ${txId} not confirmed within ${timeoutMs}ms`);
}

export async function tronHasContract(tronWeb: any, address: string): Promise<boolean> {
  try {
    const contract = await tronWeb.trx.getContract(address);
    return Boolean(contract && contract.bytecode);
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ *
 * Deployment cache — only redeploy when bytecode/owner/network changes
 * ------------------------------------------------------------------ */

export type DeployedStack = {
  codeHash: string;
  fastSwap: string;
  sweeper: string;
  deployedAt: string;
};

export type DeployedToken = {
  codeHash: string;
  address: string;
  deployedAt: string;
};

export type ChainCache = {
  network: string;
  owner: string;
  stack?: DeployedStack;
  usdt?: DeployedToken;
};

export type DeploymentCache = {
  version: number;
  sepolia?: ChainCache;
  nile?: ChainCache;
};

export const CACHE_PATH = join(process.cwd(), "fastSwapDemo", "integration", "deployments.live.json");

export async function loadCache(): Promise<DeploymentCache> {
  try {
    return JSON.parse(await readFile(CACHE_PATH, "utf8")) as DeploymentCache;
  } catch {
    return { version: 1 };
  }
}

export async function saveCache(cache: DeploymentCache): Promise<void> {
  await mkdir(dirname(CACHE_PATH), { recursive: true });
  await writeFile(CACHE_PATH, JSON.stringify(cache, null, 2));
}

/** Stable hash over the creation bytecode of every contract in a stack. */
export function codeHashOf(...bytecodes: string[]): string {
  return keccak256(concat(bytecodes.map((code) => (code.startsWith("0x") ? code : `0x${code}`))));
}

export { readArtifact, type ContractArtifact, Contract };
