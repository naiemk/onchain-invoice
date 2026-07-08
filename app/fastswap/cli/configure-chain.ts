import { Contract, JsonRpcProvider, Wallet, ZeroAddress, parseUnits } from "ethers";
import type { FastSwapConfigFile } from "../config/types.js";
import { getChainDefinition, resolveChainContracts } from "../config/load.js";
import { readArtifact } from "./artifacts.js";

const ROLE_NAMES = [
  "DEFAULT_ADMIN_ROLE",
  "ADMIN_ROLE",
  "RELAYER_ROLE",
  "LIQUIDITY_ROLE",
  "AGGREGATE_ALL_ROLE",
  "REBALANCER_ROLE",
] as const;

type FastSwapRoleName = (typeof ROLE_NAMES)[number];

export async function configureFastSwapRole(input: {
  config: FastSwapConfigFile;
  chainKey: string;
  privateKey: string;
  role: FastSwapRoleName;
  account: string;
  grant: boolean;
}) {
  const chain = getChainDefinition(input.config, input.chainKey);
  const contracts = resolveChainContracts(input.config, chain);
  const artifact = await readArtifact(
    chain.type === "tron"
      ? "contracts/tron/fastswap/TronFastSwapReceiver.sol/TronFastSwapReceiver.json"
      : "contracts/fastswap/FastSwapReceiver.sol/FastSwapReceiver.json"
  );

  if (chain.type === "evm") {
    if (!chain.rpcUrl) throw new Error(`Missing rpcUrl for ${input.chainKey}`);
    const wallet = new Wallet(input.privateKey, new JsonRpcProvider(chain.rpcUrl));
    const fastSwap = new Contract(contracts.fastSwapAddress, artifact.abi, wallet);
    const roleHash = await fastSwap.getFunction(input.role)();
    const tx = input.grant
      ? await fastSwap.grantRole(roleHash, input.account)
      : await fastSwap.revokeRole(roleHash, input.account);
    await tx.wait();
    return { chainKey: input.chainKey, role: input.role, account: input.account, grant: input.grant, txHash: tx.hash };
  }

  throw new Error("Tron role configuration is not implemented in the CLI yet");
}

export async function setLiquidityFloor(input: {
  config: FastSwapConfigFile;
  chainKey: string;
  privateKey: string;
  token: string;
  amount: string;
}) {
  const chain = getChainDefinition(input.config, input.chainKey);
  if (chain.type !== "evm") throw new Error("setLiquidityFloor currently supports EVM only");
  if (!chain.rpcUrl) throw new Error(`Missing rpcUrl for ${input.chainKey}`);
  const contracts = resolveChainContracts(input.config, chain);
  const artifact = await readArtifact("contracts/fastswap/FastSwapReceiver.sol/FastSwapReceiver.json");
  const wallet = new Wallet(input.privateKey, new JsonRpcProvider(chain.rpcUrl));
  const fastSwap = new Contract(contracts.fastSwapAddress, artifact.abi, wallet);
  const tokenAddress = input.token.toUpperCase() === "NATIVE" ? ZeroAddress : input.token;
  const tx = await fastSwap.setLiquidityFloor(tokenAddress, BigInt(input.amount));
  await tx.wait();
  return { chainKey: input.chainKey, token: tokenAddress, amount: input.amount, txHash: tx.hash };
}

export async function addNativeLiquidity(input: {
  config: FastSwapConfigFile;
  chainKey: string;
  privateKey: string;
  amount: string;
}) {
  const chain = getChainDefinition(input.config, input.chainKey);
  if (chain.type !== "evm") throw new Error("addNativeLiquidity currently supports EVM only");
  if (!chain.rpcUrl) throw new Error(`Missing rpcUrl for ${input.chainKey}`);
  const contracts = resolveChainContracts(input.config, chain);
  const artifact = await readArtifact("contracts/fastswap/FastSwapReceiver.sol/FastSwapReceiver.json");
  const wallet = new Wallet(input.privateKey, new JsonRpcProvider(chain.rpcUrl));
  const fastSwap = new Contract(contracts.fastSwapAddress, artifact.abi, wallet);
  const amount = BigInt(input.amount);
  const tx = await fastSwap.addLiquidity(ZeroAddress, amount, { value: amount });
  await tx.wait();
  return { chainKey: input.chainKey, amount: input.amount, txHash: tx.hash };
}

export async function setAggregatorAllowed(input: {
  config: FastSwapConfigFile;
  chainKey: string;
  privateKey: string;
  aggregator: string;
  allowed: boolean;
}) {
  const chain = getChainDefinition(input.config, input.chainKey);
  if (chain.type !== "evm") throw new Error("setAggregatorAllowed currently supports EVM only");
  if (!chain.rpcUrl) throw new Error(`Missing rpcUrl for ${input.chainKey}`);
  const contracts = resolveChainContracts(input.config, chain);
  const artifact = await readArtifact("contracts/fastswap/FastSwapReceiver.sol/FastSwapReceiver.json");
  const wallet = new Wallet(input.privateKey, new JsonRpcProvider(chain.rpcUrl));
  const fastSwap = new Contract(contracts.fastSwapAddress, artifact.abi, wallet);
  const tx = await fastSwap.setAggregatorAllowed(input.aggregator, input.allowed);
  await tx.wait();
  return { chainKey: input.chainKey, aggregator: input.aggregator, allowed: input.allowed, txHash: tx.hash };
}

export async function setFastSwapPaused(input: {
  config: FastSwapConfigFile;
  chainKey: string;
  privateKey: string;
  paused: boolean;
}) {
  const chain = getChainDefinition(input.config, input.chainKey);
  if (chain.type !== "evm") throw new Error("pause/unpause currently supports EVM only");
  if (!chain.rpcUrl) throw new Error(`Missing rpcUrl for ${input.chainKey}`);
  const contracts = resolveChainContracts(input.config, chain);
  const artifact = await readArtifact("contracts/fastswap/FastSwapReceiver.sol/FastSwapReceiver.json");
  const wallet = new Wallet(input.privateKey, new JsonRpcProvider(chain.rpcUrl));
  const fastSwap = new Contract(contracts.fastSwapAddress, artifact.abi, wallet);
  const tx = input.paused ? await fastSwap.pause() : await fastSwap.unpause();
  await tx.wait();
  return { chainKey: input.chainKey, paused: input.paused, txHash: tx.hash };
}

export async function allowLiquidityManagerRouter(input: {
  config: FastSwapConfigFile;
  chainKey: string;
  privateKey: string;
  router: string;
  allowed: boolean;
}) {
  const chain = getChainDefinition(input.config, input.chainKey);
  if (chain.type !== "evm") throw new Error("Router allowlist currently supports EVM only");
  if (!chain.rpcUrl) throw new Error(`Missing rpcUrl for ${input.chainKey}`);
  const contracts = resolveChainContracts(input.config, chain);
  if (!contracts.liquidityManagerAddress) throw new Error("Missing liquidityManagerAddress");
  const artifact = await readArtifact("contracts/liquiditymanager/LiquidityManager.sol/LiquidityManager.json");
  const wallet = new Wallet(input.privateKey, new JsonRpcProvider(chain.rpcUrl));
  const lm = new Contract(contracts.liquidityManagerAddress, artifact.abi, wallet);
  const tx = await lm.setRouterAllowed(input.router, input.allowed);
  await tx.wait();
  return { chainKey: input.chainKey, router: input.router, allowed: input.allowed, txHash: tx.hash };
}

export type { FastSwapRoleName };

export function listRoleNames(): readonly FastSwapRoleName[] {
  return ROLE_NAMES;
}

export function parseTokenAmount(raw: string, decimals: number): string {
  if (/^\d+$/.test(raw)) return raw;
  return parseUnits(raw, decimals).toString();
}
