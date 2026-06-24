import type { RelayChain } from "../../nodes/relay-node/index.js";
import type { FastSwapConfigFile } from "../types.js";
import { getActiveChainDefinitions, resolveChainContracts } from "../load.js";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing env ${name}`);
  return value;
}

export function toRelayChains(config: FastSwapConfigFile): RelayChain[] {
  return getActiveChainDefinitions(config).map((chain) => {
    const contracts = resolveChainContracts(config, chain);
    const privateKey =
      chain.type === "evm" ? requireEnv("RELAY_EVM_PRIVATE_KEY") : requireEnv("RELAY_TRON_PRIVATE_KEY");
    if (chain.type === "evm") {
      if (!chain.rpcUrl) throw new Error(`${chain.key}: rpcUrl required`);
      return {
        id: chain.id,
        name: chain.name,
        type: "evm",
        rpcUrl: chain.rpcUrl,
        fastSwapAddress: contracts.fastSwapAddress,
        privateKey,
        startBlock: chain.startBlock ?? 0,
        confirmations: chain.confirmations ?? config.relayNode.confirmations,
      };
    }
    if (!chain.fullHost && !chain.rpcUrl) throw new Error(`${chain.key}: fullHost required`);
    return {
      id: chain.id,
      name: chain.name,
      type: "tron",
      fullHost: chain.fullHost ?? chain.rpcUrl!,
      fastSwapAddress: contracts.fastSwapAddress,
      privateKey,
      feeLimit: chain.feeLimit,
      startTimestamp: chain.startTimestamp ?? 0,
      eventPollLimit: 200,
      confirmations: chain.confirmations ?? config.relayNode.confirmations,
    };
  });
}

export type RelayRunnerConfig = {
  apiBaseUrl: string;
  nodeAuthSecret: string;
  pollIntervalMs: number;
  progressPath: string;
  auditLogPath: string;
  chains: RelayChain[];
};

export function toRelayRunnerConfig(config: FastSwapConfigFile): RelayRunnerConfig {
  const signingSecret = requireEnv(config.server.signingSecretEnv ?? "API_SIGNING_SECRET");
  const publicUrl = config.server.publicUrl ?? `http://${config.server.host}:${config.server.apiPort}`;
  return {
    apiBaseUrl: publicUrl.replace(/\/$/, ""),
    nodeAuthSecret: signingSecret,
    pollIntervalMs: config.relayNode.pollIntervalMs,
    progressPath: config.nodes.relay.progressPath,
    auditLogPath: config.nodes.relay.auditLogPath,
    chains: toRelayChains(config),
  };
}
