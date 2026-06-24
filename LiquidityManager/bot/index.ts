import { JsonRpcProvider } from "ethers";
import { loadFastSwapConfig } from "../../app/fastswap/config/load.js";
import { toLiquidityManagerConfig } from "../../app/fastswap/config/adapters/liqman.js";
import { loadConfig } from "./config.js";
import { bandKey, decideChain } from "./decide.js";
import { decideQueuedSwaps } from "./decide-queue.js";
import { executeChain, executeQueuedSettlements } from "./execute.js";
import { observeChain } from "./observe.js";
import { OpenOceanRouteProvider, SimplePriceFetcher, type PriceFetcher, type RouteProvider } from "./price.js";
import { RebalancerStore } from "./store.js";
import {
  type BandObservation,
  type ChainConfig,
  type DecideContext,
  type LiquidityManagerConfig,
} from "../shared/types.js";

interface Cli {
  configPath: string;
  fastswapConfigPath?: string;
  once: boolean;
  dryRun: boolean;
}

function parseArgs(argv: string[]): Cli {
  const fastswapConfigPath = argValue(argv, "--fastswap-config");
  return {
    configPath: fastswapConfigPath ?? argValue(argv, "--config") ?? "LiquidityManager/config/example.config.json",
    fastswapConfigPath,
    once: argv.includes("--once"),
    dryRun: argv.includes("--dry-run"),
  };
}

function argValue(argv: string[], flag: string): string | undefined {
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : undefined;
}

const log = {
  section: (m: string) => console.log(`\n=== ${m} ===`),
  info: (m: string) => console.log(`   • ${m}`),
  ok: (m: string) => console.log(`   ✓ ${m}`),
  warn: (m: string) => console.log(`   ! ${m}`),
};

async function runCycle(
  config: LiquidityManagerConfig,
  prices: PriceFetcher,
  routes: RouteProvider,
  store: RebalancerStore,
  dryRun: boolean
): Promise<void> {
  const privateKey = process.env.LM_PRIVATE_KEY ?? "";
  const nowSec = Math.floor(Date.now() / 1000);

  for (const chain of config.chains) {
    log.section(`${chain.key} (${chain.type})`);
    try {
      const snapshot = await observeChain(chain);
      const observations = await buildObservations(chain, snapshot.balances, prices);

      const breachedKeys = observations
        .filter((o) => o.balance < BigInt(o.token.floor) || o.balance > BigInt(o.token.ceiling))
        .map((o) => bandKey(o.receiver, o.token));
      const breachSince = store.syncBreaches(breachedKeys, nowSec);

      const gas = await estimateGasCostUsd(chain, prices);
      const ctx: DecideContext = {
        economics: config.economics,
        reserve: chain.reserveStable,
        reserveBalance: snapshot.reserveBalance,
        reservePriceUsd: 1,
        gasCostUsd: gas.usd,
        nowSec,
        cooldowns: store.getCooldowns(),
        breachSince,
      };

      const bandActions = decideChain(observations, ctx);
      const queueActions = decideQueuedSwaps(snapshot.queuedSwaps, snapshot, observations, ctx);
      const fundActions = [...bandActions, ...queueActions.filter((a) => a.kind !== "processQueued")];
      const settleActions = queueActions.filter((a) => a.kind === "processQueued");

      if (fundActions.length === 0 && settleActions.length === 0) {
        const queueNote =
          snapshot.queuedSwaps.length > 0
            ? ` — ${snapshot.queuedSwaps.length} queued swap(s) awaiting liquidity`
            : "";
        log.ok(`in band, queue idle (reserve ${chain.reserveStable.symbol}, gas≈$${gas.usd.toFixed(3)})${queueNote}`);
        continue;
      }

      const forced =
        bandActions.some((a) => a.reason.includes("staleness") || a.reason.includes("risk cap")) ||
        settleActions.length > 0;
      if (chain.type !== "tron" && config.economics.maxGasPriceGwei && gas.gasPriceGwei && !forced) {
        if (gas.gasPriceGwei > config.economics.maxGasPriceGwei) {
          log.warn(`gas ${gas.gasPriceGwei.toFixed(1)} gwei over ceiling ${config.economics.maxGasPriceGwei} — deferring`);
          continue;
        }
      }

      if (snapshot.queuedSwaps.length > 0) {
        log.info(`queued swaps: ${snapshot.queuedSwaps.length} on receiver(s)`);
      }

      for (const a of fundActions) {
        log.info(
          `${a.kind.toUpperCase()} ${formatAmount(a.amount)} ${a.tokenSymbol}${a.tokenOutSymbol ? `→${a.tokenOutSymbol}` : ""} ($${a.notionalUsd.toFixed(2)}) — ${a.reason}`
        );
      }
      for (const a of settleActions) {
        log.info(`PROCESSQUEUED ${a.swapId?.slice(0, 18)}… ${a.tokenSymbol} ($${a.notionalUsd.toFixed(2)}) — ${a.reason}`);
      }

      if (fundActions.length > 0) {
        const result = await executeChain({
          chain,
          actions: fundActions,
          routes,
          slippageBps: config.economics.slippageBps,
          privateKey,
          dryRun,
        });
        if (result.dryRun) {
          log.warn(`dry-run: ${result.tuples.length} fund action(s) prepared, not submitted`);
        } else {
          log.ok(`rebalance submitted: ${result.txHash}`);
          for (const a of fundActions) store.recordAction(chain.key, a, nowSec, result.txHash);
        }
      }

      if (settleActions.length > 0) {
        const hashes = await executeQueuedSettlements({ chain, actions: settleActions, privateKey, dryRun });
        if (dryRun) {
          log.warn(`dry-run: ${settleActions.length} processQueued call(s) prepared, not submitted`);
        } else {
          for (let i = 0; i < settleActions.length; i++) {
            log.ok(`processQueued submitted: ${hashes[i]}`);
            store.recordAction(chain.key, settleActions[i], nowSec, hashes[i]);
          }
        }
      }
    } catch (error) {
      log.warn(`cycle failed: ${(error as Error).message || String(error)}`);
    }
  }
}

async function buildObservations(
  chain: ChainConfig,
  balances: Map<string, bigint>,
  prices: PriceFetcher
): Promise<BandObservation[]> {
  const observations: BandObservation[] = [];
  for (const receiver of chain.receivers) {
    for (const token of receiver.tokens) {
      const balance = balances.get(bandKey(receiver.address, token)) ?? 0n;
      const priceUsd = token.isStable ? 1 : await prices.priceUsd(token.symbol);
      observations.push({ receiver: receiver.address, token, balance, priceUsd });
    }
  }
  return observations;
}

async function estimateGasCostUsd(
  chain: ChainConfig,
  prices: PriceFetcher
): Promise<{ usd: number; gasPriceGwei?: number }> {
  if (chain.type === "tron") return { usd: 1 }; // energy is mostly pre-staked; small constant
  try {
    const provider = new JsonRpcProvider(chain.rpcUrl);
    const fee = await provider.getFeeData();
    const gasPrice = fee.maxFeePerGas ?? fee.gasPrice ?? 0n;
    const gasUnits = 300_000n; // rough rebalance batch cost
    const nativeWhole = Number(gasPrice * gasUnits) / 1e18;
    const nativePrice = await prices.priceUsd(chain.nativeSymbol);
    return { usd: nativeWhole * nativePrice, gasPriceGwei: Number(gasPrice) / 1e9 };
  } catch {
    return { usd: 5 };
  }
}

function formatAmount(amount: bigint): string {
  return amount.toString();
}

async function main(): Promise<void> {
  const cli = parseArgs(process.argv.slice(2));
  const config = cli.fastswapConfigPath
    ? toLiquidityManagerConfig(loadFastSwapConfig(cli.fastswapConfigPath))
    : loadConfig(cli.configPath);
  const prices = new SimplePriceFetcher();
  const routes = new OpenOceanRouteProvider();
  const store = new RebalancerStore(config.sqlitePath ?? "liquidity-manager.db");

  log.section("LiquidityManager — scan, decide, act");
  log.info(`config: ${cli.fastswapConfigPath ?? cli.configPath}`);
  log.info(`mode: ${cli.dryRun ? "dry-run" : "live"}${cli.once ? " (single cycle)" : ""}`);

  do {
    await runCycle(config, prices, routes, store, cli.dryRun);
    if (!cli.once) await new Promise((r) => setTimeout(r, config.pollIntervalMs ?? 60_000));
  } while (!cli.once);

  store.close();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
