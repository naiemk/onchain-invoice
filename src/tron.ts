import { BigNumberish, BytesLike, dataLength, hexlify, keccak256 } from "ethers";
import { TRC20_ABI, TRON_INVOICE_SWEEPER_ABI, TRON_NATIVE_TOKEN } from "./tron-abis.js";

export interface TronInvoiceSdkConfig {
  tronWeb: any;
  sweeperAddress: string;
  feeLimit?: number;
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

export class TronInvoiceSdk {
  readonly tronWeb: any;
  readonly sweeperAddress: string;
  readonly feeLimit: number;

  private readonly sweeper: any;

  constructor(config: TronInvoiceSdkConfig) {
    this.tronWeb = config.tronWeb;
    this.sweeperAddress = config.sweeperAddress;
    this.feeLimit = config.feeLimit ?? 100_000_000;
    this.sweeper = this.tronWeb.contract(TRON_INVOICE_SWEEPER_ABI, config.sweeperAddress);
  }

  async getNewInvoiceAddress(encodedInvoiceParams: BytesLike): Promise<string> {
    return this.getInvoiceAddress(getTronInvoiceId(encodedInvoiceParams));
  }

  async getInvoiceAddress(invoiceId: BytesLike): Promise<string> {
    const normalizedInvoiceId = normalizeBytes32(invoiceId);
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
    const txId = await this.sweeper.createInvoice(normalizedInvoiceId).send({ feeLimit });
    return {
      invoiceId: normalizedInvoiceId,
      invoiceAddress: await this.getInvoiceAddress(normalizedInvoiceId),
      txId,
    };
  }

  async sweepInvoice(invoiceAddress: string, params: TronSweepInvoiceParams): Promise<TronSweepInvoiceResult> {
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
    if (this.toHexAddress(token) === this.toHexAddress(TRON_NATIVE_TOKEN)) {
      return BigInt(await this.tronWeb.trx.getBalance(address));
    }

    const trc20 = this.tronWeb.contract(TRC20_ABI, token);
    const balance = await trc20.balanceOf(address).call();
    return BigInt(balance.toString());
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
  const nativeHex = tronWeb.address.toHex(TRON_NATIVE_TOKEN).toLowerCase();
  if (tronWeb.address.toHex(token).toLowerCase() === nativeHex) {
    return BigInt(await tronWeb.trx.getBalance(address));
  }

  const trc20 = tronWeb.contract(TRC20_ABI, token);
  const balance = await trc20.balanceOf(address).call();
  return BigInt(balance.toString());
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
