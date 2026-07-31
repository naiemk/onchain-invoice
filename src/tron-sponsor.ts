import { TronWeb } from "tronweb";
import { TRON_NATIVE_TOKEN } from "./tron-abis.js";
import { deriveTronInvoicePrivateKey } from "./tron-eoa.js";
import { readTronTokenBalance } from "./tron.js";

export type TronEnergyMode = "staked" | "burn" | "rent";

export type TronSponsorConfig = {
  fullHost: string;
  sponsorPrivateKey: string;
  feeLimit?: number;
  minDelegateEnergy?: number;
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

const DEFAULT_MIN_DELEGATE_ENERGY = 65_000;
const DEFAULT_FEE_LIMIT = 150_000_000;
/** Liquid TRX on invoice EOA for burn-mode TRC20 sweeps (energy paid from invoice balance). */
const MIN_INVOICE_TRX_SUN = 5_000_000;

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

/** Delegate ENERGY from sponsor to invoice EOA (sun-equivalent balance units for delegation). */
export async function delegateEnergyToInvoice(
  config: TronSponsorConfig,
  invoiceAddress: string,
  energyAmount?: number
): Promise<string | undefined> {
  const tronWeb = sponsorTronWeb(config);
  const amount = energyAmount ?? config.minDelegateEnergy ?? DEFAULT_MIN_DELEGATE_ENERGY;
  const sponsor = sponsorBase58(tronWeb);
  if (invoiceAddress === sponsor) return undefined;

  const tx = await tronWeb.transactionBuilder.delegateResource(
    amount,
    invoiceAddress,
    "ENERGY",
    sponsor,
    false
  );
  const signed = await tronWeb.trx.sign(tx);
  const result = await tronWeb.trx.sendRawTransaction(signed);
  if (!result.result) {
    throw new Error(`delegateResource failed: ${JSON.stringify(result)}`);
  }
  return result.txid ?? result.transaction?.txID;
}

export async function undelegateEnergyFromInvoice(
  config: TronSponsorConfig,
  invoiceAddress: string,
  energyAmount?: number
): Promise<string | undefined> {
  const tronWeb = sponsorTronWeb(config);
  const amount = energyAmount ?? config.minDelegateEnergy ?? DEFAULT_MIN_DELEGATE_ENERGY;
  const sponsor = sponsorBase58(tronWeb);
  if (invoiceAddress === sponsor) return undefined;

  const tx = await tronWeb.transactionBuilder.undelegateResource(amount, invoiceAddress, "ENERGY", sponsor);
  const signed = await tronWeb.trx.sign(tx);
  const result = await tronWeb.trx.sendRawTransaction(signed);
  if (!result.result) {
    throw new Error(`undelegateResource failed: ${JSON.stringify(result)}`);
  }
  return result.txid ?? result.transaction?.txID;
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
    // External rent APIs vary; operators integrate via env. Fail open so sweep can still burn TRX.
    console.warn(
      `[tron-sponsor] energy rent provider configured but not integrated; need ~${requiredEnergy}, have ${resources.energyAvailable}`
    );
    return;
  }
  if (mode === "burn") return;
  // staked: operator must freeze TRX on sponsor wallet ahead of time.
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
