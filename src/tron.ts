import { BigNumberish, BytesLike, dataLength, hexlify, keccak256 } from "ethers";
import { TRC20_ABI, TRON_INVOICE_SWEEPER_ABI, TRON_NATIVE_TOKEN } from "./tron-abis.js";
import { deriveTronInvoiceAddress } from "./tron-eoa.js";

export type TronInvoiceMode = "eoa" | "contract";

export interface TronInvoiceSdkConfig {
  tronWeb: any;
  /** Required for contract mode. */
  sweeperAddress?: string;
  feeLimit?: number;
  /** `eoa` derives invoice addresses from master secret (default when master secret is set). */
  mode?: TronInvoiceMode;
  chainId?: string | bigint;
  invoiceMasterSecret?: string;
}

export interface TronSweepInvoiceParams {
  invoiceId?: BytesLike;
  encodedInvoiceParams?: BytesLike;
  amount?: BigNumberish;
  token?: string;
  minAmount?: BigNumberish;
  data?: BytesLike;
  feeLimit?: number;
}

export interface TronSweepInvoiceResult {
  invoiceId: string;
  token: string;
  amount: bigint;
  txId: string;
}

export interface TronPaymentRequirement {
  token?: string;
  minBalance: BigNumberish;
}

export interface TronPaymentBalance {
  token: string;
  balance: bigint;
  minBalance: bigint;
}

export interface TronPaymentHit {
  address: string;
  balances: TronPaymentBalance[];
}

export type TronPaymentCallback = (hits: TronPaymentHit[]) => void | Promise<void>;

export interface TronMonitorPaymentOptions {
  intervalMs?: number;
  autoStart?: boolean;
}

export interface TronMonitorPaymentController {
  addAddress(address: string, requirements: TronPaymentRequirement[]): void;
  removeAddress(address: string): void;
  checkNow(): Promise<TronPaymentHit[]>;
  start(): void;
  stop(): void;
}

interface TronTrackedAddress {
  address: string;
  requirements: TronNormalizedRequirement[];
}

interface TronNormalizedRequirement {
  token: string;
  minBalance: bigint;
}

export function getTronInvoiceId(encodedInvoiceParams: BytesLike): string {
  return keccak256(encodedInvoiceParams);
}

export function resolveTronInvoiceMode(config: TronInvoiceSdkConfig): TronInvoiceMode {
  if (config.mode) return config.mode;
  if (config.invoiceMasterSecret && config.chainId != null) return "eoa";
  return "contract";
}

export class TronInvoiceSdk {
  readonly tronWeb: any;
  readonly sweeperAddress?: string;
  readonly feeLimit: number;
  readonly mode: TronInvoiceMode;
  readonly chainId?: string | bigint;
  readonly invoiceMasterSecret?: string;

  private readonly sweeper: any;

  constructor(config: TronInvoiceSdkConfig) {
    this.tronWeb = config.tronWeb;
    this.sweeperAddress = config.sweeperAddress;
    this.feeLimit = config.feeLimit ?? 100_000_000;
    this.mode = resolveTronInvoiceMode(config);
    this.chainId = config.chainId;
    this.invoiceMasterSecret = config.invoiceMasterSecret;

    if (this.mode === "contract") {
      if (!config.sweeperAddress) throw new Error("sweeperAddress is required for contract mode");
      this.sweeper = this.tronWeb.contract(TRON_INVOICE_SWEEPER_ABI, config.sweeperAddress);
    } else {
      if (!config.invoiceMasterSecret) throw new Error("invoiceMasterSecret is required for eoa mode");
      if (config.chainId == null) throw new Error("chainId is required for eoa mode");
      this.sweeper = undefined;
    }
  }

  async getNewInvoiceAddress(encodedInvoiceParams: BytesLike): Promise<string> {
    return this.getInvoiceAddress(getTronInvoiceId(encodedInvoiceParams));
  }

  async getInvoiceAddress(invoiceId: BytesLike): Promise<string> {
    const normalizedInvoiceId = normalizeBytes32(invoiceId);
    if (this.mode === "eoa") {
      return deriveTronInvoiceAddress(
        this.invoiceMasterSecret!,
        this.chainId!,
        normalizedInvoiceId,
        this.tronWeb.fullHost ?? this.tronWeb.fullNode?.host
      );
    }
    const address = await this.sweeper.getInvoiceAddress(normalizedInvoiceId).call();
    return this.toBase58(address);
  }

  async createInvoice(encodedInvoiceParams: BytesLike): Promise<{
    invoiceId: string;
    invoiceAddress: string;
    txId: string;
  }> {
    return this.createInvoiceForId(getTronInvoiceId(encodedInvoiceParams));
  }

  async createInvoiceForId(invoiceId: BytesLike, feeLimit = this.feeLimit): Promise<{
    invoiceId: string;
    invoiceAddress: string;
    txId: string;
  }> {
    const normalizedInvoiceId = normalizeBytes32(invoiceId);
    if (this.mode === "eoa") {
      return {
        invoiceId: normalizedInvoiceId,
        invoiceAddress: await this.getInvoiceAddress(normalizedInvoiceId),
        txId: "",
      };
    }
    const txId = await this.sweeper.createInvoice(normalizedInvoiceId).send({ feeLimit });
    return {
      invoiceId: normalizedInvoiceId,
      invoiceAddress: await this.getInvoiceAddress(normalizedInvoiceId),
      txId,
    };
  }

  async sweepInvoice(invoiceAddress: string, params: TronSweepInvoiceParams): Promise<TronSweepInvoiceResult> {
    if (this.mode === "eoa") {
      throw new Error("EOA mode sweeps are performed by the sweep node sponsor wallet, not TronInvoiceSdk.sweepInvoice");
    }
    const data = params.data ?? params.encodedInvoiceParams;
    if (!data) throw new Error("Invoice execution data is required");

    const token = this.normalizeToken(params.token);
    const amount = await this.getBalance(invoiceAddress, token);

    if (params.amount !== undefined && amount !== BigInt(params.amount.toString())) {
      throw new Error(`Invoice amount mismatch: expected ${params.amount}, got ${amount}`);
    }

    const minAmount = BigInt(params.minAmount?.toString() ?? "1");
    if (amount < minAmount) {
      throw new Error(`Invoice balance below minimum: have ${amount}, need ${minAmount}`);
    }

    const invoiceId = this.resolveInvoiceId(params, data);
    const expectedAddress = await this.getInvoiceAddress(invoiceId);
    if (this.toHexAddress(invoiceAddress) !== this.toHexAddress(expectedAddress)) {
      throw new Error(`Invoice address mismatch: expected ${expectedAddress}, got ${invoiceAddress}`);
    }

    const hexData = hexlify(data);
    const feeLimit = params.feeLimit ?? this.feeLimit;
    const txId =
      this.toHexAddress(token) === this.toHexAddress(TRON_NATIVE_TOKEN)
        ? await this.sweeper.sweepTrx(invoiceId, hexData).send({ feeLimit })
        : await this.sweeper.sweepToken(invoiceId, token, hexData).send({ feeLimit });

    return { invoiceId, token, amount, txId };
  }

  async getBalance(address: string, token = TRON_NATIVE_TOKEN): Promise<bigint> {
    return readTronTokenBalance(this.tronWeb, address, token);
  }

  private resolveInvoiceId(params: TronSweepInvoiceParams, data: BytesLike): string {
    const dataInvoiceId = getTronInvoiceId(data);
    if (params.invoiceId) {
      const invoiceId = normalizeBytes32(params.invoiceId);
      if (invoiceId !== dataInvoiceId) {
        throw new Error(`Invoice data hash mismatch: expected ${invoiceId}, got ${dataInvoiceId}`);
      }
      return invoiceId;
    }

    if (params.encodedInvoiceParams) {
      const invoiceId = getTronInvoiceId(params.encodedInvoiceParams);
      if (invoiceId !== dataInvoiceId) {
        throw new Error(`Invoice data hash mismatch: expected ${invoiceId}, got ${dataInvoiceId}`);
      }
      return invoiceId;
    }

    throw new Error("Either invoiceId or encodedInvoiceParams is required");
  }

  private normalizeToken(token?: string): string {
    return token ?? TRON_NATIVE_TOKEN;
  }

  private toHexAddress(address: string): string {
    return this.tronWeb.address.toHex(address).toLowerCase();
  }

  private toBase58(address: string): string {
    if (address.startsWith("T")) return address;
    return this.tronWeb.address.fromHex(address);
  }
}

export function monitorTronPayment(
  tronWeb: any,
  address: string,
  requirements: TronPaymentRequirement[],
  callback: TronPaymentCallback,
  options: TronMonitorPaymentOptions = {}
): TronMonitorPaymentController {
  const intervalMs = options.intervalMs ?? 12_000;
  const tracked = new Map<string, TronTrackedAddress>();
  let timer: NodeJS.Timeout | undefined;
  let checking = false;

  const controller: TronMonitorPaymentController = {
    addAddress(nextAddress, nextRequirements) {
      const normalizedAddress = tronWeb.address.fromHex(tronWeb.address.toHex(nextAddress));
      tracked.set(normalizedAddress, {
        address: normalizedAddress,
        requirements: normalizeTronRequirements(tronWeb, nextRequirements),
      });
    },
    removeAddress(nextAddress) {
      tracked.delete(tronWeb.address.fromHex(tronWeb.address.toHex(nextAddress)));
    },
    async checkNow() {
      if (checking) return [];
      checking = true;

      try {
        const hits = await collectTronHits(tronWeb, [...tracked.values()]);
        for (const hit of hits) tracked.delete(hit.address);
        if (hits.length > 0) await callback(hits);
        return hits;
      } finally {
        checking = false;
      }
    },
    start() {
      if (timer) return;
      timer = setInterval(() => {
        void controller.checkNow();
      }, intervalMs);
      void controller.checkNow();
    },
    stop() {
      if (!timer) return;
      clearInterval(timer);
      timer = undefined;
    },
  };

  controller.addAddress(address, requirements);
  if (options.autoStart !== false) controller.start();

  return controller;
}

async function collectTronHits(tronWeb: any, tracked: TronTrackedAddress[]): Promise<TronPaymentHit[]> {
  const hits: TronPaymentHit[] = [];

  for (const item of tracked) {
    const balances: TronPaymentBalance[] = [];

    for (const requirement of item.requirements) {
      const balance = await readTronBalance(tronWeb, item.address, requirement.token);
      if (balance >= requirement.minBalance) {
        balances.push({
          token: requirement.token,
          balance,
          minBalance: requirement.minBalance,
        });
      }
    }

    if (balances.length === item.requirements.length) {
      hits.push({ address: item.address, balances });
    }
  }

  return hits;
}

async function readTronBalance(tronWeb: any, address: string, token: string): Promise<bigint> {
  return readTronTokenBalance(tronWeb, address, token);
}

/** Read TRX or TRC20 balance; works without a TronWeb private key (uses triggerConstantContract). */
export async function readTronTokenBalance(
  tronWeb: any,
  address: string,
  token: string = TRON_NATIVE_TOKEN
): Promise<bigint> {
  const nativeHex = tronWeb.address.toHex(TRON_NATIVE_TOKEN).toLowerCase();
  if (tronWeb.address.toHex(token).toLowerCase() === nativeHex) {
    return BigInt(await tronWeb.trx.getBalance(address));
  }

  const caller: string =
    typeof tronWeb.defaultAddress?.base58 === "string" && tronWeb.defaultAddress.base58
      ? tronWeb.defaultAddress.base58
      : address;
  const response = await tronWeb.transactionBuilder.triggerConstantContract(
    token,
    "balanceOf(address)",
    {},
    [{ type: "address", value: address }],
    caller
  );
  const hex = response?.constant_result?.[0];
  if (!hex) throw new Error("TRC20 balanceOf call failed");
  return BigInt(`0x${hex}`);
}

function normalizeTronRequirements(tronWeb: any, requirements: TronPaymentRequirement[]): TronNormalizedRequirement[] {
  if (requirements.length === 0) {
    throw new Error("At least one payment requirement is required");
  }

  return requirements.map((requirement) => ({
    token: requirement.token ?? TRON_NATIVE_TOKEN,
    minBalance: BigInt(requirement.minBalance.toString()),
  }));
}

function normalizeBytes32(value: BytesLike): string {
  if (dataLength(value) !== 32) throw new Error("invoiceId must be 32 bytes");
  return hexlify(value);
}
