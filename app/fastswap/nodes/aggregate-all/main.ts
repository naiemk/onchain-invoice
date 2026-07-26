#!/usr/bin/env node
import { loadFastSwapConfig, resolveConfigPath } from "../../config/load.js";
import { getChainDefinition, resolveChainContracts } from "../../config/load.js";
import { aggregateAll } from "./index.js";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing env ${name}`);
  return value;
}

const args = process.argv.slice(2);
const configPath = resolveConfigPath(args.find((a, i) => args[i - 1] === "--config"));
const config = loadFastSwapConfig(configPath);
const chainKey = readFlag(args, "--chain");
const token = readFlag(args, "--token");
const aggregator = readFlag(args, "--aggregator");
const callData = readFlag(args, "--call-data") ?? "0x";

if (!chainKey || !token || !aggregator) {
  console.error("Usage: fastswap:aggregate --chain <key> --token <0x|NATIVE> --aggregator <0x> [--call-data 0x] [--config path]");
  process.exit(1);
}

const chain = getChainDefinition(config, chainKey);
if (chain.type !== "evm" || !chain.rpcUrl) throw new Error("aggregate CLI supports EVM chains with rpcUrl only");
const contracts = resolveChainContracts(config, chain);
const tokenAddress = token.toUpperCase() === "NATIVE" ? "0x0000000000000000000000000000000000000000" : token;

await aggregateAll({
  rpcUrl: chain.rpcUrl,
  privateKey: requireEnv("EVM_PRIVATE_KEY"),
  fastSwapAddress: contracts.fastSwapAddress,
  token: tokenAddress,
  aggregator,
  callData,
});

function readFlag(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index === -1) return undefined;
  return args[index + 1];
}
