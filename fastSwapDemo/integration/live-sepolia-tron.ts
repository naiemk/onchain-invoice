/**
 * Live integration test: Sepolia (EVM) <-> TRON Nile.
 *
 * Deploys the FastSwap stack on both testnets (cached so we only pay gas when the
 * contract bytecode changes), runs a series of realistic cross-chain swap scenarios
 * through the real FastSwap HTTP API, and finally returns all funds to the wallet.
 *
 * The same wallet plays every role (user, sweep node, liquidity provider, relay node,
 * admin) so all value nets back to it; only gas/energy is spent. Every step prints a
 * human-readable line so the logs alone tell the story of the product working.
 *
 *   npm run fastswap:integ            # reuse cached deployments
 *   npm run fastswap:integ -- --fresh # force a full redeploy
 */
import { unlink } from "node:fs/promises";
import { join } from "node:path";
import { Contract, Interface, ZeroAddress, formatUnits } from "ethers";
import { FastSwapServer, type InvoiceAddressSdk } from "../../app/fastswap/server/server.js";
import {
  relaySwapOnTarget,
  type RelayChain,
} from "../../app/fastswap/nodes/relay-node/index.js";
import { FASTSWAP_RECEIVER_ABI } from "../../app/fastswap/shared/fastswap-abi.js";
import { TRON_FASTSWAP_RECEIVER_ABI } from "../../src/tron-abis.js";
import { OnchainInvoiceSdk } from "../../src/sdk.js";
import { TronInvoiceSdk } from "../../src/tron.js";
import type { FastSwapChainConfig, FastSwapInvoice, FastSwapQuote, FastSwapStatus } from "../../app/fastswap/shared/types.js";
import {
  ERC20_FULL_ABI,
  TRON_ERC20_ABI,
  TRON_ZERO_ADDRESS,
  codeHashOf,
  deployEvm,
  deployTron,
  evmHasCode,
  fmt,
  loadCache,
  log,
  makeEvm,
  makeTron,
  readArtifact,
  saveCache,
  sleep,
  tronHasContract,
  waitTron,
  type ChainCache,
  type DeploymentCache,
  type EvmContext,
  type TronContext,
} from "./live-helpers.js";

const SEPOLIA_ID = "11155111";
const NILE_ID = "3448148188";
const PACK_USD_MICROS = "100000"; // $0.10 notional — tiny, to conserve testnet funds
const FEE_BPS = 30n;
const POLL_TIMEOUT_MS = 240_000;

// Static USD prices (micros) keep quoting deterministic and offline.
const ETH_PRICE = "3000000000"; // $3,000
const TRX_PRICE = "300000"; //     $0.30
const USDT_PRICE = "1000000"; //   $1.00

type Asset = {
  kind: "native" | "usdt";
  symbol: string;
  decimals: number;
  /** String used in quote requests / chain config ("native" or token address). */
  quoteToken: string;
  /** Actual on-chain token address used for transfers; undefined for native. */
  onchain?: string;
};

type ChainRuntime = {
  id: string;
  name: string;
  type: "evm" | "tron";
  explorerUrl: string;
  fastSwap: string;
  sweeper: string;
  usdt: string;
  native: Asset;
  stable: Asset;
};

type Ctx = {
  evm: EvmContext;
  tron: TronContext;
  evmPk: string;
  tronPk: string;
  nileHost: string;
  sepoliaRpc: string;
  tronDeployFee: number;
  tronTxFee: number;
  sepolia: ChainRuntime;
  nile: ChainRuntime;
  apiBase: string;
  server: FastSwapServer;
};

/* ================================================================== *
 * Setup
 * ================================================================== */

function loadEnv() {
  const evmPk = requireEnv("EVM_PRIVATE_KEY");
  const tronPk = requireEnv("TRON_PRIVATE_KEY");
  const sepoliaRpc = requireEnv("SEPOLIA_RPC_URL");
  const nileHost = process.env.NILE_FULL_HOST || "https://nile.trongrid.io";
  return { evmPk, tronPk, sepoliaRpc, nileHost };
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}. Provide it via fastSwapDemo/.env`);
  return value;
}

async function assertFunded(ctx: Ctx) {
  log.section("Wallet & funding");
  const ethBal = await ctx.evm.provider.getBalance(ctx.evm.address);
  const trxBal = BigInt(await ctx.tron.tronWeb.trx.getBalance(ctx.tron.address));
  log.info(`Sepolia wallet ${ctx.evm.address}`);
  log.info(`  balance ${fmt(ethBal, 18, "ETH")}`);
  log.info(`TRON Nile wallet ${ctx.tron.address}`);
  log.info(`  balance ${fmt(trxBal, 6, "TRX")}`);
  if (ethBal < 5_000_000_000_000_000n) {
    throw new Error(`Sepolia balance too low (need ~0.005 ETH). Fund ${ctx.evm.address}`);
  }
  if (trxBal < 300_000_000n) {
    throw new Error(`TRON Nile balance too low (need ~300 TRX). Fund ${ctx.tron.address}`);
  }
  log.ok("both wallets funded");
}

/* ================================================================== *
 * Deployment (cached — only pay gas when bytecode/owner/network changes)
 * ================================================================== */

async function deployEvmStack(ctx: Ctx, cache: DeploymentCache, fresh: boolean): Promise<{ fastSwap: string; sweeper: string }> {
  const [impl, proxy, sweeper] = await Promise.all([
    readArtifact("contracts/fastswap/FastSwapReceiver.sol/FastSwapReceiver.json"),
    readArtifact("contracts/proxy/ReceiverProxy.sol/ReceiverProxy.json"),
    readArtifact("contracts/InvoiceSweeper.sol/InvoiceSweeper.json"),
  ]);
  const codeHash = codeHashOf(impl.bytecode, proxy.bytecode, sweeper.bytecode);
  const cached = cache.sepolia;
  const reuse =
    !fresh &&
    cached?.stack?.codeHash === codeHash &&
    cached?.owner === ctx.evm.address &&
    cached?.network === SEPOLIA_ID &&
    (await evmHasCode(ctx.evm.provider, cached.stack.fastSwap)) &&
    (await evmHasCode(ctx.evm.provider, cached.stack.sweeper));
  if (reuse && cached?.stack) {
    log.ok(`Sepolia stack — bytecode unchanged, reusing ${cached.stack.fastSwap}`);
    return { fastSwap: cached.stack.fastSwap, sweeper: cached.stack.sweeper };
  }
  log.step(`Sepolia stack — ${deployReason(cached, codeHash, ctx.evm.address, SEPOLIA_ID)}, deploying…`);
  const implAddr = await deployEvm(ctx.evm.wallet, impl);
  const initData = new Interface(["function initialize(address initialOwner)"]).encodeFunctionData("initialize", [ctx.evm.address]);
  const proxyAddr = await deployEvm(ctx.evm.wallet, proxy, implAddr, initData);
  const sweeperAddr = await deployEvm(ctx.evm.wallet, sweeper, proxyAddr);
  cache.sepolia = { ...cache.sepolia, network: SEPOLIA_ID, owner: ctx.evm.address, stack: { codeHash, fastSwap: proxyAddr, sweeper: sweeperAddr, deployedAt: new Date().toISOString() } };
  await saveCache(cache);
  log.ok(`deployed fastSwap ${proxyAddr}, sweeper ${sweeperAddr}`);
  return { fastSwap: proxyAddr, sweeper: sweeperAddr };
}

async function deployTronStack(ctx: Ctx, cache: DeploymentCache, fresh: boolean): Promise<{ fastSwap: string; sweeper: string }> {
  const [impl, proxy, sweeper] = await Promise.all([
    readArtifact("contracts/tron/fastswap/TronFastSwapReceiver.sol/TronFastSwapReceiver.json"),
    readArtifact("contracts/proxy/ReceiverProxy.sol/ReceiverProxy.json"),
    readArtifact("contracts/tron/TronInvoiceSweeper.sol/TronInvoiceSweeper.json"),
  ]);
  const codeHash = codeHashOf(impl.bytecode, proxy.bytecode, sweeper.bytecode);
  const cached = cache.nile;
  const reuse =
    !fresh &&
    cached?.stack?.codeHash === codeHash &&
    cached?.owner === ctx.tron.address &&
    cached?.network === NILE_ID &&
    (await tronHasContract(ctx.tron.tronWeb, cached.stack.fastSwap)) &&
    (await tronHasContract(ctx.tron.tronWeb, cached.stack.sweeper));
  if (reuse && cached?.stack) {
    log.ok(`Nile stack — bytecode unchanged, reusing ${cached.stack.fastSwap}`);
    return { fastSwap: cached.stack.fastSwap, sweeper: cached.stack.sweeper };
  }
  log.step(`Nile stack — ${deployReason(cached, codeHash, ctx.tron.address, NILE_ID)}, deploying…`);
  const ownerHex = ctx.tron.tronWeb.address.toHex(ctx.tron.address).replace(/^41/, "0x");
  const implAddr = await deployTron(ctx.tron.tronWeb, impl, ctx.tronDeployFee);
  const initData = new Interface(["function initialize(address initialOwner)"]).encodeFunctionData("initialize", [ownerHex]);
  const proxyAddr = await deployTron(ctx.tron.tronWeb, proxy, ctx.tronDeployFee, [implAddr, initData]);
  const sweeperAddr = await deployTron(ctx.tron.tronWeb, sweeper, ctx.tronDeployFee, [proxyAddr]);
  cache.nile = { ...cache.nile, network: NILE_ID, owner: ctx.tron.address, stack: { codeHash, fastSwap: proxyAddr, sweeper: sweeperAddr, deployedAt: new Date().toISOString() } };
  await saveCache(cache);
  log.ok(`deployed fastSwap ${proxyAddr}, sweeper ${sweeperAddr}`);
  return { fastSwap: proxyAddr, sweeper: sweeperAddr };
}

async function deployEvmUsdt(ctx: Ctx, cache: DeploymentCache, fresh: boolean): Promise<string> {
  const mock = await readArtifact("contracts/mocks/MockERC20.sol/MockERC20.json");
  const codeHash = codeHashOf(mock.bytecode);
  const cached = cache.sepolia;
  if (!fresh && cached?.usdt?.codeHash === codeHash && (await evmHasCode(ctx.evm.provider, cached.usdt.address))) {
    log.ok(`Sepolia USDT — reusing ${cached.usdt.address}`);
    return cached.usdt.address;
  }
  log.step("Sepolia USDT — deploying MockERC20…");
  const addr = await deployEvm(ctx.evm.wallet, mock, "Tether USD", "USDT", 6);
  await (await new Contract(addr, ERC20_FULL_ABI, ctx.evm.wallet).mint(ctx.evm.address, 1_000_000_000n)).wait();
  cache.sepolia = { ...cache.sepolia, network: SEPOLIA_ID, owner: ctx.evm.address, usdt: { codeHash, address: addr, deployedAt: new Date().toISOString() } };
  await saveCache(cache);
  log.ok(`deployed + minted 1000 USDT at ${addr}`);
  return addr;
}

async function deployTronUsdt(ctx: Ctx, cache: DeploymentCache, fresh: boolean): Promise<string> {
  const mock = await readArtifact("contracts/mocks/MockERC20.sol/MockERC20.json");
  const codeHash = codeHashOf(mock.bytecode);
  const cached = cache.nile;
  if (!fresh && cached?.usdt?.codeHash === codeHash && (await tronHasContract(ctx.tron.tronWeb, cached.usdt.address))) {
    log.ok(`Nile USDT — reusing ${cached.usdt.address}`);
    return cached.usdt.address;
  }
  log.step("Nile USDT — deploying MockERC20…");
  const addr = await deployTron(ctx.tron.tronWeb, mock, ctx.tronDeployFee, ["Tether USD", "USDT", 6]);
  const trc20 = ctx.tron.tronWeb.contract(TRON_ERC20_ABI as never, addr);
  await waitTron(ctx.tron.tronWeb, await trc20.mint(ctx.tron.address, "1000000000").send({ feeLimit: ctx.tronTxFee }));
  cache.nile = { ...cache.nile, network: NILE_ID, owner: ctx.tron.address, usdt: { codeHash, address: addr, deployedAt: new Date().toISOString() } };
  await saveCache(cache);
  log.ok(`deployed + minted 1000 USDT at ${addr}`);
  return addr;
}

function deployReason(cached: ChainCache | undefined, codeHash: string, owner: string, network: string): string {
  if (!cached?.stack) return "no cache";
  if (cached.stack.codeHash !== codeHash) return "bytecode changed";
  if (cached.owner !== owner) return "owner changed";
  if (cached.network !== network) return "network changed";
  return "code missing on-chain";
}

/* ================================================================== *
 * In-process FastSwap server (the real product API)
 * ================================================================== */

function buildChains(ctx: Ctx): FastSwapChainConfig[] {
  const chain = (rt: ChainRuntime): FastSwapChainConfig => ({
    id: rt.id,
    type: rt.type,
    name: rt.name,
    nativeSymbol: rt.native.symbol,
    sweeperAddress: rt.sweeper,
    fastSwapAddress: rt.fastSwap,
    explorerUrl: rt.explorerUrl,
    tokens: [
      { symbol: rt.native.symbol, chainId: rt.id, decimals: rt.native.decimals, isNative: true, priceUsdMicros: rt.id === SEPOLIA_ID ? ETH_PRICE : TRX_PRICE },
      { symbol: rt.stable.symbol, chainId: rt.id, address: rt.usdt, decimals: rt.stable.decimals, priceUsdMicros: USDT_PRICE },
    ],
  });
  return [chain(ctx.sepolia), chain(ctx.nile)];
}

async function startServer(ctx: Ctx) {
  const sqlitePath = join(process.cwd(), "fastSwapDemo", "state", "live-integ.sqlite");
  await unlink(sqlitePath).catch(() => undefined);

  const evmSdk = new OnchainInvoiceSdk({ provider: ctx.evm.provider, signer: ctx.evm.wallet, sweeperAddress: ctx.sepolia.sweeper });
  const tronSdk = new TronInvoiceSdk({ tronWeb: ctx.tron.tronWeb, sweeperAddress: ctx.nile.sweeper, feeLimit: ctx.tronTxFee });
  const invoiceSdksByChainId: Record<string, InvoiceAddressSdk> = { [SEPOLIA_ID]: evmSdk, [NILE_ID]: tronSdk };

  const server = new FastSwapServer({
    sqlitePath,
    invoiceSdk: evmSdk,
    invoiceSdksByChainId,
    chains: buildChains(ctx),
    packs: [{ usdAmountMicros: PACK_USD_MICROS }],
    feeBps: FEE_BPS,
    maxDeviationBps: 100n,
    requireCaptchaForQuotes: false,
    requireCaptchaForInvoices: false,
    resolveInvoiceStatus: (invoice) => resolveStatus(ctx, invoice),
  });
  const address = await server.run("127.0.0.1", 0);
  ctx.server = server;
  ctx.apiBase = `http://127.0.0.1:${address.port}`;
  log.ok(`FastSwap API listening on ${ctx.apiBase}`);
}

/** Chain-type-aware status resolver: reads source payment + target swap state on-chain. */
async function resolveStatus(ctx: Ctx, invoice: FastSwapInvoice): Promise<FastSwapStatus> {
  const source = runtimeFor(ctx, invoice.sourceChainId);
  const target = runtimeFor(ctx, invoice.targetChainId);
  if (!source || !target) return invoice.status;
  try {
    const paidAmount = await readSourcePayment(ctx, source, invoice.invoiceId);
    if (paidAmount === 0n) return "waiting_payment";

    const state = await readSwapState(ctx, target, invoice.invoiceId);
    if (state.processed) return "complete";
    if (state.queued) return "queued";
    if (state.relayed) return "relaying";
    return "paid";
  } catch {
    // Transient RPC hiccup — keep the last known status so polling can continue.
    return invoice.status;
  }
}

async function readSourcePayment(ctx: Ctx, chain: ChainRuntime, invoiceId: string): Promise<bigint> {
  if (chain.type === "tron") {
    const contract = await ctx.tron.tronWeb.contract(TRON_FASTSWAP_RECEIVER_ABI as never, chain.fastSwap);
    const payment = await contract.invoicePayment(invoiceId).call();
    return BigInt((payment.amount ?? payment[1]).toString());
  }
  const contract = new Contract(
    chain.fastSwap,
    ["function invoicePayment(bytes32) view returns (address token,uint256 amount,address forwarder,bool paid)"],
    ctx.evm.provider
  );
  const payment = await contract.invoicePayment(invoiceId);
  return BigInt(payment.amount);
}

async function readSwapState(ctx: Ctx, chain: ChainRuntime, swapId: string): Promise<{ relayed: boolean; processed: boolean; queued: boolean }> {
  if (chain.type === "tron") {
    const contract = await ctx.tron.tronWeb.contract(TRON_FASTSWAP_RECEIVER_ABI as never, chain.fastSwap);
    const state = await contract.swapState(swapId).call();
    return { relayed: Boolean(state.relayed), processed: Boolean(state.processed), queued: Boolean(state.queued) };
  }
  const contract = new Contract(chain.fastSwap, FASTSWAP_RECEIVER_ABI, ctx.evm.provider);
  const state = await contract.swapState(swapId);
  return { relayed: Boolean(state.relayed), processed: Boolean(state.processed), queued: Boolean(state.queued) };
}

/* ================================================================== *
 * The reusable swap pipeline (user → sweep → LP → relay → verify)
 * ================================================================== */

async function runSwap(ctx: Ctx, opts: { title: string; source: ChainRuntime; target: ChainRuntime; send: Asset; recv: Asset; provision?: boolean }) {
  const { source, target, send, recv } = opts;
  const provision = opts.provision !== false;
  log.scenario(opts.title);

  const recipient = walletOn(ctx, target);
  log.step(`Quote ${send.symbol} on ${source.name} → ${recv.symbol} on ${target.name}`);
  const quote = await api<FastSwapQuote>(ctx, "POST", "/quotes", {
    sourceChainId: source.id,
    sourceToken: send.quoteToken,
    targetChainId: target.id,
    targetToken: recv.quoteToken,
    recipient,
    usdAmountMicros: PACK_USD_MICROS,
  });
  const sourceAmount = BigInt(quote.sourceAmount);
  const targetAmount = BigInt(quote.targetAmount);
  log.ok(`pay ${fmt(sourceAmount, send.decimals, send.symbol)} → receive ${fmt(targetAmount, recv.decimals, recv.symbol)} (quote ${quote.quoteId.slice(0, 8)})`);

  log.step("Create invoice (forwarder address derived by the source sweeper)");
  const invoice = await api<FastSwapInvoice>(ctx, "POST", "/invoices", { quoteId: quote.quoteId });
  log.ok(`invoice ${invoice.invoiceId.slice(0, 12)}… → forwarder ${invoice.invoiceAddress}`);

  log.step(`Pay invoice: send ${fmt(sourceAmount, send.decimals, send.symbol)} to the forwarder`);
  await payForwarder(ctx, source, send, invoice.invoiceAddress, sourceAmount);
  log.ok("user payment confirmed");

  log.step("Sweep node: pull payment into the source receiver (emits SwapRequested)");
  await sweep(ctx, source, send, invoice);
  log.ok("swept — SwapRequested recorded");

  if (provision) {
    log.step(`Liquidity provider: fund ${fmt(targetAmount, recv.decimals, recv.symbol)} on the target receiver`);
    await addLiquidity(ctx, target, recv, targetAmount);
    log.ok("target liquidity in place");
  } else {
    log.step("Queue scenario: drain target receiver so there is no liquidity to settle");
    const existing = await receiverBalance(ctx, target, recv);
    if (existing > 0n) await adminSweep(ctx, target, recv, existing);
    log.ok(`target ${recv.symbol} liquidity emptied (${fmt(existing, recv.decimals, recv.symbol)} returned)`);
  }

  log.step("Relay node: relaySwap on the target chain");
  const relay = await relaySwapOnTarget(relayChain(ctx, target), invoice.invoiceId, invoice.data);
  log.ok(`relay tx ${String(relay.txHash).slice(0, 14)}…`);

  if (!provision) {
    const queued = await pollStatus(ctx, invoice.invoiceId, ["queued"], "queued");
    log.ok(`swap parked as ${queued} (awaiting liquidity)`);
    log.step(`Provide ${fmt(targetAmount, recv.decimals, recv.symbol)} liquidity, then processQueued`);
    await addLiquidity(ctx, target, recv, targetAmount);
    await processQueued(ctx, target, invoice.invoiceId);
    log.ok("queued swap processed");
  }

  log.step("Verify completion via the API");
  const status = await pollStatus(ctx, invoice.invoiceId, ["complete"], "complete");
  log.ok(`status=${status} — delivered ${fmt(targetAmount, recv.decimals, recv.symbol)} to ${recipient}`);
}

async function payForwarder(ctx: Ctx, chain: ChainRuntime, asset: Asset, to: string, amount: bigint) {
  if (chain.type === "tron") {
    if (asset.kind === "native") {
      const res = await ctx.tron.tronWeb.trx.sendTransaction(to, Number(amount));
      await waitTron(ctx.tron.tronWeb, res.txid ?? res.transaction?.txID);
    } else {
      const trc20 = ctx.tron.tronWeb.contract(TRON_ERC20_ABI as never, asset.onchain);
      await waitTron(ctx.tron.tronWeb, await trc20.transfer(to, amount.toString()).send({ feeLimit: ctx.tronTxFee }));
    }
    return;
  }
  if (asset.kind === "native") {
    await (await ctx.evm.wallet.sendTransaction({ to, value: amount })).wait();
  } else {
    await (await new Contract(asset.onchain!, ERC20_FULL_ABI, ctx.evm.wallet).transfer(to, amount)).wait();
  }
}

async function sweep(ctx: Ctx, chain: ChainRuntime, asset: Asset, invoice: FastSwapInvoice) {
  if (chain.type === "tron") {
    const sdk = new TronInvoiceSdk({ tronWeb: ctx.tron.tronWeb, sweeperAddress: chain.sweeper, feeLimit: ctx.tronTxFee });
    const result = await sdk.sweepInvoice(invoice.invoiceAddress, { encodedInvoiceParams: invoice.data, token: asset.onchain });
    await waitTron(ctx.tron.tronWeb, result.txId);
    return;
  }
  const sdk = new OnchainInvoiceSdk({ provider: ctx.evm.provider, signer: ctx.evm.wallet, sweeperAddress: chain.sweeper });
  const result = await sdk.sweepInvoice(invoice.invoiceAddress, { encodedInvoiceParams: invoice.data, token: asset.onchain });
  await result.tx.wait();
}

async function addLiquidity(ctx: Ctx, chain: ChainRuntime, asset: Asset, amount: bigint) {
  if (chain.type === "tron") {
    const contract = ctx.tron.tronWeb.contract(TRON_FASTSWAP_RECEIVER_ABI as never, chain.fastSwap);
    if (asset.kind === "native") {
      await waitTron(ctx.tron.tronWeb, await contract.addLiquidity(TRON_ZERO_ADDRESS, amount.toString()).send({ feeLimit: ctx.tronTxFee, callValue: Number(amount) }));
    } else {
      const trc20 = ctx.tron.tronWeb.contract(TRON_ERC20_ABI as never, asset.onchain);
      await waitTron(ctx.tron.tronWeb, await trc20.approve(chain.fastSwap, amount.toString()).send({ feeLimit: ctx.tronTxFee }));
      await waitTron(ctx.tron.tronWeb, await contract.addLiquidity(asset.onchain, amount.toString()).send({ feeLimit: ctx.tronTxFee }));
    }
    return;
  }
  const contract = new Contract(chain.fastSwap, FASTSWAP_RECEIVER_ABI, ctx.evm.wallet);
  if (asset.kind === "native") {
    await (await contract.addLiquidity(ZeroAddress, amount, { value: amount })).wait();
  } else {
    await (await new Contract(asset.onchain!, ERC20_FULL_ABI, ctx.evm.wallet).approve(chain.fastSwap, amount)).wait();
    await (await contract.addLiquidity(asset.onchain, amount)).wait();
  }
}

async function processQueued(ctx: Ctx, chain: ChainRuntime, swapId: string) {
  if (chain.type === "tron") {
    const contract = ctx.tron.tronWeb.contract(TRON_FASTSWAP_RECEIVER_ABI as never, chain.fastSwap);
    await waitTron(ctx.tron.tronWeb, await contract.processQueued(swapId).send({ feeLimit: ctx.tronTxFee }));
    return;
  }
  await (await new Contract(chain.fastSwap, FASTSWAP_RECEIVER_ABI, ctx.evm.wallet).processQueued(swapId)).wait();
}

/* ================================================================== *
 * Teardown — return every receiver balance back to the wallet
 * ================================================================== */

async function returnAllFunds(ctx: Ctx) {
  log.section("Teardown — returning funds to wallet");
  for (const chain of [ctx.sepolia, ctx.nile]) {
    for (const asset of [chain.native, chain.stable]) {
      try {
        const balance = await receiverBalance(ctx, chain, asset);
        if (balance === 0n) continue;
        await adminSweep(ctx, chain, asset, balance);
        log.ok(`${chain.name}: swept ${fmt(balance, asset.decimals, asset.symbol)} from receiver → wallet`);
      } catch (error) {
        log.warn(`${chain.name} ${asset.symbol}: ${(error as Error).message || String(error)}`);
      }
    }
  }
}

async function adminSweep(ctx: Ctx, chain: ChainRuntime, asset: Asset, amount: bigint) {
  const to = walletOn(ctx, chain);
  if (chain.type === "tron") {
    const contract = ctx.tron.tronWeb.contract(TRON_FASTSWAP_RECEIVER_ABI as never, chain.fastSwap);
    const token = asset.kind === "native" ? TRON_ZERO_ADDRESS : asset.onchain;
    await waitTron(ctx.tron.tronWeb, await contract.adminSweep(token, to, amount.toString()).send({ feeLimit: ctx.tronTxFee }));
    return;
  }
  const contract = new Contract(chain.fastSwap, FASTSWAP_RECEIVER_ABI, ctx.evm.wallet);
  const token = asset.kind === "native" ? ZeroAddress : asset.onchain;
  await (await contract.adminSweep(token, to, amount)).wait();
}

async function receiverBalance(ctx: Ctx, chain: ChainRuntime, asset: Asset): Promise<bigint> {
  if (chain.type === "tron") {
    if (asset.kind === "native") return BigInt(await ctx.tron.tronWeb.trx.getBalance(chain.fastSwap));
    const trc20 = ctx.tron.tronWeb.contract(TRON_ERC20_ABI as never, asset.onchain);
    return BigInt((await trc20.balanceOf(chain.fastSwap).call()).toString());
  }
  if (asset.kind === "native") return ctx.evm.provider.getBalance(chain.fastSwap);
  return new Contract(asset.onchain!, ERC20_FULL_ABI, ctx.evm.provider).balanceOf(chain.fastSwap);
}

/* ================================================================== *
 * Small shared utilities
 * ================================================================== */

async function api<T>(ctx: Ctx, method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
  const response = await fetch(`${ctx.apiBase}${path}`, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${method} ${path} -> ${response.status}: ${text}`);
  return JSON.parse(text) as T;
}

async function pollStatus(ctx: Ctx, invoiceId: string, accept: FastSwapStatus[], label: string): Promise<FastSwapStatus> {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  let last = "";
  while (Date.now() < deadline) {
    try {
      const invoice = await api<FastSwapInvoice>(ctx, "GET", `/invoices/${invoiceId}`);
      if (invoice.status !== last) {
        last = invoice.status;
        log.info(`status → ${invoice.status}`);
      }
      if (accept.includes(invoice.status)) return invoice.status;
      if (invoice.status === "failed") throw new Error(`invoice ${invoiceId} failed`);
    } catch (error) {
      if ((error as Error).message?.includes("failed")) throw error;
      // transient read error — keep polling
    }
    await sleep(4_000);
  }
  throw new Error(`Timed out waiting for '${label}' on ${invoiceId} (last=${last})`);
}

function runtimeFor(ctx: Ctx, chainId: string): ChainRuntime | undefined {
  return [ctx.sepolia, ctx.nile].find((chain) => chain.id === chainId);
}

function walletOn(ctx: Ctx, chain: ChainRuntime): string {
  return chain.type === "tron" ? ctx.tron.address : ctx.evm.address;
}

function relayChain(ctx: Ctx, target: ChainRuntime): RelayChain {
  return target.type === "tron"
    ? { id: target.id, name: target.name, type: "tron", fullHost: ctx.nileHost, fastSwapAddress: target.fastSwap, privateKey: ctx.tronPk, feeLimit: ctx.tronTxFee }
    : { id: target.id, name: target.name, type: "evm", rpcUrl: ctx.sepoliaRpc, fastSwapAddress: target.fastSwap, privateKey: ctx.evmPk };
}

function nativeAsset(symbol: string, decimals: number): Asset {
  return { kind: "native", symbol, decimals, quoteToken: "native" };
}

function usdtAsset(address: string): Asset {
  return { kind: "usdt", symbol: "USDT", decimals: 6, quoteToken: address, onchain: address };
}

/* ================================================================== *
 * Main
 * ================================================================== */

async function main() {
  const fresh = process.argv.includes("--fresh");
  const env = loadEnv();
  log.section("Live FastSwap integration — Sepolia ↔ TRON Nile");
  log.info(`mode: ${fresh ? "FRESH deploy" : "reuse cached deployments"}`);

  const evm = makeEvm(env.sepoliaRpc, env.evmPk);
  const tron = makeTron(env.nileHost, env.tronPk);
  const ctx = {
    evm,
    tron,
    evmPk: env.evmPk,
    tronPk: env.tronPk,
    nileHost: env.nileHost,
    sepoliaRpc: env.sepoliaRpc,
    tronDeployFee: 1_500_000_000,
    tronTxFee: 200_000_000,
  } as unknown as Ctx;

  await assertFunded(ctx);

  const startEth = await evm.provider.getBalance(evm.address);
  const startTrx = BigInt(await tron.tronWeb.trx.getBalance(tron.address));

  log.section("Deploying / reusing FastSwap stacks");
  const cache = await loadCache();
  const [sepoliaStack, nileStack] = [await deployEvmStack(ctx, cache, fresh), await deployTronStack(ctx, cache, fresh)];
  const sepoliaUsdt = await deployEvmUsdt(ctx, cache, fresh);
  const nileUsdt = await deployTronUsdt(ctx, cache, fresh);

  ctx.sepolia = {
    id: SEPOLIA_ID, name: "Sepolia", type: "evm", explorerUrl: "https://sepolia.etherscan.io",
    fastSwap: sepoliaStack.fastSwap, sweeper: sepoliaStack.sweeper, usdt: sepoliaUsdt,
    native: nativeAsset("ETH", 18), stable: usdtAsset(sepoliaUsdt),
  };
  ctx.nile = {
    id: NILE_ID, name: "TRON Nile", type: "tron", explorerUrl: "https://nile.tronscan.org",
    fastSwap: nileStack.fastSwap, sweeper: nileStack.sweeper, usdt: nileUsdt,
    native: nativeAsset("TRX", 6), stable: usdtAsset(nileUsdt),
  };

  log.section("Starting FastSwap API");
  await startServer(ctx);

  try {
    log.section("Running swap scenarios");
    await runSwap(ctx, { title: "Scenario 1 — Sepolia ETH → Nile TRX", source: ctx.sepolia, target: ctx.nile, send: ctx.sepolia.native, recv: ctx.nile.native });
    await runSwap(ctx, { title: "Scenario 2 — Nile TRX → Sepolia ETH", source: ctx.nile, target: ctx.sepolia, send: ctx.nile.native, recv: ctx.sepolia.native });
    await runSwap(ctx, { title: "Scenario 3 — Sepolia USDT → Nile USDT", source: ctx.sepolia, target: ctx.nile, send: ctx.sepolia.stable, recv: ctx.nile.stable });
    await runSwap(ctx, { title: "Scenario 4 — Nile USDT → Sepolia USDT", source: ctx.nile, target: ctx.sepolia, send: ctx.nile.stable, recv: ctx.sepolia.stable });
    await runSwap(ctx, { title: "Scenario 5 — ETH → TRX with the liquidity queue", source: ctx.sepolia, target: ctx.nile, send: ctx.sepolia.native, recv: ctx.nile.native, provision: false });
    log.section("All scenarios passed ✔");
  } finally {
    await returnAllFunds(ctx).catch((error) => log.warn(`teardown error: ${(error as Error).message}`));
    await ctx.server.close().catch(() => undefined);
  }

  const endEth = await evm.provider.getBalance(evm.address);
  const endTrx = BigInt(await tron.tronWeb.trx.getBalance(tron.address));
  log.section("Net cost (gas/energy only — value returned)");
  log.info(`Sepolia: ${fmt(startEth - endEth, 18, "ETH")} spent (now ${formatUnits(endEth, 18)} ETH)`);
  log.info(`TRON Nile: ${fmt(startTrx - endTrx, 6, "TRX")} spent (now ${formatUnits(endTrx, 6)} TRX)`);
  log.ok("done");
}

void (async () => {
  try {
    await main();
  } catch (error) {
    console.error(`\n✖ Integration failed: ${(error as Error).message}`);
    process.exitCode = 1;
  }
})();
