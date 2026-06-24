import type { FastSwapConfigFile } from "../types.js";
import { getActiveChainDefinitions, resolveChainContracts } from "../load.js";
import type { SweepNodeConfig } from "../../../../node/config.js";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing env ${name}`);
  return value;
}

export function toSweepNodeConfig(config: FastSwapConfigFile, apiPublicUrl: string): SweepNodeConfig {
  const signingSecret = requireEnv(config.server.signingSecretEnv ?? "API_SIGNING_SECRET");
  const chains = getActiveChainDefinitions(config).map((chain) => {
    const contracts = resolveChainContracts(config, chain);
    const base = {
      id: chain.id,
      sweeperAddress: contracts.sweeperAddress,
      receiverAddress: contracts.fastSwapAddress,
      confirmations: chain.confirmations ?? config.sweepNode.confirmations,
      logScanOverlap: config.sweepNode.logScanOverlap,
      sweepBatchSize: 50,
    };
    if (chain.type === "evm") {
      if (!chain.rpcUrl) throw new Error(`${chain.key}: rpcUrl required`);
      return {
        ...base,
        type: "evm" as const,
        rpcUrl: chain.rpcUrl,
        privateKey: requireEnv("SWEEP_EVM_PRIVATE_KEY"),
        startBlock: chain.startBlock ?? 0,
      };
    }
    if (!chain.fullHost && !chain.rpcUrl) throw new Error(`${chain.key}: fullHost required`);
    return {
      ...base,
      type: "tron" as const,
      fullHost: chain.fullHost ?? chain.rpcUrl!,
      privateKey: requireEnv("SWEEP_TRON_PRIVATE_KEY"),
      startTimestamp: chain.startTimestamp ?? 0,
      feeLimit: chain.feeLimit,
      eventPollLimit: 200,
    };
  });

  return {
    webServer: {
      baseUrl: apiPublicUrl,
      nodeApiKey: signingSecret,
      pageLimit: config.sweepNode.pageLimit,
    },
    cache: { sqlitePath: config.sweepNode.sqlitePath },
    pollIntervalMs: config.sweepNode.pollIntervalMs,
    reconcileReceiverLimitPerChain: 500,
    auditLogPath: config.nodes.sweep.auditLogPath,
    signingSecret,
    chains,
  };
}
