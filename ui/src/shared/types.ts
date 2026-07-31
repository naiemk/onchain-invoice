export type InvoiceStatus = "created" | "awaiting_payment" | "paid" | "paid_partial" | "swept";

export type InvoiceEventKind = "created" | "paid" | "swept" | "callback" | "error" | "force_sweep";

export interface PayLinkFields {
  price: string;
  to: string[];
  chains: string[];
  tokens: string[];
  clientInvoiceId: string;
  callback?: string;
  title?: string;
  description?: string;
  allowPartial: boolean;
}

export interface InvoiceRecord {
  id: string;
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

export interface CreateSessionResponse {
  paySessionId: string;
  invoiceId: string;
  expiresAt: string;
  payLink: string;
  invoice: InvoiceRecord;
}

export interface ActivateInvoiceResponse {
  invoice: InvoiceRecord;
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
