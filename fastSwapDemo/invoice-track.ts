import type { FastSwapInvoiceTrackPatch } from "../app/fastswap/shared/types.js";

export async function postInvoiceTrack(
  baseUrl: string,
  apiKey: string,
  invoiceId: string,
  patch: FastSwapInvoiceTrackPatch
): Promise<void> {
  const base = baseUrl.replace(/\/$/, "");
  const response = await fetch(`${base}/invoices/${encodeURIComponent(invoiceId)}/track`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": apiKey },
    body: JSON.stringify(patch),
  });
  if (!response.ok) {
    console.error("[invoice-track]", response.status, await response.text());
  }
}
