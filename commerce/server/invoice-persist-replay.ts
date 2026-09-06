import type { CommerceDb } from "./db.js";
import {
  collectPersistEvents,
  INVOICE_PERSIST_STREAM,
  type PersistLogEvent,
} from "./persist-log.js";
import type { InvoiceStatus, PaymentMode } from "../shared/types.js";

export { INVOICE_PERSIST_STREAM };

export type InvoicePersistSnapshot = {
  invoiceId: string;
  invoiceSeed: string;
  clientInvoiceId: string;
  priceUsd: string;
  toAddresses: string[];
  selectedTo: string | null;
  chainId: string | null;
  token: string | null;
  invoiceAddress: string | null;
  title: string | null;
  description: string | null;
  callbackUrl: string | null;
  allowPartial: boolean;
  paymentMode: PaymentMode;
  displayFiat: string | null;
  displayAmount: string | null;
  quoteCountry: string | null;
  quotePaymentMethod: string | null;
  quoteProvider: string | null;
  quoteSlippageBps: number | null;
  lang: string | null;
  status: InvoiceStatus;
  amountPaid: string;
  amountSwept: string;
  feeCollected: string;
  gasSpentWei: string;
  sweepTx: string | null;
  createdAt: string | null;
  paidAt: string | null;
  sweptAt: string | null;
  sawPaid: boolean;
  sawSwept: boolean;
};

export type InvoicePersistState = {
  invoices: Map<string, InvoicePersistSnapshot>;
};

export function emptyInvoicePersistState(): InvoicePersistState {
  return { invoices: new Map() };
}

function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((v) => String(v));
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (Array.isArray(parsed)) return parsed.map((v) => String(v));
    } catch {
      /* fall through */
    }
  }
  return [];
}

function optionalString(value: unknown): string | null {
  if (value == null) return null;
  return String(value);
}

export function applyInvoicePersistEvent(state: InvoicePersistState, evt: PersistLogEvent): InvoicePersistState {
  const p = evt.payload;
  const invoiceId = String(p.invoiceId ?? "");
  if (!invoiceId) return state;

  if (evt.type === "invoice.created") {
    state.invoices.set(invoiceId, {
      invoiceId,
      invoiceSeed: String(p.invoiceSeed ?? ""),
      clientInvoiceId: String(p.clientInvoiceId ?? ""),
      priceUsd: String(p.priceUsd ?? "0"),
      toAddresses: asStringArray(p.toAddresses),
      selectedTo: optionalString(p.selectedTo),
      chainId: optionalString(p.chainId),
      token: optionalString(p.token),
      invoiceAddress: optionalString(p.invoiceAddress),
      title: optionalString(p.title),
      description: optionalString(p.description),
      callbackUrl: optionalString(p.callbackUrl),
      allowPartial: Boolean(p.allowPartial),
      paymentMode: (p.paymentMode as PaymentMode) || "crypto",
      displayFiat: optionalString(p.displayFiat),
      displayAmount: optionalString(p.displayAmount),
      quoteCountry: optionalString(p.quoteCountry),
      quotePaymentMethod: optionalString(p.quotePaymentMethod),
      quoteProvider: optionalString(p.quoteProvider),
      quoteSlippageBps:
        typeof p.quoteSlippageBps === "number" && Number.isFinite(p.quoteSlippageBps)
          ? p.quoteSlippageBps
          : null,
      lang: optionalString(p.lang),
      status: "awaiting_payment",
      amountPaid: "0",
      amountSwept: "0",
      feeCollected: "0",
      gasSpentWei: "0",
      sweepTx: null,
      createdAt: optionalString(p.createdAt) ?? evt.ts,
      paidAt: null,
      sweptAt: null,
      sawPaid: false,
      sawSwept: false,
    });
    return state;
  }

  const current = state.invoices.get(invoiceId);
  if (!current) return state;

  if (evt.type === "invoice.paid") {
    const status = String(p.status ?? "paid") as InvoiceStatus;
    current.status = status === "paid_partial" ? "paid_partial" : "paid";
    current.amountPaid = String(p.amountPaid ?? current.amountPaid);
    current.amountSwept = String(p.amountSwept ?? current.amountSwept);
    current.feeCollected = String(p.feeCollected ?? current.feeCollected);
    current.gasSpentWei = String(p.gasSpentWei ?? current.gasSpentWei);
    current.paidAt = optionalString(p.paidAt) ?? current.paidAt ?? evt.ts;
    current.sawPaid = true;
  } else if (evt.type === "invoice.swept") {
    current.status = "swept";
    current.amountPaid = String(p.amountPaid ?? current.amountPaid);
    current.amountSwept = String(p.amountSwept ?? current.amountSwept);
    current.feeCollected = String(p.feeCollected ?? current.feeCollected);
    current.gasSpentWei = String(p.gasSpentWei ?? current.gasSpentWei);
    current.sweepTx = optionalString(p.sweepTx);
    current.paidAt = optionalString(p.paidAt) ?? current.paidAt ?? evt.ts;
    current.sweptAt = optionalString(p.sweptAt) ?? evt.ts;
    current.sawPaid = true;
    current.sawSwept = true;
  }
  return state;
}

export function replayInvoicePersistState(events: PersistLogEvent[]): InvoicePersistState {
  let state = emptyInvoicePersistState();
  for (const evt of events) {
    if (evt.stream !== INVOICE_PERSIST_STREAM) continue;
    state = applyInvoicePersistEvent(state, evt);
  }
  return state;
}

export function applyInvoicePersistStateToDb(db: CommerceDb, state: InvoicePersistState): void {
  db.runWithoutPersistLog(() => {
    for (const invoice of state.invoices.values()) {
      db.restorePersistedInvoice({
        invoiceId: invoice.invoiceId,
        invoiceSeed: invoice.invoiceSeed,
        clientInvoiceId: invoice.clientInvoiceId,
        priceUsd: invoice.priceUsd,
        toAddresses: invoice.toAddresses,
        selectedTo: invoice.selectedTo,
        chainId: invoice.chainId,
        token: invoice.token,
        invoiceAddress: invoice.invoiceAddress,
        title: invoice.title,
        description: invoice.description,
        callbackUrl: invoice.callbackUrl,
        allowPartial: invoice.allowPartial,
        paymentMode: invoice.paymentMode,
        displayFiat: invoice.displayFiat,
        displayAmount: invoice.displayAmount,
        quoteCountry: invoice.quoteCountry,
        quotePaymentMethod: invoice.quotePaymentMethod,
        quoteProvider: invoice.quoteProvider,
        quoteSlippageBps: invoice.quoteSlippageBps,
        lang: invoice.lang,
        status: invoice.status,
        amountPaid: invoice.amountPaid,
        amountSwept: invoice.amountSwept,
        feeCollected: invoice.feeCollected,
        gasSpentWei: invoice.gasSpentWei,
        sweepTx: invoice.sweepTx,
        createdAt: invoice.createdAt ?? undefined,
        paidAt: invoice.paidAt,
        sweptAt: invoice.sweptAt,
      });
      db.addEvent(invoice.invoiceId, "created", {
        restored: true,
        chainId: invoice.chainId,
        token: invoice.token,
        selectedTo: invoice.selectedTo,
        invoiceAddress: invoice.invoiceAddress,
      });
      if (invoice.sawPaid) {
        db.addEvent(invoice.invoiceId, "paid", { status: invoice.status === "swept" ? "paid" : invoice.status });
      }
      if (invoice.sawSwept) {
        db.addEvent(invoice.invoiceId, "swept", { status: "swept", sweepTx: invoice.sweepTx });
      }
    }
  });
}

export async function replayInvoicePersistLogToDb(db: CommerceDb, logDir: string): Promise<InvoicePersistState> {
  const events = await collectPersistEvents(logDir, INVOICE_PERSIST_STREAM);
  const state = replayInvoicePersistState(events);
  applyInvoicePersistStateToDb(db, state);
  return state;
}
