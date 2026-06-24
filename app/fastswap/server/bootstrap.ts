import { Contract, JsonRpcProvider } from "ethers";
import { TronWeb } from "tronweb";
import { createCloudflareTurnstileVerifier } from "../../../src/web-server.js";
import { OnchainInvoiceSdk } from "../../../src/sdk.js";
import { TronInvoiceSdk } from "../../../src/tron.js";
import { collectLiquidity } from "../nodes/liquidity-monitor/index.js";
import { FASTSWAP_RECEIVER_ABI } from "../shared/fastswap-abi.js";
import { TRON_FASTSWAP_RECEIVER_ABI } from "../../../src/tron-abis.js";
import type { FastSwapStatus, FastSwapInvoice } from "../shared/types.js";
import { loadFastSwapConfig, resolveActiveFastSwapChains, resolveConfigPath } from "../config/load.js";
import type { FastSwapChainDefinition } from "../config/types.js";
import { buildMarketQuoteSources } from "./market-quote-source.js";
import { FastSwapServer, type FastSwapServerOptions, type InvoiceAddressSdk } from "./server.js";

import type { FastSwapConfigFile } from "../config/types.js";

function requireSigningSecret(config: FastSwapConfigFile): string {
  const envName = config.server.signingSecretEnv ?? "API_SIGNING_SECRET";
  const secret = process.env[envName] ?? config.server.nodeApiKey;
  if (!secret) throw new Error(`Missing ${envName} (API signing secret)`);
  return secret;
}

export function buildFastSwapServerOptions(config: FastSwapConfigFile): FastSwapServerOptions {
  const resolved = resolveActiveFastSwapChains(config);
  const chains = resolved.map((entry) => entry.fastSwap);
  const captcha = config.server.captcha;

  const invoiceSdksByChainId: Record<string, InvoiceAddressSdk> = {};
  for (const entry of resolved) {
    invoiceSdksByChainId[entry.id] = buildInvoiceSdk(entry);
  }
  const defaultChain = resolved[0];
  if (!defaultChain) throw new Error("No active chains configured");

  const turnstileVerifier =
    captcha.provider === "cloudflare-turnstile" && captcha.secretKey
      ? createCloudflareTurnstileVerifier(captcha.secretKey)
      : undefined;

  return {
    sqlitePath: config.server.sqlitePath,
    auditLogPath: config.server.auditLogPath,
    signingSecret: requireSigningSecret(config),
    invoiceSdk: invoiceSdksByChainId[defaultChain.id],
    invoiceSdksByChainId,
    chains,
    packs: config.quote.packsUsdMicros.map((usdAmountMicros: string) => ({ usdAmountMicros })),
    quoteSources: buildMarketQuoteSources(chains),
    nodeAuthSecret: requireSigningSecret(config),
    feeBps: BigInt(config.quote.feeBps),
    maxDeviationBps: BigInt(config.quote.maxDeviationBps),
    quoteTtlMs: config.quote.quoteTtlSec * 1000,
    requireCaptchaForQuotes: captcha.requireForQuotes === true,
    requireCaptchaForInvoices: captcha.requireForInvoices === true,
    captchaSiteKey: captcha.siteKey,
    verifyCaptcha: turnstileVerifier
      ? (token, context) =>
          turnstileVerifier(token, {
            action: context.action === "quote" ? "session" : "registerInvoice",
            request: context.request,
          })
      : undefined,
    resolveInvoiceStatus: createStatusResolver(resolved),
    resolveLiquidity: () => collectBootstrapLiquidity(resolved),
  };
}

export async function startFastSwapServer(configPath?: string) {
  const config = loadFastSwapConfig(configPath);
  const options = buildFastSwapServerOptions(config);
  const server = new FastSwapServer(options);
  const address = await server.run(config.server.host, config.server.apiPort);
  const publicUrl = config.server.publicUrl ?? `http://${config.server.host}:${address.port}`;
  console.log(`[fastswap-api] listening on ${publicUrl}`);
  return { server, config, publicUrl };
}

function buildInvoiceSdk(chain: { type: string; rpcUrl?: string; fullHost?: string; contracts: { sweeperAddress: string }; feeLimit?: number }): InvoiceAddressSdk {
  if (chain.type === "tron") {
    const tronWeb = new TronWeb({ fullHost: chain.fullHost ?? chain.rpcUrl ?? "" });
    return new TronInvoiceSdk({ tronWeb, sweeperAddress: chain.contracts.sweeperAddress, feeLimit: chain.feeLimit });
  }
  const provider = new JsonRpcProvider(chain.rpcUrl);
  return new OnchainInvoiceSdk({ provider, sweeperAddress: chain.contracts.sweeperAddress });
}

function createStatusResolver(chains: ReturnType<typeof resolveActiveFastSwapChains>) {
  const yamlById = new Map(chains.map((c) => [c.id, c]));
  return async (invoice: FastSwapInvoice): Promise<FastSwapStatus | undefined> => {
    const source = yamlById.get(invoice.sourceChainId);
    const target = yamlById.get(invoice.targetChainId);
    if (!source || !target) return invoice.status;

    const paid = await readSourcePayment(source, invoice.invoiceId);
    if (paid === 0n) return "waiting_payment";

    const state = await readTargetSwapState(target, invoice.invoiceId);
    if (state.processed) return "complete";
    if (state.queued) return "queued";
    if (state.relayed) return "relaying";
    return "paid";
  };
}

async function readSourcePayment(chain: FastSwapChainDefinition & { contracts: { fastSwapAddress: string } }, invoiceId: string) {
  if (chain.type === "tron") {
    const tronWeb = new TronWeb({ fullHost: chain.fullHost ?? chain.rpcUrl ?? "" });
    const contract = await tronWeb.contract(TRON_FASTSWAP_RECEIVER_ABI as never, chain.contracts.fastSwapAddress);
    const payment = await contract.invoicePayment(invoiceId).call();
    return BigInt(payment.amount.toString());
  }
  const provider = new JsonRpcProvider(chain.rpcUrl);
  const contract = new Contract(
    chain.contracts.fastSwapAddress,
    ["function invoicePayment(bytes32 invoiceId) view returns (address token,uint256 amount,address forwarder)"],
    provider
  );
  const payment = await contract.invoicePayment(invoiceId);
  return BigInt(payment.amount.toString());
}

async function readTargetSwapState(chain: FastSwapChainDefinition & { contracts: { fastSwapAddress: string } }, swapId: string) {
  if (chain.type === "tron") {
    const tronWeb = new TronWeb({ fullHost: chain.fullHost ?? chain.rpcUrl ?? "" });
    const contract = await tronWeb.contract(TRON_FASTSWAP_RECEIVER_ABI as never, chain.contracts.fastSwapAddress);
    const state = await contract.swapState(swapId).call();
    return { relayed: Boolean(state.relayed), processed: Boolean(state.processed), queued: Boolean(state.queued) };
  }
  const provider = new JsonRpcProvider(chain.rpcUrl);
  const contract = new Contract(chain.contracts.fastSwapAddress, FASTSWAP_RECEIVER_ABI, provider);
  const state = await contract.swapState(swapId);
  return { relayed: state.relayed, processed: state.processed, queued: state.queued };
}

async function collectBootstrapLiquidity(chains: ReturnType<typeof resolveActiveFastSwapChains>) {
  const summaries = await Promise.all(
    chains.map((chain) =>
      collectLiquidity({
        id: chain.id,
        type: chain.type,
        rpcUrl: chain.rpcUrl,
        fullHost: chain.fullHost ?? chain.rpcUrl,
        fastSwapAddress: chain.contracts.fastSwapAddress,
        tokens: chain.tokens.map((token) => ({
          symbol: token.symbol,
          address: token.isNative ? undefined : token.address,
          minLiquidity: token.minLiquidity ?? "0",
        })),
      }).catch(() => [])
    )
  );
  return summaries.flat();
}

export const DEFAULT_MAIN_CONFIG = resolveConfigPath();
