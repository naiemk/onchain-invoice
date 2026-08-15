import {
  AbiCoder,
  BigNumberish,
  BytesLike,
  Contract,
  ContractTransactionResponse,
  Provider,
  Signer,
  getAddress,
  getBytes,
  getCreate2Address,
  hexlify,
  id,
  keccak256,
  randomBytes,
  solidityPacked,
  toUtf8Bytes,
} from "ethers";
import { normalizeMerchantAddresses } from "./commerce-addresses.js";
import { COMMERCE_INVOICE_SWEEPER_ABI, ERC20_ABI, NATIVE_TOKEN } from "./commerce-abis.js";

export interface CommerceInvoiceSdkConfig {
  provider: Provider;
  signer?: Signer;
  sweeperAddress: string;
}

export interface CommerceSweepParams {
  token?: string;
  amount: BigNumberish;
  to: string;
  invoiceId: BytesLike;
}

export interface CommerceSweepResult {
  invoiceId: string;
  token: string;
  to: string;
  amount: bigint;
  fee: bigint;
  tx: ContractTransactionResponse;
}

export interface CommerceInvoiceParams {
  /** Random bytes32 — primary uniqueness source for the invoice id. */
  invoiceSeed: BytesLike;
  toAddresses: string[];
  /** Optional merchant reference (not part of the invoice id). */
  clientInvoiceId?: string;
  priceUsd?: string;
  callbackUrl?: string;
  title?: string;
  description?: string;
  allowPartial?: boolean;
  chains?: string[];
  tokens?: string[];
}

/** Cryptographically random bytes32 seed for a new invoice. */
export function randomInvoiceSeed(): string {
  return hexlify(randomBytes(32));
}

export function normalizeInvoiceSeed(seed: BytesLike): string {
  const bytes = getBytes(hexlify(seed));
  if (bytes.length !== 32) {
    throw new Error(`invoiceSeed must be 32 bytes, got ${bytes.length}`);
  }
  return hexlify(bytes);
}

/**
 * Invoice id = keccak256(abi.encode(bytes32 invoiceSeed, string[] toAddresses)).
 * Uniqueness comes from a random seed; `toAddresses` bind payout destinations into the id.
 */
export function getCommerceInvoiceId(
  params: Pick<CommerceInvoiceParams, "invoiceSeed" | "toAddresses"> | BytesLike
): string {
  if (typeof params === "string" || params instanceof Uint8Array) {
    return keccak256(params);
  }
  const encoded = AbiCoder.defaultAbiCoder().encode(
    ["bytes32", "string[]"],
    [normalizeInvoiceSeed(params.invoiceSeed), normalizeMerchantAddresses(params.toAddresses)]
  );
  return keccak256(encoded);
}

export function commerceInvoiceSalt(to: string, invoiceId: BytesLike): string {
  return keccak256(solidityPacked(["address", "bytes32"], [getAddress(to), hexlify(invoiceId)]));
}

/** EIP-1167 init code hash used by OpenZeppelin `Clones.cloneDeterministic`. */
export function commerceMinimalProxyInitCodeHash(implementation: string): string {
  const impl = getAddress(implementation).slice(2).toLowerCase();
  return keccak256(`0x3d602d80600a3d3981f3363d3d373d3d3d363d73${impl}5af43d82803e903d91602b57fd5bf3`);
}

/** Offline CREATE2 prediction (no RPC). Matches `CommerceInvoiceSweeper.getInvoiceAddress`. */
export function predictCommerceInvoiceAddress(
  sweeperAddress: string,
  forwarderImplementation: string,
  to: string,
  invoiceId: BytesLike
): string {
  return getCreate2Address(
    getAddress(sweeperAddress),
    commerceInvoiceSalt(to, invoiceId),
    commerceMinimalProxyInitCodeHash(forwarderImplementation)
  );
}

export class CommerceInvoiceSdk {
  readonly provider: Provider;
  readonly signer?: Signer;
  readonly sweeperAddress: string;

  private readonly sweeper: Contract;

  constructor(config: CommerceInvoiceSdkConfig) {
    this.provider = config.provider;
    this.signer = config.signer;
    this.sweeperAddress = getAddress(config.sweeperAddress);
    this.sweeper = new Contract(
      this.sweeperAddress,
      COMMERCE_INVOICE_SWEEPER_ABI,
      config.signer ?? config.provider
    );
  }

  async getInvoiceAddress(to: string, invoiceId: BytesLike): Promise<string> {
    return getAddress(await this.sweeper.getInvoiceAddress(getAddress(to), hexlify(invoiceId)));
  }

  async getInvoiceAddressForParams(to: string, params: CommerceInvoiceParams): Promise<string> {
    return this.getInvoiceAddress(to, getCommerceInvoiceId(params));
  }

  async createInvoice(to: string, invoiceId: BytesLike): Promise<{
    invoiceId: string;
    invoiceAddress: string;
    tx: ContractTransactionResponse;
  }> {
    const normalizedId = hexlify(invoiceId);
    const tx = await this.requireSigner().createInvoice(getAddress(to), normalizedId);
    return {
      invoiceId: normalizedId,
      invoiceAddress: await this.getInvoiceAddress(to, normalizedId),
      tx,
    };
  }

  async quoteFee(token: string | undefined, amount: BigNumberish): Promise<bigint> {
    return BigInt(await this.sweeper.quoteFee(normalizeToken(token), amount));
  }

  async getBalance(invoiceAddress: string, token?: string): Promise<bigint> {
    const normalized = normalizeToken(token);
    if (normalized === NATIVE_TOKEN) {
      return this.provider.getBalance(invoiceAddress);
    }
    const erc20 = new Contract(normalized, ERC20_ABI, this.provider);
    return BigInt(await erc20.balanceOf(invoiceAddress));
  }

  async sweep(params: CommerceSweepParams): Promise<CommerceSweepResult> {
    const to = getAddress(params.to);
    const token = normalizeToken(params.token);
    const invoiceId = hexlify(params.invoiceId);
    const amount = BigInt(params.amount.toString());

    const invoiceAddress = await this.getInvoiceAddress(to, invoiceId);
    const balance = await this.getBalance(invoiceAddress, token);
    if (balance < amount) {
      throw new Error(`Insufficient invoice balance: have ${balance}, need ${amount}`);
    }

    const fee = await this.quoteFee(token, amount);
    const tx = await this.requireSigner().sweep(token, amount, to, invoiceId);

    return { invoiceId, token, to, amount, fee, tx };
  }

  async bulkSweep(calls: CommerceSweepParams[]): Promise<ContractTransactionResponse> {
    return this.requireSigner().bulkSweep(
      calls.map((c) => ({
        token: normalizeToken(c.token),
        amount: c.amount,
        to: getAddress(c.to),
        invoiceId: hexlify(c.invoiceId),
      }))
    );
  }

  private requireSigner(): Contract {
    if (!this.signer) {
      throw new Error("Signer required for write operations");
    }
    return this.sweeper.connect(this.signer) as Contract;
  }
}

function normalizeToken(token?: string): string {
  if (!token || token === "native" || token === "ETH" || token === "0x0") {
    return NATIVE_TOKEN;
  }
  return getAddress(token);
}

export { id as keccakId, toUtf8Bytes };
