import { timingSafeEqual } from "node:crypto";
import { Contract, JsonRpcProvider, Wallet, parseUnits } from "ethers";
import { chainKind } from "onchain-invoice";
import type { InvoiceRecord } from "../shared/types.js";
import type { AppConfig, FaucetConfig } from "./config.js";
import { resolveEvmChain } from "./config.js";

const ERC20_ABI = ["function transfer(address to, uint256 amount) returns (bool)"] as const;

/** Product chainIds allowed for the testnet faucet. */
export const FAUCET_TESTNET_CHAINS = new Set(["11155111", "nile"]);

const SEPOLIA_USDC = "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238";

export function isFaucetTestnetChain(chainId: string | null | undefined): boolean {
  return Boolean(chainId && FAUCET_TESTNET_CHAINS.has(String(chainId)));
}

/** True when the pay UI may show the faucet control. */
export function isFaucetPubliclyEnabled(faucet: FaucetConfig): boolean {
  if (!faucet.enabled || !faucet.secret) return false;
  return Boolean(faucet.privateKey || faucet.tronPrivateKey || faucet.dryRun);
}

export function secretsEqual(provided: string, expected: string): boolean {
  const a = Buffer.from(provided, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) {
    timingSafeEqual(a, a);
    return false;
  }
  return timingSafeEqual(a, b);
}

export interface FaucetFundResult {
  txHash: string;
  chainId: string;
  amount: string;
  dryRun?: boolean;
}

/**
 * Validate invoice + secret, then transfer settlement tokens to invoiceAddress.
 * Does not mark the invoice paid — the sweeper observes the balance.
 */
export async function fundFiatInvoiceFromFaucet(
  config: AppConfig,
  invoice: InvoiceRecord,
  secret: string
): Promise<FaucetFundResult> {
  const faucet = config.faucet;
  if (!faucet.enabled) {
    throw Object.assign(new Error("Faucet is disabled"), { statusCode: 503, code: "faucet_disabled" });
  }
  if (!faucet.secret) {
    throw Object.assign(new Error("Faucet secret is not configured"), {
      statusCode: 503,
      code: "faucet_not_configured",
    });
  }
  if (!secretsEqual(secret, faucet.secret)) {
    throw Object.assign(new Error("Invalid faucet secret"), { statusCode: 403, code: "faucet_forbidden" });
  }
  if (invoice.paymentMode !== "fiat") {
    throw Object.assign(new Error("Faucet is only available for fiat-only invoices"), {
      statusCode: 400,
      code: "faucet_payment_mode",
    });
  }
  if (invoice.status !== "awaiting_payment" && invoice.status !== "paid_partial") {
    throw Object.assign(new Error(`Invoice status ${invoice.status} cannot be funded`), {
      statusCode: 400,
      code: "faucet_status",
    });
  }
  if (!invoice.invoiceAddress) {
    throw Object.assign(new Error("Invoice has no settlement address"), {
      statusCode: 400,
      code: "faucet_no_address",
    });
  }
  const chainId = invoice.chainId;
  if (!isFaucetTestnetChain(chainId)) {
    throw Object.assign(new Error("Faucet is only available on testnet chains"), {
      statusCode: 400,
      code: "faucet_mainnet",
    });
  }

  const token = (invoice.token ?? "USDC").toUpperCase();
  const amountHuman = invoice.priceUsd;
  if (!amountHuman || Number(amountHuman) <= 0) {
    throw Object.assign(new Error("Invoice has no positive settlement amount"), {
      statusCode: 400,
      code: "faucet_amount",
    });
  }

  if (faucet.dryRun) {
    return {
      txHash: `0xdryrun${Buffer.from(`${invoice.id}:${Date.now()}`).toString("hex").slice(0, 56)}`,
      chainId: chainId!,
      amount: amountHuman,
      dryRun: true,
    };
  }

  const kind = chainKind(chainId!);
  if (kind === "evm") {
    return fundEvm(config, invoice, chainId!, token, amountHuman);
  }
  if (kind === "tron") {
    return fundTron(config, invoice, chainId!, amountHuman);
  }
  throw Object.assign(new Error(`Faucet does not support chain ${chainId}`), {
    statusCode: 400,
    code: "faucet_chain",
  });
}

async function fundEvm(
  config: AppConfig,
  invoice: InvoiceRecord,
  chainId: string,
  token: string,
  amountHuman: string
): Promise<FaucetFundResult> {
  const privateKey = config.faucet.privateKey;
  if (!privateKey) {
    throw Object.assign(new Error("FAUCET_PRIVATE_KEY or SWEEPER_PRIVATE_KEY required for EVM faucet"), {
      statusCode: 503,
      code: "faucet_no_key",
    });
  }
  const evm = resolveEvmChain(config.evmChains, chainId);
  const rpcUrl = evm?.rpcUrl ?? config.evmRpcUrl;
  if (!rpcUrl) {
    throw Object.assign(new Error(`No RPC URL configured for chain ${chainId}`), {
      statusCode: 503,
      code: "faucet_no_rpc",
    });
  }
  const tokenAddress =
    evm?.tokens?.[token]?.address ??
    (chainId === "11155111" && token === "USDC" ? SEPOLIA_USDC : undefined);
  const decimals = evm?.tokens?.[token]?.decimals ?? 6;
  if (!tokenAddress) {
    throw Object.assign(new Error(`Token ${token} is not configured for chain ${chainId}`), {
      statusCode: 503,
      code: "faucet_no_token",
    });
  }

  const amount = parseUnits(amountHuman, decimals);
  const provider = new JsonRpcProvider(rpcUrl);
  const wallet = new Wallet(privateKey, provider);
  const contract = new Contract(tokenAddress, ERC20_ABI, wallet);
  try {
    const tx = await contract.transfer(invoice.invoiceAddress!, amount);
    const receipt = await tx.wait();
    const txHash = String(receipt?.hash ?? tx.hash);
    return { txHash, chainId, amount: amountHuman };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw Object.assign(new Error(`Faucet transfer failed: ${message}`), {
      statusCode: 503,
      code: "faucet_transfer_failed",
    });
  }
}

async function fundTron(
  config: AppConfig,
  invoice: InvoiceRecord,
  chainId: string,
  amountHuman: string
): Promise<FaucetFundResult> {
  const privateKey = config.faucet.tronPrivateKey;
  if (!privateKey) {
    throw Object.assign(
      new Error("FAUCET_TRON_PRIVATE_KEY or TRON_SPONSOR_PRIVATE_KEY required for Tron faucet"),
      { statusCode: 503, code: "faucet_no_key" }
    );
  }
  const fullHost = config.tronFullHost;
  const usdt = config.tronUsdtAddress;
  if (!fullHost || !usdt) {
    throw Object.assign(new Error("TRON_FULL_HOST and TRON_USDT_ADDRESS required for Tron faucet"), {
      statusCode: 503,
      code: "faucet_no_tron",
    });
  }

  const amount = parseUnits(amountHuman, 6);
  try {
    const { TronWeb } = await import("tronweb");
    const tronWeb = new TronWeb({
      fullHost,
      privateKey: privateKey.replace(/^0x/, ""),
    });
    const contract = await tronWeb.contract().at(usdt);
    const txHash = await contract.methods.transfer(invoice.invoiceAddress!, amount.toString()).send();
    return { txHash: String(txHash), chainId, amount: amountHuman };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw Object.assign(new Error(`Faucet transfer failed: ${message}`), {
      statusCode: 503,
      code: "faucet_transfer_failed",
    });
  }
}
