import { decodePayLink, encodePayLink, invoiceIdFromPayLink } from "../shared/invoice.js";
import type {
  ActivateInvoiceResponse,
  CreateSessionResponse,
  InvoiceStatus,
  InvoiceWithEvents,
  PayLinkFields,
} from "../shared/types.js";

const ACTIVATION_KEY = (invoiceId: string) => `tc.activation.${invoiceId}`;

export function renderPay(root: HTMLElement): void {
  let fields: PayLinkFields;
  try {
    fields = decodePayLink(location.search);
  } catch (error) {
    root.innerHTML = `
      <section class="panel">
        <h1>Pay link missing</h1>
        <p class="danger">${error instanceof Error ? error.message : "Invalid pay link"}</p>
        <p>Example: <span class="mono">/pay?price=10&to=0xabc&chains=11155111&tokens=USDC&client_invoice_id=order-1&callback=https://...&title=Order&allow_partial=0</span></p>
      </section>
    `;
    return;
  }

  const invoiceId = invoiceIdFromPayLink(fields);
  const sessionKey = `tc.session.${invoiceId}`;
  const cached = readJson<CreateSessionResponse>(sessionKey);
  const activation = readJson<ActivateInvoiceResponse>(ACTIVATION_KEY(invoiceId));
  root.innerHTML = view(fields, invoiceId, cached, activation);

  const status = root.querySelector<HTMLElement>("#pay-status");
  const activate = root.querySelector<HTMLButtonElement>("#activate");
  const copy = root.querySelector<HTMLButtonElement>("#copy-link");

  copy?.addEventListener("click", async () => {
    await navigator.clipboard.writeText(`${location.origin}/pay?${encodePayLink(fields)}`);
    if (status) status.textContent = "Pay link copied.";
  });

  if (!cached) {
    void createSession(fields, sessionKey, status).then(() => renderPay(root));
    return;
  }

  activate?.addEventListener("click", async () => {
    const chainId = root.querySelector<HTMLSelectElement>("#chain")?.value ?? fields.chains[0];
    const token = root.querySelector<HTMLSelectElement>("#token")?.value ?? fields.tokens[0];
    const selectedTo = root.querySelector<HTMLSelectElement>("#to")?.value ?? fields.to[0];
    if (status) status.textContent = "Activating invoice address...";
    try {
      const session = readJson<CreateSessionResponse>(sessionKey);
      const response = await fetch("/api/invoices/activate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...fieldsToBody(fields),
          paySessionId: session?.paySessionId,
          chainId,
          token,
          selectedTo,
        }),
      });
      const body = (await response.json()) as ActivateInvoiceResponse & { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Activation failed");
      sessionStorage.setItem(ACTIVATION_KEY(invoiceId), JSON.stringify(body));
      renderPay(root);
    } catch (error) {
      if (status) status.textContent = error instanceof Error ? error.message : "Activation failed";
    }
  });

  if (activation?.invoice?.invoiceAddress || activation?.invoice?.status === "awaiting_payment") {
    startPolling(invoiceId, fields, status);
  }
}

function startPolling(
  invoiceId: string,
  fields: PayLinkFields,
  status: HTMLElement | null
): void {
  let stopped = false;
  const poll = async () => {
    if (stopped) return;
    try {
      const response = await fetch(`/api/invoices/${encodeURIComponent(invoiceId)}`);
      if (response.ok) {
        const invoice = (await response.json()) as InvoiceWithEvents;
        sessionStorage.setItem(ACTIVATION_KEY(invoiceId), JSON.stringify({ invoice }));
        updateStatusFromInvoice(status, invoice);
        if (isPaidLike(invoice.status)) {
          stopped = true;
          if (fields.callback) {
            const url = new URL(fields.callback);
            url.searchParams.set("invoice_id", invoiceId);
            url.searchParams.set("client_invoice_id", fields.clientInvoiceId);
            url.searchParams.set("status", invoice.status);
            setTimeout(() => {
              location.href = url.toString();
            }, 1500);
          }
          return;
        }
      }
    } catch {
      /* keep polling */
    }
    setTimeout(() => void poll(), 4000);
  };
  void poll();
}

function isPaidLike(status: InvoiceStatus): boolean {
  return status === "paid" || status === "paid_partial" || status === "swept";
}

function updateStatusFromInvoice(status: HTMLElement | null, invoice: InvoiceWithEvents): void {
  if (!status) return;
  const address = invoice.invoiceAddress ?? "pending address";
  status.innerHTML = `
    <strong>Status: ${escapeHtml(invoice.status)}</strong><br />
    Send ${escapeHtml(invoice.token ?? "token")} on chain ${escapeHtml(invoice.chainId ?? "?")}<br />
    <span class="mono">${escapeHtml(address)}</span>
    ${
      isPaidLike(invoice.status)
        ? `<p class="ok">Payment received${invoice.callbackUrl ? " — redirecting…" : "."}</p>`
        : "<p>Waiting for on-chain payment. Refresh is safe.</p>"
    }
  `;
}

function view(
  fields: PayLinkFields,
  invoiceId: string,
  session: CreateSessionResponse | null,
  activation: ActivateInvoiceResponse | null
): string {
  const invoice = activation?.invoice;
  return `
    <section class="grid">
      <div class="panel">
        <p class="eyebrow">Pay invoice</p>
        <h1>${escapeHtml(fields.title ?? "Checkout")}</h1>
        <p>${escapeHtml(fields.description ?? "Complete this shop payment with a deterministic crypto invoice address.")}</p>
        <h2>$${escapeHtml(fields.price)}</h2>
        <p class="mono">${escapeHtml(invoiceId)}</p>
        <label>Merchant address
          <select id="to">${fields.to.map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join("")}</select>
        </label>
        <label>Chain
          <select id="chain">${fields.chains.map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join("")}</select>
        </label>
        <label>Token
          <select id="token">${fields.tokens.map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join("")}</select>
        </label>
        <button id="activate">${invoice?.invoiceAddress ? "Refresh invoice address" : "Get invoice address"}</button>
        <button id="copy-link" class="secondary" style="margin-left: .5rem">Copy pay link</button>
        <div id="pay-status" class="status">
          ${
            invoice?.invoiceAddress
              ? `<strong>Status: ${escapeHtml(invoice.status)}</strong><br /><span class="mono">${escapeHtml(invoice.invoiceAddress)}</span>`
              : session
                ? `Session ${escapeHtml(session.paySessionId)} ready. Choose chain/token and continue.`
                : "Creating refresh-safe pay session..."
          }
        </div>
      </div>
      <aside class="card">
        <h2>Payment notes</h2>
        <p>Keep this tab open until the shop confirms payment. The pay session is cached in sessionStorage for refresh resilience.</p>
        <p>Partial payments are ${fields.allowPartial ? "allowed" : "not allowed"} for this invoice.</p>
      </aside>
    </section>
  `;
}

async function createSession(fields: PayLinkFields, sessionKey: string, status: HTMLElement | null): Promise<void> {
  try {
    const response = await fetch("/api/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(fieldsToBody(fields)),
    });
    const body = (await response.json()) as CreateSessionResponse & { error?: string };
    if (!response.ok) throw new Error(body.error ?? "Session failed");
    sessionStorage.setItem(sessionKey, JSON.stringify(body));
  } catch (error) {
    if (status) status.textContent = error instanceof Error ? error.message : "Session failed";
  }
}

function readJson<T>(key: string): T | null {
  const raw = sessionStorage.getItem(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    sessionStorage.removeItem(key);
    return null;
  }
}

function fieldsToBody(fields: PayLinkFields): Record<string, unknown> {
  return {
    price: fields.price,
    to: fields.to,
    chains: fields.chains,
    tokens: fields.tokens,
    clientInvoiceId: fields.clientInvoiceId,
    callback: fields.callback,
    title: fields.title,
    description: fields.description,
    allowPartial: fields.allowPartial,
  };
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] ?? char
  );
}
