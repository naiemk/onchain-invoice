import { TronWeb } from "tronweb";
import { TRON_NATIVE_TOKEN } from "./tron-abis.js";
import { deriveTronInvoicePrivateKey } from "./tron-eoa.js";
import { readTronTokenBalance } from "./tron.js";

export type TronEnergyMode = "staked" | "burn" | "rent";

export type TronSponsorConfig = {
  fullHost: string;
  sponsorPrivateKey: string;
  feeLimit?: number;
  /** Sun of staked TRX to delegate as ENERGY (Stake 2.0). */
  minDelegateEnergy?: number;
  /** Sun of staked TRX to delegate as BANDWIDTH (Stake 2.0). */
  minDelegateBandwidth?: number;
  energyMode?: TronEnergyMode;
  energyRentProvider?: string;
};

export type TronAccountResources = {
  energyLimit: number;
  energyUsed: number;
  energyAvailable: number;
  netLimit: number;
  netUsed: number;
  netAvailable: number;
};

export type TronSweepTransferResult = {
  txId: string;
  amount: bigint;
  token: string;
};

export type TronDelegatedResources = {
  energyTxId?: string;
  bandwidthTxId?: string;
  energyAmount: number;
  bandwidthAmount: number;
};

const DEFAULT_MIN_DELEGATE_ENERGY = 65_000_000; // 65 TRX stake → energy (sun)
const DEFAULT_MIN_DELEGATE_BANDWIDTH = 1_500_000; // 1.5 TRX stake → bandwidth (sun)
const DEFAULT_FEE_LIMIT = 150_000_000;
/** Liquid TRX on invoice EOA for burn-mode TRC20 sweeps (energy paid from invoice balance). */
const MIN_INVOICE_TRX_SUN = 5_000_000;
/** One-time account activation (TVM); not used as energy when `energyMode` is `staked`. */
const ACCOUNT_ACTIVATION_TRX_SUN = 1_000_000n;

export function sponsorTronWeb(config: TronSponsorConfig): TronWeb {
  return new TronWeb({
    fullHost: config.fullHost,
    privateKey: config.sponsorPrivateKey.replace(/^0x/, ""),
  });
}

export function sponsorBase58(tronWeb: TronWeb): string {
  return tronWeb.defaultAddress.base58 as string;
}

export async function readTronAccountResources(tronWeb: TronWeb, address: string): Promise<TronAccountResources> {
  const resources = await tronWeb.trx.getAccountResources(address);
  const energyLimit = Number(resources.EnergyLimit ?? 0);
  const energyUsed = Number(resources.EnergyUsed ?? 0);
  const netLimit = Number(resources.NetLimit ?? 0);
  const netUsed = Number(resources.NetUsed ?? 0);
  return {
    energyLimit,
    energyUsed,
    energyAvailable: Math.max(0, energyLimit - energyUsed),
    netLimit,
    netUsed,
    netAvailable: Math.max(0, netLimit - netUsed),
  };
}

async function delegateResourceToInvoice(
  config: TronSponsorConfig,
  invoiceAddress: string,
  resource: "ENERGY" | "BANDWIDTH",
  amountSun: number
): Promise<string | undefined> {
  if (amountSun <= 0) return undefined;
  const tronWeb = sponsorTronWeb(config);
  const sponsor = sponsorBase58(tronWeb);
  if (invoiceAddress === sponsor) return undefined;

  const tx = await tronWeb.transactionBuilder.delegateResource(
    amountSun,
    invoiceAddress,
    resource,
    sponsor,
    false
  );
  const signed = await tronWeb.trx.sign(tx);
  const result = await tronWeb.trx.sendRawTransaction(signed);
  if (!result.result) {
    throw new Error(`delegateResource(${resource}) failed: ${JSON.stringify(result)}`);
  }
  return result.txid ?? result.transaction?.txID;
}

async function undelegateResourceFromInvoice(
  config: TronSponsorConfig,
  invoiceAddress: string,
  resource: "ENERGY" | "BANDWIDTH",
  amountSun: number
): Promise<string | undefined> {
  if (amountSun <= 0) return undefined;
  const tronWeb = sponsorTronWeb(config);
  const sponsor = sponsorBase58(tronWeb);
  if (invoiceAddress === sponsor) return undefined;

  const tx = await tronWeb.transactionBuilder.undelegateResource(
    amountSun,
    invoiceAddress,
    resource,
    sponsor
  );
  const signed = await tronWeb.trx.sign(tx);
  const result = await tronWeb.trx.sendRawTransaction(signed);
  if (!result.result) {
    throw new Error(`undelegateResource(${resource}) failed: ${JSON.stringify(result)}`);
  }
  return result.txid ?? result.transaction?.txID;
}

/** Delegate ENERGY from sponsor to invoice EOA (Stake 2.0 amount in sun). */
export async function delegateEnergyToInvoice(
  config: TronSponsorConfig,
  invoiceAddress: string,
  energyAmount?: number
): Promise<string | undefined> {
  const amount = energyAmount ?? config.minDelegateEnergy ?? DEFAULT_MIN_DELEGATE_ENERGY;
  return delegateResourceToInvoice(config, invoiceAddress, "ENERGY", amount);
}

/** Delegate BANDWIDTH from sponsor to invoice EOA (Stake 2.0 amount in sun). */
export async function delegateBandwidthToInvoice(
  config: TronSponsorConfig,
  invoiceAddress: string,
  bandwidthAmount?: number
): Promise<string | undefined> {
  const amount = bandwidthAmount ?? config.minDelegateBandwidth ?? DEFAULT_MIN_DELEGATE_BANDWIDTH;
  return delegateResourceToInvoice(config, invoiceAddress, "BANDWIDTH", amount);
}

export async function undelegateEnergyFromInvoice(
  config: TronSponsorConfig,
  invoiceAddress: string,
  energyAmount?: number
): Promise<string | undefined> {
  const amount = energyAmount ?? config.minDelegateEnergy ?? DEFAULT_MIN_DELEGATE_ENERGY;
  return undelegateResourceFromInvoice(config, invoiceAddress, "ENERGY", amount);
}

export async function undelegateBandwidthFromInvoice(
  config: TronSponsorConfig,
  invoiceAddress: string,
  bandwidthAmount?: number
): Promise<string | undefined> {
  const amount = bandwidthAmount ?? config.minDelegateBandwidth ?? DEFAULT_MIN_DELEGATE_BANDWIDTH;
  return undelegateResourceFromInvoice(config, invoiceAddress, "BANDWIDTH", amount);
}

/**
 * Prefer delegation so the invoice EOA does not burn liquid TRX for energy/bandwidth.
 * - `staked` (default): activate account if needed (1 TRX once), then delegate ENERGY + BANDWIDTH
 * - `burn`: send liquid TRX to the invoice for fee burn (legacy)
 * - `rent`: placeholder; falls through to delegation attempt
 *
 * Note: Tron cannot `delegateResource` to an account that does not exist yet. Activation TRX
 * is a TVM requirement and is separate from paying for energy (which comes from stake).
 */
export async function prepareInvoiceResourcesForSweep(
  config: TronSponsorConfig,
  invoiceAddress: string
): Promise<TronDelegatedResources | { mode: "burn" }> {
  const mode = config.energyMode ?? "staked";
  if (mode === "burn") {
    await ensureInvoiceTrxForSweep(config, invoiceAddress);
    return { mode: "burn" };
  }

  await ensureInvoiceAccountActivated(config, invoiceAddress);

  const energyAmount = config.minDelegateEnergy ?? DEFAULT_MIN_DELEGATE_ENERGY;
  const bandwidthAmount = config.minDelegateBandwidth ?? DEFAULT_MIN_DELEGATE_BANDWIDTH;
  const energyTxId = await delegateEnergyToInvoice(config, invoiceAddress, energyAmount);
  const bandwidthTxId = await delegateBandwidthToInvoice(config, invoiceAddress, bandwidthAmount);
  return { energyTxId, bandwidthTxId, energyAmount, bandwidthAmount };
}

/** Create the invoice account on-chain if missing (required before DelegateResource). */
export async function ensureInvoiceAccountActivated(
  config: TronSponsorConfig,
  invoiceAddress: string
): Promise<string | undefined> {
  const tronWeb = sponsorTronWeb(config);
  const sponsor = sponsorBase58(tronWeb);
  if (invoiceAddress === sponsor) return undefined;

  try {
    const account = await tronWeb.trx.getAccount(invoiceAddress);
    if (account?.address) return undefined;
  } catch {
    // treat as missing
  }

  const txId = await transferTrxFromNodeWallet(config, invoiceAddress, ACCOUNT_ACTIVATION_TRX_SUN);
  // Account index can lag briefly after create.
  await new Promise((resolve) => setTimeout(resolve, 2500));
  return txId;
}

/** Best-effort reclaim after a successful sweep (delegation mode only). */
export async function releaseInvoiceResourcesAfterSweep(
  config: TronSponsorConfig,
  invoiceAddress: string,
  delegated?: TronDelegatedResources | { mode: "burn" }
): Promise<void> {
  if (!delegated || "mode" in delegated) return;
  try {
    await undelegateEnergyFromInvoice(config, invoiceAddress, delegated.energyAmount);
  } catch (error) {
    console.warn("[tron-sponsor] undelegate ENERGY failed:", error);
  }
  try {
    await undelegateBandwidthFromInvoice(config, invoiceAddress, delegated.bandwidthAmount);
  } catch (error) {
    console.warn("[tron-sponsor] undelegate BANDWIDTH failed:", error);
  }
}

/**
 * Best-effort energy top-up before a batch. `staked` uses sponsor frozen balance;
 * `burn` relies on TRX burn at tx time; `rent` is a no-op placeholder for external APIs.
 */
export async function ensureEnergyForBatch(config: TronSponsorConfig, requiredEnergy: number): Promise<void> {
  const tronWeb = sponsorTronWeb(config);
  const sponsor = sponsorBase58(tronWeb);
  const resources = await readTronAccountResources(tronWeb, sponsor);
  if (resources.energyAvailable >= requiredEnergy) return;

  const mode = config.energyMode ?? "staked";
  if (mode === "rent" && config.energyRentProvider) {
    console.warn(
      `[tron-sponsor] energy rent provider configured but not integrated; need ~${requiredEnergy}, have ${resources.energyAvailable}`
    );
    return;
  }
  if (mode === "burn") return;
  // staked: operator must freeze/stake TRX on sponsor wallet ahead of time for delegation.
}

/** In burn mode, invoice EOAs need liquid TRX to pay energy for TRC20 transfers. */
export async function ensureInvoiceTrxForSweep(config: TronSponsorConfig, invoiceAddress: string): Promise<void> {
  if ((config.energyMode ?? "staked") !== "burn") return;
  const tronWeb = sponsorTronWeb(config);
  const sponsor = sponsorBase58(tronWeb);
  if (invoiceAddress === sponsor) return;

  const trx = BigInt(await tronWeb.trx.getBalance(invoiceAddress));
  const minTrx = BigInt(MIN_INVOICE_TRX_SUN);
  if (trx >= minTrx) return;

  await transferTrxFromNodeWallet(config, invoiceAddress, minTrx - trx);
}

export async function sweepTrxFromInvoice(
  config: TronSponsorConfig,
  masterSecret: string,
  chainId: string | bigint,
  invoiceId: string,
  invoiceAddress: string,
  nodeWalletAddress: string
): Promise<TronSweepTransferResult> {
  const privateKey = deriveTronInvoicePrivateKey(masterSecret, chainId, invoiceId);
  const invoiceWeb = new TronWeb({ fullHost: config.fullHost, privateKey });
  const balance = BigInt(await invoiceWeb.trx.getBalance(invoiceAddress));
  if (balance === 0n) throw new Error("Invoice TRX balance is zero");

  const tx = await invoiceWeb.trx.sendTransaction(nodeWalletAddress, Number(balance));
  if (!tx.result) throw new Error(`TRX sweep failed: ${JSON.stringify(tx)}`);
  return { txId: tx.txid ?? tx.transaction?.txID ?? "", amount: balance, token: TRON_NATIVE_TOKEN };
}

export async function sweepTrc20FromInvoice(
  config: TronSponsorConfig,
  masterSecret: string,
  chainId: string | bigint,
  invoiceId: string,
  invoiceAddress: string,
  tokenAddress: string,
  nodeWalletAddress: string
): Promise<TronSweepTransferResult> {
  const privateKey = deriveTronInvoicePrivateKey(masterSecret, chainId, invoiceId);
  const invoiceWeb = new TronWeb({ fullHost: config.fullHost, privateKey });
  const balance = await readTronTokenBalance(invoiceWeb, invoiceAddress, tokenAddress);
  if (balance === 0n) throw new Error("Invoice TRC20 balance is zero");

  const feeLimit = config.feeLimit ?? DEFAULT_FEE_LIMIT;
  const trc20 = await invoiceWeb.contract().at(tokenAddress);
  const txId: string = await trc20.transfer(nodeWalletAddress, balance.toString()).send({ feeLimit });
  return { txId, amount: balance, token: tokenAddress };
}

export async function transferTrxFromNodeWallet(
  config: TronSponsorConfig,
  to: string,
  amountSun: bigint
): Promise<string> {
  const tronWeb = sponsorTronWeb(config);
  const tx = await tronWeb.trx.sendTransaction(to, Number(amountSun));
  if (!tx.result) throw new Error(`TRX transfer failed: ${JSON.stringify(tx)}`);
  return tx.txid ?? tx.transaction?.txID ?? "";
}

export async function transferTrc20FromNodeWallet(
  config: TronSponsorConfig,
  tokenAddress: string,
  to: string,
  amount: bigint
): Promise<string> {
  const tronWeb = sponsorTronWeb(config);
  const trc20 = await tronWeb.contract().at(tokenAddress);
  const feeLimit = config.feeLimit ?? DEFAULT_FEE_LIMIT;
  return trc20.transfer(to, amount.toString()).send({ feeLimit });
}

export function isNativeTronToken(tronWeb: TronWeb, token: string): boolean {
  if (!token) return true;
  if (token === TRON_NATIVE_TOKEN) return true;
  try {
    return tronWeb.address.toHex(token).toLowerCase() === tronWeb.address.toHex(TRON_NATIVE_TOKEN).toLowerCase();
  } catch {
    return false;
  }
}
