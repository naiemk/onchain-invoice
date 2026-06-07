import type {
  CreateSessionBody,
  CreateSessionResponse,
  JsonObject,
  JsonValue,
  ListInvoicesResponse,
  RegisterInvoiceBody,
  WebInvoiceRecord,
} from "./web-server.js";

export interface InvoiceWebClientOptions {
  baseUrl: string;
  token?: string;
  nodeApiKey?: string;
  fetch?: typeof fetch;
}

export interface ListInvoicesParams {
  limit?: number;
  cursor?: string;
  lookbackMs?: number;
}

export class InvoiceWebClient<TInput = JsonValue, TInvoice extends JsonObject = JsonObject> {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private token?: string;
  private readonly nodeApiKey?: string;

  constructor(options: InvoiceWebClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.token = options.token;
    this.nodeApiKey = options.nodeApiKey;
    this.fetchImpl = options.fetch ?? fetch;
  }

  setToken(token: string) {
    this.token = token;
  }

  async createSession(body: CreateSessionBody = {}): Promise<CreateSessionResponse> {
    const response = await this.request<CreateSessionResponse>("/sessions", {
      method: "POST",
      body,
      auth: false,
    });
    this.token = response.token;
    return response;
  }

  async registerInvoice(
    input: TInput,
    options: Omit<RegisterInvoiceBody<TInput>, "input"> = {}
  ): Promise<WebInvoiceRecord<TInput, TInvoice>> {
    return this.request<WebInvoiceRecord<TInput, TInvoice>>("/invoices", {
      method: "POST",
      body: { ...options, input },
      auth: true,
    });
  }

  async myInvoices(limit?: number): Promise<ListInvoicesResponse<TInput, TInvoice>> {
    const search = new URLSearchParams();
    if (limit !== undefined) search.set("limit", String(limit));
    return this.request<ListInvoicesResponse<TInput, TInvoice>>(`/me/invoices?${search}`, {
      method: "GET",
      auth: true,
    });
  }

  async fetchInvoice(invoiceId: string): Promise<WebInvoiceRecord<TInput, TInvoice>> {
    return this.request<WebInvoiceRecord<TInput, TInvoice>>(`/invoices/${encodeURIComponent(invoiceId)}`, {
      method: "GET",
      auth: true,
    });
  }

  async listInvoices(params: ListInvoicesParams = {}): Promise<ListInvoicesResponse<TInput, TInvoice>> {
    const search = new URLSearchParams();
    if (params.limit !== undefined) search.set("limit", String(params.limit));
    if (params.cursor !== undefined) search.set("cursor", params.cursor);
    if (params.lookbackMs !== undefined) search.set("lookbackMs", String(params.lookbackMs));

    return this.request<ListInvoicesResponse<TInput, TInvoice>>(`/invoices?${search}`, {
      method: "GET",
      auth: true,
    });
  }

  private async request<T>(
    path: string,
    options: {
      method: "GET" | "POST";
      body?: unknown;
      auth: boolean;
    }
  ): Promise<T> {
    const headers: Record<string, string> = {};
    if (options.body !== undefined) headers["content-type"] = "application/json";
    if (options.auth) {
      if (this.token) headers.authorization = `Bearer ${this.token}`;
      if (this.nodeApiKey) headers["x-api-key"] = this.nodeApiKey;
    }

    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method: options.method,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });

    const text = await response.text();
    const parsed = text.length > 0 ? JSON.parse(text) : undefined;

    if (!response.ok) {
      const message =
        parsed && typeof parsed === "object" && "error" in parsed ? String(parsed.error) : response.statusText;
      throw new Error(message);
    }

    return parsed as T;
  }
}
