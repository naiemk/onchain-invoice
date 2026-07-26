#!/usr/bin/env node
/**
 * End-to-end smoke test on testnet (Sepolia + BSC testnet + TRON Nile).
 * Requires completed bootstrap: deploy → deploy-tokens → configure-all → seed.
 */
import { Contract, ZeroAddress, formatUnits } from "ethers";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FastSwapServer } from "../server/server.js";
import { buildFastSwapServerOptions } from "../server/bootstrap.js";
import { relaySwapOnTarget, type RelayChain } from "../nodes/relay-node/index.js";
import { OnchainInvoiceSdk } from "../../../src/sdk.js";
import { TronInvoiceSdk } from "../../../src/tron.js";
import type { FastSwapInvoice, FastSwapQuote, FastSwapStatus } from "../shared/types.js";
import { getChainDefinition, resolveConfigPath } from "../config/load.js";
import { applyOperatorEnvDefaults, reloadConfig } from "./bootstrap.js";
import {
  ERC20_FULL_ABI,
  TRON_ERC20_ABI,
  makeEvm,
  makeTron,
  sleep,
  waitTron,
} from "../../../fastSwapDemo/integration/live-helpers.js";
import { readArtifact } from "./artifacts.js";

const PACK_USD = "100000";

type Asset = { symbol: string; decimals: number; quoteToken: string; onchain?: string };
type RuntimeChain = {
  key: string;
  id: string;
  type: "evm" | "tron";
  name: string;
  fastSwap: string;
  sweeper: string;
  native: Asset;
  stable: Asset;
  rpcUrl?: string;
  fullHost?: string;
  feeLimit?: number;
};

async function main() {
  applyOperatorEnvDefaults();
  const configPath = resolveConfigPath(readFlag("--config"));
  await runTestnetSmoke(configPath);
}

export async function runTestnetSmoke(configPath?: string) {
  applyOperatorEnvDefaults();
  const path = resolveConfigPath(configPath);
  const config = reloadConfig(path);
  const evmPk = process.env.EVM_PRIVATE_KEY!;
  const tronPk = process.env.TRON_PRIVATE_KEY ?? evmPk;

  const runtimes = buildRuntimes(config);
  const sepolia = must(runtimes, "sepolia");
  const bsc = must(runtimes, "bscTestnet");
  const tron = must(runtimes, "tron");

  const dir = await mkdtemp(join(tmpdir(), "fastswap-smoke-"));
  const options = buildFastSwapServerOptions({
    ...config,
    server: { ...config.server, sqlitePath: join(dir, "api.sqlite") },
  });
  const server = new FastSwapServer(options);
  const addr = await server.run("127.0.0.1", 0);
  const apiBase = `http://127.0.0.1:${addr.port}`;

  try {
    console.log(`\n=== FastSwap testnet smoke — ${apiBase} ===\n`);
    await runSwap(apiBase, config, sepolia, tron, sepolia.native, tron.native, evmPk, tronPk);
    await runSwap(apiBase, config, tron, sepolia, tron.native, sepolia.native, evmPk, tronPk);
    await runSwap(apiBase, config, sepolia, bsc, sepolia.stable, bsc.stable, evmPk, tronPk);
    await runSwap(apiBase, config, bsc, tron, bsc.stable, tron.stable, evmPk, tronPk);
    console.log("\n✓ All smoke scenarios passed\n");
  } finally {
    await server.close();
    await rm(dir, { recursive: true, force: true });
  }
}

function buildRuntimes(config: ReturnType<typeof reloadConfig>): RuntimeChain[] {
  return config["active-chains"].map((key) => {
    const chain = getChainDefinition(config, key);
    const contracts = chain.type === "tron" ? chain.contracts! : config.deploy.contracts;
    const native = chain.tokens.find((t) => t.isNative)!;
    const stable = chain.tokens.find((t) => t.symbol === "USDT")!;
    return {
      key,
      id: chain.id,
      type: chain.type,
      name: chain.name,
      fastSwap: contracts.fastSwapAddress,
      sweeper: contracts.sweeperAddress,
      rpcUrl: chain.rpcUrl,
      fullHost: chain.fullHost ?? chain.rpcUrl,
      feeLimit: chain.feeLimit,
      native: { symbol: native.symbol, decimals: native.decimals, quoteToken: ZeroAddress },
      stable: { symbol: stable.symbol, decimals: stable.decimals, quoteToken: stable.address!, onchain: stable.address! },
    };
  });
}

async function runSwap(
  apiBase: string,
  config: ReturnType<typeof reloadConfig>,
  source: RuntimeChain,
  target: RuntimeChain,
  send: Asset,
  recv: Asset,
  evmPk: string,
  tronPk: string
) {
  console.log(`\n── ${source.name} ${send.symbol} → ${target.name} ${recv.symbol} ──`);
  const recipient = target.type === "evm" ? makeEvm(target.rpcUrl ?? config.chains.find((c) => c.key === target.key)!.rpcUrl!, evmPk).address : makeTron(target.fullHost!, tronPk).address;

  const quote = await api<FastSwapQuote>(apiBase, "POST", "/quotes", {
    sourceChainId: source.id,
    sourceToken: send.quoteToken,
    targetChainId: target.id,
    targetToken: recv.quoteToken,
    recipient,
    usdAmountMicros: PACK_USD,
  });
  const invoice = await api<FastSwapInvoice>(apiBase, "POST", "/invoices", { quoteId: quote.quoteId });
  const sourceAmount = BigInt(quote.sourceAmount);
  const targetAmount = BigInt(quote.targetAmount);
  console.log(`  pay ${fmt(sourceAmount, send.decimals, send.symbol)} → ${fmt(targetAmount, recv.decimals, recv.symbol)}`);

  await pay(source, send, invoice.invoiceAddress, sourceAmount, evmPk, tronPk);
  await sweep(source, send, invoice, evmPk, tronPk);
  await topUpTarget(target, recv, targetAmount, evmPk, tronPk);
  await relaySwapOnTarget(relayChain(target, evmPk, tronPk), invoice.invoiceId, invoice.data);
  console.log(`  ✓ ${await pollStatus(apiBase, invoice.invoiceId, "complete")}`);
}

async function pay(chain: RuntimeChain, asset: Asset, to: string, amount: bigint, evmPk: string, tronPk: string) {
  if (chain.type === "tron") {
    const tron = makeTron(chain.fullHost!, tronPk);
    if (!asset.onchain) {
      const res = await tron.tronWeb.trx.sendTransaction(to, Number(amount));
      await waitTron(tron.tronWeb, res.txid ?? res.transaction?.txID);
    } else {
      const c = tron.tronWeb.contract(TRON_ERC20_ABI as never, asset.onchain);
      await waitTron(tron.tronWeb, await c.transfer(to, amount.toString()).send({ feeLimit: chain.feeLimit ?? 150_000_000 }));
    }
    return;
  }
  const evm = makeEvm(chain.rpcUrl!, evmPk);
  if (!asset.onchain) await (await evm.wallet.sendTransaction({ to, value: amount })).wait();
  else await (await new Contract(asset.onchain, ERC20_FULL_ABI, evm.wallet).transfer(to, amount)).wait();
}

async function sweep(chain: RuntimeChain, asset: Asset, invoice: FastSwapInvoice, evmPk: string, tronPk: string) {
  if (chain.type === "tron") {
    const tron = makeTron(chain.fullHost!, tronPk);
    const sdk = new TronInvoiceSdk({ tronWeb: tron.tronWeb, sweeperAddress: chain.sweeper, feeLimit: chain.feeLimit ?? 150_000_000 });
    await waitTron(tron.tronWeb, (await sdk.sweepInvoice(invoice.invoiceAddress, { encodedInvoiceParams: invoice.data, token: asset.onchain })).txId);
    return;
  }
  const evm = makeEvm(chain.rpcUrl!, evmPk);
  const sdk = new OnchainInvoiceSdk({ provider: evm.provider, signer: evm.wallet, sweeperAddress: chain.sweeper });
  await (await sdk.sweepInvoice(invoice.invoiceAddress, { encodedInvoiceParams: invoice.data, token: asset.onchain })).tx.wait();
}

async function topUpTarget(target: RuntimeChain, recv: Asset, need: bigint, evmPk: string, tronPk: string) {
  const bal = await receiverBal(target, recv, evmPk, tronPk);
  if (bal >= need) return;
  const topUp = need - bal;
  if (target.type === "tron") {
    const tron = makeTron(target.fullHost!, tronPk);
    const abi = (await readArtifact("contracts/tron/fastswap/TronFastSwapReceiver.sol/TronFastSwapReceiver.json")).abi;
    const fs = await tron.tronWeb.contract(abi as never, target.fastSwap);
    if (!recv.onchain) await fs.addLiquidity(ZeroAddress, topUp.toString()).send({ feeLimit: target.feeLimit ?? 150_000_000, callValue: Number(topUp) });
    else {
      await tron.tronWeb.contract(TRON_ERC20_ABI as never, recv.onchain).approve(target.fastSwap, topUp.toString()).send({ feeLimit: target.feeLimit ?? 150_000_000 });
      await fs.addLiquidity(recv.onchain, topUp.toString()).send({ feeLimit: target.feeLimit ?? 150_000_000 });
    }
    return;
  }
  const evm = makeEvm(target.rpcUrl!, evmPk);
  const abi = (await readArtifact("contracts/fastswap/FastSwapReceiver.sol/FastSwapReceiver.json")).abi;
  const fs = new Contract(target.fastSwap, abi, evm.wallet);
  if (!recv.onchain) await (await fs.addLiquidity(ZeroAddress, topUp, { value: topUp })).wait();
  else {
    await (await new Contract(recv.onchain, ERC20_FULL_ABI, evm.wallet).approve(target.fastSwap, topUp)).wait();
    await (await fs.addLiquidity(recv.onchain, topUp)).wait();
  }
}

async function receiverBal(chain: RuntimeChain, asset: Asset, evmPk: string, tronPk: string): Promise<bigint> {
  if (chain.type === "tron") {
    const tron = makeTron(chain.fullHost!, tronPk);
    if (!asset.onchain) return BigInt(await tron.tronWeb.trx.getBalance(chain.fastSwap));
    return BigInt((await tron.tronWeb.contract(TRON_ERC20_ABI as never, asset.onchain).balanceOf(chain.fastSwap).call()).toString());
  }
  const evm = makeEvm(chain.rpcUrl!, evmPk);
  if (!asset.onchain) return await evm.provider.getBalance(chain.fastSwap);
  return BigInt(await new Contract(asset.onchain, ERC20_FULL_ABI, evm.provider).balanceOf(chain.fastSwap));
}

function relayChain(target: RuntimeChain, evmPk: string, tronPk: string): RelayChain {
  if (target.type === "tron") {
    return { id: target.id, name: target.name, type: "tron", fullHost: target.fullHost!, fastSwapAddress: target.fastSwap, privateKey: tronPk, feeLimit: target.feeLimit ?? 150_000_000, startTimestamp: 0, eventPollLimit: 200, confirmations: 1 };
  }
  return { id: target.id, name: target.name, type: "evm", rpcUrl: target.rpcUrl!, fastSwapAddress: target.fastSwap, privateKey: evmPk, startBlock: 0, confirmations: 1 };
}

async function api<T>(base: string, method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${base}${path}`, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${await res.text()}`);
  return res.json() as Promise<T>;
}

async function pollStatus(base: string, invoiceId: string, want: FastSwapStatus): Promise<FastSwapStatus> {
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    const res = await fetch(`${base}/invoices/${encodeURIComponent(invoiceId)}`);
    if (res.ok) {
      const body = (await res.json()) as { status?: FastSwapStatus; invoice?: FastSwapInvoice };
      if ((body.status ?? body.invoice?.status) === want) return want;
    }
    await sleep(3000);
  }
  throw new Error(`Timeout waiting for ${want}`);
}

function fmt(amount: bigint, decimals: number, symbol: string): string {
  return `${formatUnits(amount, decimals)} ${symbol}`;
}

function must(runtimes: RuntimeChain[], key: string): RuntimeChain {
  const r = runtimes.find((c) => c.key === key);
  if (!r?.fastSwap) throw new Error(`Missing runtime for ${key}`);
  return r;
}

function readFlag(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
