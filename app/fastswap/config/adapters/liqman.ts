import type { LiquidityManagerConfig, ChainConfig, ManagedReceiver, TokenBand } from "../../../../LiquidityManager/shared/types.js";
import type { FastSwapConfigFile, FastSwapChainDefinition } from "../types.js";
import { getActiveChainDefinitions, resolveChainContracts } from "../load.js";

export function toLiquidityManagerConfig(config: FastSwapConfigFile): LiquidityManagerConfig {
  const chains = getActiveChainDefinitions(config)
    .filter((chain) => chain.liquidity)
    .map((chain) => toLiqManChain(config, chain));

  if (chains.length === 0) throw new Error("No active chains with liquidity config");

  return {
    chains,
    economics: { ...config.liquidityManager.economics },
    pollIntervalMs: config.liquidityManager.pollIntervalMs,
    sqlitePath: config.liquidityManager.sqlitePath,
  };
}

function toLiqManChain(config: FastSwapConfigFile, chain: FastSwapChainDefinition): ChainConfig {
  const liquidity = chain.liquidity!;
  const contracts = resolveChainContracts(config, chain);
  if (!contracts.liquidityManagerAddress) {
    throw new Error(`${chain.key}: liquidityManagerAddress required`);
  }
  if (!chain.router) throw new Error(`${chain.key}: router required`);

  const receivers: ManagedReceiver[] = liquidity.receivers.map((receiver) => ({
    address: receiver.address ?? contracts.fastSwapAddress,
    tokens: receiver.tokens.map(
      (token): TokenBand => ({
        symbol: token.symbol,
        address: token.address,
        decimals: token.decimals,
        isStable: token.isStable,
        floor: token.floor,
        target: token.target,
        ceiling: token.ceiling,
      })
    ),
  }));

  return {
    key: chain.key,
    id: chain.id,
    type: chain.type,
    nativeSymbol: chain.tokens.find((t) => t.isNative)?.symbol ?? "NATIVE",
    rpcUrl: chain.rpcUrl,
    fullHost: chain.fullHost ?? chain.rpcUrl,
    feeLimit: chain.feeLimit,
    liquidityManager: contracts.liquidityManagerAddress,
    reserveStable: liquidity.reserveStable,
    router: chain.router,
    aggregatorSlug: chain.aggregatorSlug ?? chain.key,
    nativeSentinel: chain.nativeSentinel,
    receivers,
    explorerUrl: chain.explorerUrl,
  };
}
