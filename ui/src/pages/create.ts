import { encodePayLink, invoiceIdFromPayLink, payPath } from "../shared/invoice.js";
import { copyText, escapeHtml } from "../shared/dom.js";
import { TOKENS, chainLogoSvg, deploymentMode, networksForDeployment } from "../shared/networks.js";
import type { PayLinkFields } from "../shared/types.js";

export function renderCreate(root: HTMLElement): void {
  const mode = deploymentMode();
  const networks = networksForDeployment(mode);
  const modeLabel = mode === "testnet" ? "Testnet" : "Mainnet";

  root.innerHTML = `
    <header class="page-header">
      <p class="eyebrow">Create invoice · ${escapeHtml(modeLabel)}</p>
      <h1>Build a payment link</h1>
      <p>Enter invoice details, copy a pay button for your site, and share the link. No wallet connection required.</p>
      <p class="callout info" role="status">
        This ${escapeHtml(modeLabel.toLowerCase())} UI only lists ${escapeHtml(modeLabel.toLowerCase())} networks.
        ${mode === "testnet" ? "Use the mainnet site for production chains." : "Use the testnet site for Sepolia and other test networks."}
      </p>
    </header>

    <div class="create-layout">
      <section class="panel">
        <form id="create-form" autocomplete="off">
          <div class="field">
            <label for="clientInvoiceId">Invoice client id <span class="required">*</span></label>
            <p class="field-hint">Your order or reference id. Stored as <span class="mono">client_invoice_id</span> and included in the deterministic invoice id.</p>
            <input id="clientInvoiceId" name="clientInvoiceId" required placeholder="order-1042" value="order-${Date.now()}" />
          </div>

          <div class="field">
            <label for="title">Title</label>
            <p class="field-hint">Optional heading shown on the customer checkout page.</p>
            <input id="title" name="title" placeholder="Invoice for Acme Co." />
          </div>

          <div class="field">
            <label for="description">Description</label>
            <p class="field-hint">Optional note for the payer — line items, due date, or context.</p>
            <textarea id="description" name="description" placeholder="Consulting — March 2026"></textarea>
          </div>

          <div class="field">
            <label for="price">Amount (USD) <span class="required">*</span></label>
            <p class="field-hint">Invoice total in USD. The payer settles an equivalent amount in the selected token.</p>
            <input id="price" name="price" required inputmode="decimal" placeholder="128.00" value="10.00" />
          </div>

          <div class="field">
            <label>Accepted networks <span class="required">*</span></label>
            <p class="field-hint">${escapeHtml(modeLabel)} chains the payer may choose at checkout. EVM networks share one merchant wallet below.</p>
            <div class="field-row" id="chains">
              ${
                networks.length === 0
                  ? `<p class="danger">No ${escapeHtml(modeLabel.toLowerCase())} networks are configured.</p>`
                  : networks
                      .map(
                        (n, i) => `
                <label class="check check-chain">
                  <input type="checkbox" name="chains" value="${escapeHtml(n.id)}" ${i === 0 ? "checked" : ""} />
                  ${chainLogoSvg(n.id, 18)}
                  <span>${escapeHtml(n.label)}</span>
                </label>`
                      )
                      .join("")
              }
            </div>
          </div>

          <div class="field">
            <label for="to">EVM merchant wallet <span class="required">*</span></label>
            <div class="callout danger wallet-settlement-note" role="note">
              <strong>Funds are swept to this address.</strong>
              The full invoice value (minus protocol fee) is sent here after payment.
              Make sure you can receive the selected tokens on this wallet on every network you enable —
              otherwise tokens may be lost permanently.
            </div>
            <p class="field-hint">Settlement address for all selected EVM networks. Bound into the invoice salt — sweeps cannot redirect funds elsewhere.</p>
            <input id="to" name="to" required class="mono" placeholder="0x…" autocomplete="off" spellcheck="false" />
          </div>

          <div class="field">
            <label>Accepted tokens <span class="required">*</span></label>
            <p class="field-hint">Stablecoins only for now (USD price maps 1:1). Native tokens need conversion we have not shipped yet.</p>
            <div class="field-row" id="tokens">
              ${TOKENS.map(
                (t, i) => `
                <label class="check">
                  <input type="checkbox" name="tokens" value="${escapeHtml(t.id)}" ${i < 2 ? "checked" : ""} />
                  ${escapeHtml(t.label)}
                </label>`
              ).join("")}
            </div>
          </div>

          <div class="field">
            <label for="callback">Callback URL</label>
            <p class="field-hint">Optional. After payment we POST a webhook here and redirect the browser with invoice status query params.</p>
            <input id="callback" name="callback" type="url" placeholder="https://shop.example/webhooks/trustless-commerce" />
          </div>

          <div class="field">
            <label class="check">
              <input type="checkbox" id="allowPartial" name="allowPartial" />
              Allow partial payments
            </label>
            <p class="field-hint">When enabled, underpayment can mark the invoice <span class="mono">paid_partial</span> instead of waiting for the full amount.</p>
          </div>
        </form>
      </section>

      <aside class="panel create-output" id="preview">
        <p class="eyebrow">Output</p>
        <h2>Pay link &amp; embed</h2>
        <p class="field-hint">Updates as you edit. Copy into your storefront or share the URL.</p>
        <div id="preview-body"></div>
      </aside>
    </div>

    <section class="docs-block" id="docs">
      <div class="panel panel-quiet">
        <p class="eyebrow">Developers</p>
        <h2>Create invoices programmatically</h2>
        <p>
          The same fields become a query string on <span class="mono">/pay</span>, or a JSON body for <span class="mono">POST /api/invoices</span>.
          Status is always available at the invoice id endpoint.
        </p>

        <h3 style="margin-top:1.5rem">1. Pay link query string</h3>
        <pre id="docs-query"></pre>

        <h3 style="margin-top:1.5rem">2. Create an invoice (one step)</h3>
        <pre>POST /api/invoices
Content-Type: application/json

{
  "price": "10.00",
  "to": ["0x…"],
  "chains": ["11155111"],
  "tokens": ["USDC"],
  "clientInvoiceId": "order-1042",
  "chainId": "11155111",
  "token": "USDC",
  "selectedTo": "0x…",
  "callback": "https://shop.example/hooks",
  "title": "Invoice",
  "description": "Optional",
  "allowPartial": false
}</pre>
        <p class="field-hint">Idempotent by deterministic invoice id. Deprecated: <span class="mono">/api/sessions</span> and <span class="mono">/api/invoices/activate</span>.</p>

        <h3 style="margin-top:1.5rem">3. Check invoice status</h3>
        <pre>GET /api/invoices/{invoiceId}

Statuses: created · awaiting_payment · paid · paid_partial · swept</pre>

        <h3 style="margin-top:1.5rem">For AI agents</h3>
        <p>
          Use the project Cursor skill
          <a href="https://raw.githubusercontent.com/naiemk/onchain-invoice/main/.cursor/skills/trustless-commerce-invoice/SKILL.md"
             rel="alternate noopener noreferrer"
             target="_blank"><span class="mono">.cursor/skills/trustless-commerce-invoice/SKILL.md</span></a>
          to create invoices and poll status without a merchant dashboard. Full docs:
          <a href="https://naiemk.github.io/onchain-invoice/" target="_blank" rel="noopener noreferrer">GitHub Pages</a>.
        </p>
      </div>
    </section>
  `;

  const form = root.querySelector<HTMLFormElement>("#create-form");
  const previewBody = root.querySelector<HTMLElement>("#preview-body");
  const docsQuery = root.querySelector<HTMLElement>("#docs-query");

  const refresh = () => {
    try {
      const fields = readForm(root);
      const invoiceId = invoiceIdFromPayLink(fields);
      const path = payPath(fields);
      const absolute = `${location.origin}${path}`;
      const statusUrl = `${location.origin}/api/invoices/${invoiceId}`;
      const embed = `<a href="${absolute}" class="tc-pay-button" target="_blank" rel="noopener noreferrer">Pay $${fields.price} with crypto</a>`;

      if (previewBody) {
        previewBody.innerHTML = `
          <label class="field-hint">Invoice id</label>
          <div class="mono-block" id="out-id">${escapeHtml(invoiceId)}</div>
          <label class="field-hint">Pay URL</label>
          <div class="mono-block" id="out-url">${escapeHtml(absolute)}</div>
          <label class="field-hint">Embed button</label>
          <div class="mono-block" id="out-embed">${escapeHtml(embed)}</div>
          <label class="field-hint">Status API</label>
          <div class="mono-block" id="out-status">GET ${escapeHtml(statusUrl)}</div>
          <p class="field-hint">Poll this endpoint after activation to read payment status. No auth required for a single invoice id.</p>
          <div class="btn-row">
            <button type="button" class="secondary" data-copy="url">Copy pay URL</button>
            <button type="button" class="secondary" data-copy="embed">Copy embed</button>
            <button type="button" class="secondary" data-copy="status">Copy status URL</button>
            <a class="tc-btn" href="${path}" target="_blank" rel="noopener noreferrer">Open checkout</a>
          </div>
          <p id="copy-status" class="status"></p>
          <label class="field-hint" style="margin-top:1rem">Rendered pay button</label>
          <div class="pay-button-preview">
            <a href="${path}" class="tc-pay-button" target="_blank" rel="noopener noreferrer">Pay $${escapeHtml(fields.price)} with crypto</a>
          </div>
        `;

        previewBody.querySelectorAll<HTMLButtonElement>("[data-copy]").forEach((btn) => {
          btn.addEventListener("click", async () => {
            const kind = btn.dataset.copy;
            const value = kind === "url" ? absolute : kind === "embed" ? embed : statusUrl;
            await copyText(value);
            const note = previewBody.querySelector<HTMLElement>("#copy-status");
            if (note) note.textContent = "Copied to clipboard.";
          });
        });
      }

      if (docsQuery) {
        docsQuery.textContent = `/pay?${encodePayLink(fields)}`;
      }
    } catch (error) {
      if (previewBody) {
        previewBody.innerHTML = `<p class="danger">${escapeHtml(
          error instanceof Error ? error.message : "Invalid form"
        )}</p>`;
      }
    }
  };

  form?.addEventListener("input", refresh);
  form?.addEventListener("change", refresh);
  refresh();

  if (location.hash === "#docs") {
    root.querySelector("#docs")?.scrollIntoView({ behavior: "smooth" });
  }
}

function readForm(root: HTMLElement): PayLinkFields {
  const value = (id: string) =>
    root.querySelector<HTMLInputElement | HTMLTextAreaElement>(`#${id}`)?.value.trim() ?? "";
  const checked = (name: string) =>
    [...root.querySelectorAll<HTMLInputElement>(`input[name="${name}"]:checked`)].map((el) => el.value);

  const price = value("price");
  const clientInvoiceId = value("clientInvoiceId");
  const toRaw = value("to");
  const chains = checked("chains");
  const tokens = checked("tokens");

  if (!clientInvoiceId) throw new Error("Invoice client id is required.");
  if (!price) throw new Error("Amount (USD) is required.");
  if (!toRaw) throw new Error("EVM merchant wallet is required.");
  if (chains.length === 0) throw new Error("Select at least one network.");
  if (tokens.length === 0) throw new Error("Select at least one token.");

  return {
    price,
    to: toRaw.split(",").map((s) => s.trim()).filter(Boolean),
    chains,
    tokens,
    clientInvoiceId,
    callback: value("callback") || undefined,
    title: value("title") || undefined,
    description: value("description") || undefined,
    allowPartial: root.querySelector<HTMLInputElement>("#allowPartial")?.checked ?? false,
  };
}
