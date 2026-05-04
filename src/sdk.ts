import {
  BigNumberish,
  BytesLike,
  Contract,
  ContractTransactionResponse,
  Provider,
  Signer,
  dataLength,
  getAddress,
  hexlify,
  keccak256,
} from "ethers";
import { ERC20_ABI, INVOICE_SWEEPER_ABI, NATIVE_TOKEN } from "./abis.js";

export interface OnchainInvoiceSdkConfig {
  provider: Provider;
  signer?: Signer;
  sweeperAddress: string;
}

export interface SweepInvoiceParams {
  invoiceId?: BytesLike;
  encodedInvoiceParams?: BytesLike;
  amount?: BigNumberish;
  token?: string;
  minAmount?: BigNumberish;
  data?: BytesLike;
}

export interface SweepInvoiceResult {
  invoiceId: string;
  token: string;
  amount: bigint;
  tx: ContractTransactionResponse;
}

export function getInvoiceId(encodedInvoiceParams: BytesLike): string {
  return keccak256(encodedInvoiceParams);
}

export class OnchainInvoiceSdk {
  readonly provider: Provider;
  readonly signer?: Signer;
  readonly sweeperAddress: string;

  private readonly sweeper: Contract;

  constructor(config: OnchainInvoiceSdkConfig) {
    this.provider = config.provider;
    this.signer = config.signer;
    this.sweeperAddress = getAddress(config.sweeperAddress);
    this.sweeper = new Contract(this.sweeperAddress, INVOICE_SWEEPER_ABI, config.signer ?? config.provider);
  }

  async getNewInvoiceAddress(encodedInvoiceParams: BytesLike): Promise<string> {
    return this.getInvoiceAddress(getInvoiceId(encodedInvoiceParams));
  }

  async getInvoiceAddress(invoiceId: BytesLike): Promise<string> {
    return getAddress(await this.sweeper.getInvoiceAddress(invoiceId));
  }

  async createInvoice(encodedInvoiceParams: BytesLike): Promise<{
    invoiceId: string;
    invoiceAddress: string;
    tx: ContractTransactionResponse;
  }> {
    const invoiceId = getInvoiceId(encodedInvoiceParams);
    return this.createInvoiceForId(invoiceId);
  }

  async createInvoiceForId(invoiceId: BytesLike): Promise<{
    invoiceId: string;
    invoiceAddress: string;
    tx: ContractTransactionResponse;
  }> {
    const normalizedInvoiceId = this.normalizeInvoiceId(invoiceId);
    const tx = await this.requireSweeperWithSigner().createInvoice(normalizedInvoiceId);
    return {
      invoiceId: normalizedInvoiceId,
      invoiceAddress: await this.getInvoiceAddress(normalizedInvoiceId),
      tx,
    };
  }

  async sweepInvoice(invoiceAddress: string, params: SweepInvoiceParams): Promise<SweepInvoiceResult> {
    const data = params.data ?? params.encodedInvoiceParams;

    if (!data) {
      throw new Error("Invoice execution data is required");
    }

    const token = normalizeToken(params.token);
    const amount = await this.getBalance(invoiceAddress, token);
    if (params.amount !== undefined && amount !== BigInt(params.amount.toString())) {
      throw new Error(`Invoice amount mismatch: expected ${params.amount}, got ${amount}`);
    }

    const invoiceId = this.resolveInvoiceId(params, data);
    const expectedAddress = await this.getInvoiceAddress(invoiceId);
    if (getAddress(invoiceAddress) !== expectedAddress) {
      throw new Error(`Invoice address mismatch: expected ${expectedAddress}, got ${invoiceAddress}`);
    }

    const minAmount = BigInt(params.minAmount?.toString() ?? "1");

    if (amount < minAmount) {
      throw new Error(`Invoice balance below minimum: have ${amount}, need ${minAmount}`);
    }

    const sweeper = this.requireSweeperWithSigner();
    const tx =
      token === NATIVE_TOKEN
        ? await sweeper.sweepEth(invoiceId, data)
        : await sweeper.sweepToken(invoiceId, token, data);

    return { invoiceId, token, amount, tx };
  }

  async getBalance(address: string, token: string = NATIVE_TOKEN): Promise<bigint> {
    if (token === NATIVE_TOKEN) {
      return this.provider.getBalance(address);
    }

    const erc20 = new Contract(token, ERC20_ABI, this.provider);
    return erc20.balanceOf(address);
  }

  private resolveInvoiceId(params: SweepInvoiceParams, data: BytesLike): string {
    const dataInvoiceId = getInvoiceId(data);
    if (params.invoiceId) {
      const invoiceId = this.normalizeInvoiceId(params.invoiceId);
      if (invoiceId !== dataInvoiceId) {
        throw new Error(`Invoice data hash mismatch: expected ${invoiceId}, got ${dataInvoiceId}`);
      }
      return invoiceId;
    }

    if (params.encodedInvoiceParams) {
      const invoiceId = getInvoiceId(params.encodedInvoiceParams);
      if (invoiceId !== dataInvoiceId) {
        throw new Error(`Invoice data hash mismatch: expected ${invoiceId}, got ${dataInvoiceId}`);
      }
      return invoiceId;
    }

    throw new Error("Either invoiceId or encodedInvoiceParams is required");
  }

  private normalizeInvoiceId(invoiceId: BytesLike): string {
    if (dataLength(invoiceId) !== 32) throw new Error("invoiceId must be 32 bytes");
    return hexlify(invoiceId);
  }

  private requireSweeperWithSigner(): Contract {
    if (!this.signer) throw new Error("A signer is required for transactions");
    return this.sweeper.connect(this.signer) as Contract;
  }
}

function normalizeToken(token?: string): string {
  return token ? getAddress(token) : NATIVE_TOKEN;
}
