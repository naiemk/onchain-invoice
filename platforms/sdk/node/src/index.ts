export type InvoiceStatus =
  | "created"
  | "awaiting_payment"
  | "paid"
  | "paid_partial"
  | "swept";

export interface CreateInvoiceInput {
  price: string;
  to: string[];
  chains: string[];
  tokens: string[];
  chainId?: string;
  token?: string;
  selectedTo?: string;
  clientInvoiceId?: string;
  callback?: string;
  title?: string;
  description?: string;
  allowPartial?: boolean;
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
  callbackUrl: string | null;
  allowPartial: boolean;
  status: InvoiceStatus;
  amountPaid: string;
  amountSwept: string;
  createdAt: string;
  updatedAt: string;
  paidAt: string | null;
  sweptAt: string | null;
}

export interface CreateInvoiceResponse {
  invoice: InvoiceRecord;
  created: boolean;
  payLink: string;
  checkoutLink: string;
}

export interface GetInvoiceResponse extends InvoiceRecord {
  events?: Array<{ kind: string; payload: unknown; createdAt: string }>;
}

export interface CallbackPayload {
  type: "invoice.updated";
  invoice: InvoiceRecord;
}

export interface TrustlessCommerceClientOptions {
  /** Base URL of the hosted Trustless Commerce deployment, e.g. https://pay.example.com */
  baseUrl: string;
  /** Optional default fetch implementation (for tests) */
  fetch?: typeof fetch;
}

export class TrustlessCommerceError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
    readonly body?: unknown
  ) {
    super(message);
    this.name = "TrustlessCommerceError";
  }
}

export function isPaidLikeStatus(status: InvoiceStatus): boolean {
  return status === "paid" || status === "paid_partial" || status === "swept";
}

export function absoluteUrl(baseUrl: string, path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  const base = baseUrl.replace(/\/+$/, "");
  const rel = path.startsWith("/") ? path : `/${path}`;
  return `${base}${rel}`;
}

export class TrustlessCommerceClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: TrustlessCommerceClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.fetchImpl = options.fetch ?? fetch;
  }

  /** Create (or idempotently replay) an invoice. */
  async createInvoice(
    input: CreateInvoiceInput,
    idempotencyKey?: string
  ): Promise<CreateInvoiceResponse> {
    const headers: Record<string, string> = {
      "content-type": "application/json",
      accept: "application/json",
    };
    if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;

    const body = {
      ...input,
      chainId: input.chainId ?? input.chains[0],
      token: input.token ?? input.tokens[0],
      selectedTo: input.selectedTo ?? input.to[0],
    };

    return this.request<CreateInvoiceResponse>("POST", "/api/invoices", { headers, body });
  }

  /** Poll invoice status (includes events). */
  async getInvoice(invoiceId: string): Promise<GetInvoiceResponse> {
    return this.request<GetInvoiceResponse>("GET", `/api/invoices/${encodeURIComponent(invoiceId)}`);
  }

  /** Build absolute hosted checkout URL from create response. */
  checkoutUrl(response: Pick<CreateInvoiceResponse, "payLink">): string {
    return absoluteUrl(this.baseUrl, response.payLink);
  }

  /** Parse and validate a callback webhook body. */
  parseCallbackPayload(raw: unknown): CallbackPayload {
    if (!raw || typeof raw !== "object") {
      throw new Error("Invalid callback payload");
    }
    const payload = raw as Record<string, unknown>;
    if (payload.type !== "invoice.updated" || !payload.invoice || typeof payload.invoice !== "object") {
      throw new Error("Expected { type: 'invoice.updated', invoice: {...} }");
    }
    return { type: "invoice.updated", invoice: payload.invoice as InvoiceRecord };
  }

  private async request<T>(
    method: string,
    path: string,
    init?: { headers?: Record<string, string>; body?: unknown }
  ): Promise<T> {
    const url = absoluteUrl(this.baseUrl, path);
    const response = await this.fetchImpl(url, {
      method,
      headers: init?.headers,
      body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
    });

    let parsed: unknown;
    const text = await response.text();
    try {
      parsed = text ? JSON.parse(text) : {};
    } catch {
      parsed = { raw: text };
    }

    if (!response.ok) {
      const message =
        typeof parsed === "object" && parsed && "error" in parsed
          ? String((parsed as { error: unknown }).error)
          : `HTTP ${response.status}`;
      throw new TrustlessCommerceError(message, response.status, parsed);
    }

    return parsed as T;
  }
}

export { TrustlessCommerceClient as default };
