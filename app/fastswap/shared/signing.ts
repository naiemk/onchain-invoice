import { createHmac, timingSafeEqual } from "node:crypto";
import type { FastSwapInvoice } from "./types.js";

export type SignedInvoiceFields = Pick<
  FastSwapInvoice,
  | "invoiceId"
  | "data"
  | "recipient"
  | "sourceChainId"
  | "targetChainId"
  | "sourceToken"
  | "targetToken"
  | "sourceAmount"
  | "targetAmount"
>;

export function invoiceSigningPayload(invoice: SignedInvoiceFields): string {
  return JSON.stringify({
    invoiceId: invoice.invoiceId,
    data: invoice.data,
    recipient: invoice.recipient,
    sourceChainId: invoice.sourceChainId,
    targetChainId: invoice.targetChainId,
    sourceToken: invoice.sourceToken,
    targetToken: invoice.targetToken,
    sourceAmount: invoice.sourceAmount,
    targetAmount: invoice.targetAmount,
  });
}

export function signInvoice(invoice: SignedInvoiceFields, secret: string): string {
  return createHmac("sha256", secret).update(invoiceSigningPayload(invoice)).digest("hex");
}

export function verifyInvoiceSignature(invoice: SignedInvoiceFields & { signature?: string }, secret: string): boolean {
  if (!invoice.signature) return false;
  const expected = signInvoice(invoice, secret);
  try {
    return timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(invoice.signature, "hex"));
  } catch {
    return false;
  }
}

export function verifyNodeAuth(secret: string | undefined, provided: string | undefined): boolean {
  if (!secret || !provided) return false;
  try {
    return timingSafeEqual(Buffer.from(secret), Buffer.from(provided));
  } catch {
    return false;
  }
}
