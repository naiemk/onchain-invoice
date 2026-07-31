import { AbiCoder, getAddress, keccak256, type BytesLike } from "ethers";

export interface CommerceInvoiceParams {
  priceUsd: string;
  toAddresses: string[];
  clientInvoiceId: string;
  callbackUrl?: string;
  title?: string;
  description?: string;
  allowPartial?: boolean;
  chains?: string[];
  tokens?: string[];
}

export function getCommerceInvoiceId(params: CommerceInvoiceParams | BytesLike): string {
  if (typeof params === "string" || params instanceof Uint8Array) {
    return keccak256(params);
  }
  const encoded = AbiCoder.defaultAbiCoder().encode(
    ["string", "address[]", "string", "string", "string", "string", "bool"],
    [
      params.priceUsd,
      params.toAddresses.map((address) => getAddress(address)),
      params.clientInvoiceId,
      params.callbackUrl ?? "",
      params.title ?? "",
      params.description ?? "",
      params.allowPartial ?? false,
    ]
  );
  return keccak256(encoded);
}
