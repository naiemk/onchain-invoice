export type InvoiceStatus = "created" | "awaiting_payment" | "paid" | "paid_partial" | "swept";

export type InvoiceEventKind = "created" | "paid" | "swept" | "callback" | "error" | "force_sweep" | "claimed";

export interface PayLinkFields {
  price: string;
  to: string[];
  chains: string[];
  tokens: string[];
  invoiceSeed: string;
  clientInvoiceId?: string;
  callback?: string;
  title?: string;
  description?: string;
  allowPartial: boolean;
}

export interface InvoiceRecord {
  id: string;
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
  status: InvoiceStatus;
  amountPaid: string;
  amountSwept: string;
  feeCollected: string;
  gasSpentWei: string;
  sweepTx: string | null;
  paySessionId: string | null;
  version: number;
  claimedBy: string | null;
  claimedUntil: string | null;
  createdAt: string;
  updatedAt: string;
  paidAt: string | null;
  sweptAt: string | null;
}

export interface InvoiceEvent {
  id: number;
  invoiceId: string;
  kind: InvoiceEventKind;
  payload: unknown;
  createdAt: string;
}

export interface InvoiceWithEvents extends InvoiceRecord {
  events: InvoiceEvent[];
}

export interface CreateInvoiceResponse {
  invoice: InvoiceRecord;
  created: boolean;
  payLink: string;
}

/** @deprecated Use CreateInvoiceResponse / POST /api/invoices */
export interface CreateSessionResponse {
  paySessionId: string;
  invoiceId: string;
  expiresAt: string;
  payLink: string;
  invoice: InvoiceRecord;
}

/** @deprecated Use CreateInvoiceResponse / POST /api/invoices */
export interface ActivateInvoiceResponse {
  invoice: InvoiceRecord;
}

export interface SweeperRecord {
  address: string;
  label: string;
  chains: string[];
  enabled: boolean;
  createdAt: string;
  lastSeenAt: string | null;
}

export interface AdminStats {
  fees: string;
  gas: string;
  inFlight: number;
  byTo: Array<{
    to: string;
    count: number;
    amountPaid: string;
    amountSwept: string;
    feeCollected: string;
  }>;
}
