import type { SweepNodeInvoice, TronChainConfig } from "../config.js";
import {
  delegateEnergyToInvoice,
  ensureEnergyForBatch,
  ensureInvoiceTrxForSweep,
  isNativeTronToken,
  readTronAccountResources,
  sponsorBase58,
  sponsorTronWeb,
  sweepTrc20FromInvoice,
  sweepTrxFromInvoice,
  type TronSponsorConfig,
} from "../../src/tron-sponsor.js";
import { TronInvoiceSdk } from "../../src/tron.js";
import { TRON_NATIVE_TOKEN } from "../../src/tron-abis.js";

export type TronSweepJobItem = {
  invoice: SweepNodeInvoice;
  token: string;
  balance: bigint;
  usdValue: number;
};

export type TronSweepPlannerResult =
  | { action: "wait"; reason: string; pendingUsd: number }
  | { action: "sweep"; items: TronSweepJobItem[] };

const DEFAULT_THRESHOLD_USD = 50;
const DEFAULT_MIN_DELEGATE_ENERGY = 65_000;

/** Estimate USD notional for threshold gating (uses static token price hints when provided). */
export function estimateInvoiceUsdValue(
  balance: bigint,
  decimals: number,
  priceUsd: number
): number {
  const whole = Number(balance) / 10 ** decimals;
  return whole * priceUsd;
}

/**
 * Decide whether to sweep now or wait for batch threshold / energy.
 * Returns up to `maxInvoices` funded items when sweeping.
 */
export async function planTronSweepBatch(args: {
  chain: TronChainConfig;
  invoices: SweepNodeInvoice[];
  tokenPricesUsd?: Record<string, number>;
  tokenDecimals?: Record<string, number>;
}): Promise<TronSweepPlannerResult> {
  const { chain, invoices } = args;
  const sdk = new TronInvoiceSdk({
    tronWeb: sponsorTronWeb(toSponsorConfig(chain)),
    chainId: chain.id,
    invoiceMasterSecret: chain.invoiceMasterSecret,
    mode: "eoa",
    feeLimit: chain.feeLimit,
  });

  const items: TronSweepJobItem[] = [];
  let pendingUsd = 0;
  const max = chain.batchSweepMaxInvoices ?? chain.sweepBatchSize ?? 50;
  const threshold = chain.batchSweepThresholdUsd ?? DEFAULT_THRESHOLD_USD;

  for (const invoice of invoices) {
    if (items.length >= max) break;
    const token = normalizePlannerToken(invoice.token, chain);
    const balance = await sdk.getBalance(invoice.invoiceAddress, token);
    const minAmount = BigInt((invoice.amount ?? invoice.minAmount ?? 1).toString());
    if (balance < minAmount) continue;

    const symbol = token.startsWith("T") ? guessSymbol(token, chain) : token;
    const decimals = args.tokenDecimals?.[symbol] ?? 6;
    const price = args.tokenPricesUsd?.[symbol] ?? (symbol === "USDT" ? 1 : 0.3);
    const usd = estimateInvoiceUsdValue(balance, decimals, price);
    pendingUsd += usd;
    items.push({ invoice, token, balance, usdValue: usd });
  }

  if (items.length === 0) {
    return { action: "wait", reason: "no funded invoices", pendingUsd: 0 };
  }

  const sponsorConfig = toSponsorConfig(chain);
  const tronWeb = sponsorTronWeb(sponsorConfig);
  const resources = await readTronAccountResources(tronWeb, sponsorBase58(tronWeb));
  const perInvoiceEnergy = chain.minDelegateEnergy ?? DEFAULT_MIN_DELEGATE_ENERGY;
  const requiredEnergy = perInvoiceEnergy * items.length;

  if (resources.energyAvailable >= perInvoiceEnergy) {
    return { action: "sweep", items };
  }

  if (pendingUsd < threshold) {
    return {
      action: "wait",
      reason: `pending $${pendingUsd.toFixed(2)} below threshold $${threshold}`,
      pendingUsd,
    };
  }

  await ensureEnergyForBatch(sponsorConfig, requiredEnergy);
  return { action: "sweep", items };
}

export async function executeTronSweepItem(
  chain: TronChainConfig,
  item: TronSweepJobItem
): Promise<{ txId: string; amount: bigint; token: string }> {
  const sponsorConfig = toSponsorConfig(chain);
  const nodeWallet = chain.sponsorAddress ?? sponsorBase58(sponsorTronWeb(sponsorConfig));
  const { invoice, token, balance } = item;

  const perInvoiceEnergy = chain.minDelegateEnergy ?? DEFAULT_MIN_DELEGATE_ENERGY;
  if (sponsorConfig.energyMode !== "burn") {
    try {
      await delegateEnergyToInvoice(sponsorConfig, invoice.invoiceAddress, perInvoiceEnergy);
    } catch (error) {
      console.warn("[tron-sweep] delegateResource failed, attempting sweep anyway:", error);
    }
  }

  const tronWeb = sponsorTronWeb(sponsorConfig);
  const isNative = isNativeTronToken(tronWeb, token);
  if (!isNative) {
    await ensureInvoiceTrxForSweep(sponsorConfig, invoice.invoiceAddress);
  }
  const result = isNative
    ? await sweepTrxFromInvoice(
        sponsorConfig,
        chain.invoiceMasterSecret!,
        chain.id,
        invoice.invoiceId,
        invoice.invoiceAddress,
        nodeWallet
      )
    : await sweepTrc20FromInvoice(
        sponsorConfig,
        chain.invoiceMasterSecret!,
        chain.id,
        invoice.invoiceId,
        invoice.invoiceAddress,
        token,
        nodeWallet
      );

  if (result.amount !== balance) {
    // balance may have changed between plan and execute; trust on-chain result
  }
  return result;
}

function toSponsorConfig(chain: TronChainConfig): TronSponsorConfig {
  return {
    fullHost: chain.fullHost,
    sponsorPrivateKey: chain.privateKey,
    feeLimit: chain.feeLimit,
    minDelegateEnergy: chain.minDelegateEnergy,
    energyMode: chain.energyMode,
    energyRentProvider: chain.energyRentProvider,
  };
}

function guessSymbol(token: string, chain: TronChainConfig): string {
  if (token === TRON_NATIVE_TOKEN || token === "native") return "TRX";
  const hit = chain.tokens?.find((t) => t.address === token || (t.isNative && token === TRON_NATIVE_TOKEN));
  return hit?.symbol ?? "TRX";
}

function normalizePlannerToken(token: string | undefined, chain: TronChainConfig): string {
  if (!token || token === "native") return TRON_NATIVE_TOKEN;
  if (token.startsWith("T")) return token;
  const hit = chain.tokens?.find((t) => t.symbol === token);
  if (hit?.isNative) return TRON_NATIVE_TOKEN;
  if (hit?.address) return hit.address;
  return token;
}
