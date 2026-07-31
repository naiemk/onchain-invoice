import { AbiCoder, BytesLike, dataLength, hexlify, keccak256, toUtf8Bytes } from "ethers";
import { TronWeb } from "tronweb";

const abi = AbiCoder.defaultAbiCoder();

export function normalizeInvoiceIdBytes32(value: BytesLike): string {
  if (dataLength(value) !== 32) throw new Error("invoiceId must be 32 bytes");
  return hexlify(value);
}

/** Hash the master secret to a fixed-width seed (env string → bytes32). */
export function hashTronInvoiceMasterSecret(masterSecret: string): string {
  return keccak256(toUtf8Bytes(masterSecret));
}

/**
 * Deterministic invoice EOA private key: keccak256(abi.encode(masterSecretHash, chainId, invoiceId)).
 * Same invoiceId + chain always yields the same TRON address (CREATE2-salt spirit).
 */
export function deriveTronInvoicePrivateKey(
  masterSecret: string,
  chainId: string | bigint,
  invoiceId: BytesLike
): string {
  const normalizedId = normalizeInvoiceIdBytes32(invoiceId);
  const secretHash = hashTronInvoiceMasterSecret(masterSecret);
  const encoded = abi.encode(["bytes32", "uint256", "bytes32"], [secretHash, BigInt(chainId), normalizedId]);
  return keccak256(encoded).replace(/^0x/, "");
}

/** Derive the base58 invoice address without exposing the private key beyond this call site. */
export function deriveTronInvoiceAddress(
  masterSecret: string,
  chainId: string | bigint,
  invoiceId: BytesLike,
  fullHost = "https://api.trongrid.io"
): string {
  const privateKey = deriveTronInvoicePrivateKey(masterSecret, chainId, invoiceId);
  const tronWeb = new TronWeb({ fullHost, privateKey });
  return tronWeb.defaultAddress.base58 as string;
}

export function tronAddressFromPrivateKey(privateKey: string, fullHost = "https://api.trongrid.io"): string {
  const normalized = privateKey.replace(/^0x/, "");
  const tronWeb = new TronWeb({ fullHost, privateKey: normalized });
  return tronWeb.defaultAddress.base58 as string;
}

/** TRON accounts need at least one inbound transfer to activate; unactivated accounts have no owner permission. */
export async function isTronAccountActivated(tronWeb: TronWeb, address: string): Promise<boolean> {
  try {
    const account = await tronWeb.trx.getAccount(address);
    return Boolean(account?.address);
  } catch {
    return false;
  }
}
