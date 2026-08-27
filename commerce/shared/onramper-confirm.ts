/**
 * Onramper sell (offramp) transaction confirmation.
 * @see https://docs.onramper.com/reference/post_transactions-confirm-type
 */

import { onramperApiHost } from "./onramper-quotes.js";

export interface ConfirmOfframpTransactionInput {
  apiKey: string;
  widgetOrigin: string;
  transactionId: string;
  transactionHash: string;
  sourceAddress: string;
  targetAddress: string;
}

export async function confirmOnramperOfframpTransaction(
  input: ConfirmOfframpTransactionInput
): Promise<{ status: string }> {
  const host = onramperApiHost(input.apiKey, input.widgetOrigin);
  const res = await fetch(`${host}/transactions/confirm/offramp`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Authorization: input.apiKey,
    },
    body: JSON.stringify({
      transactionId: input.transactionId,
      transactionHash: input.transactionHash,
      sourceAddress: input.sourceAddress,
      targetAddress: input.targetAddress,
    }),
  });
  const text = await res.text();
  let body: unknown = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { raw: text };
  }
  if (!res.ok) {
    const msg =
      typeof body === "object" && body && "message" in body
        ? String((body as { message: unknown }).message)
        : `Onramper confirm failed (${res.status})`;
    throw Object.assign(new Error(msg), { statusCode: 502, details: body });
  }
  const status =
    typeof body === "object" && body && "status" in body
      ? String((body as { status: unknown }).status)
      : "success";
  return { status };
}
