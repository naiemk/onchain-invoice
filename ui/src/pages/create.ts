import { encodePayLink, payPath } from "../shared/invoice.js";
import { copyText, escapeHtml } from "../shared/dom.js";
import {
  chainLogoSvg,
  deploymentMode,
  networkKind,
  networksForDeployment,
  normalizeAddress,
  tokenAllowedOnChain,
  tokensForChains,
  type ChainKind,
  type NetworkOption,
} from "../shared/networks.js";
import type { PayLinkFields } from "../shared/types.js";

export function renderCreate(root: HTMLElement): void {
  const mode = deploymentMode();
  const networks = networksForDeployment(mode);
  const modeLabel = mode === "testnet" ? "Testnet" : "Mainnet";
  const initialOrderId = `order-${Date.now().toString(36)}`;

  root.innerHTML = `
    <header class="page-header">
      <p class="eyebrow">Create invoice · ${escapeHtml(modeLabel)}</p>
      <h1>Build a payment link</h1>
      <p>Enter invoice details, copy a pay button for your site, and share the link. No wallet connection required.</p>
      <p class="callout info" role="status">
        This ${escapeHtml(modeLabel.toLowerCase())} UI only lists ${escapeHtml(modeLabel.toLowerCase())} networks.
        ${mode === "testnet" ? "Use the mainnet site for production chains." : "Use the testnet site for Sepolia, Nile, and other test networks."}
      </p>
    </header>

    <div class="create-layout">
      <section class="panel">
        <form id="create-form" autocomplete="off">
          <div class="field">
            <label for="clientInvoiceId">Order / reference id</label>
            <p class="field-hint">Optional. Your local client id as managed by your system — not part of the on-chain invoice id. The invoice seed and invoice id are assigned by the API when the payer continues checkout.</p>
            <input id="clientInvoiceId" name="clientInvoiceId" class="mono" placeholder="order-…" value="${escapeHtml(initialOrderId)}" />
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
            <p class="field-hint">Tap a chain to enable it (at least one required). Each selected network kind needs its own merchant wallet below.</p>
            <div class="chain-pill-row" id="chains" role="group" aria-label="Accepted networks">
              ${
                networks.length === 0
                  ? `<p class="danger">No ${escapeHtml(modeLabel.toLowerCase())} networks are configured.</p>`
                  : networks.map((n, i) => chainPillHtml(n, i === 0)).join("")
              }
            </div>
          </div>

          <div class="field" id="evm-wallet-field" hidden>
            <label for="toEvm">EVM merchant wallet <span class="required">*</span></label>
            <div class="callout info wallet-settlement-note" role="note">
              <strong>Funds are swept to this address.</strong>
              The full invoice value (minus protocol fee) is sent here after payment.
              Make sure you can receive the selected tokens on this wallet on every EVM network you enable —
              otherwise tokens may be lost permanently.
            </div>
            <p class="field-hint">EIP-55 checksummed <span class="mono">0x</span> address (MetaMask copy format). Bound into the invoice salt — sweeps cannot redirect funds elsewhere.</p>
            <input id="toEvm" name="toEvm" class="mono" placeholder="0x…" autocomplete="off" spellcheck="false" disabled />
            <p class="field-error" id="toEvm-error" hidden></p>
          </div>

          <div class="field" id="tron-wallet-field" hidden>
            <label for="toTron">Tron merchant wallet <span class="required">*</span></label>
            <div class="callout info wallet-settlement-note" role="note">
              <strong>Funds are swept to this address.</strong>
              USDT on Tron is sent here after payment. Use a wallet that can receive TRC-20 on the selected Tron network.
            </div>
            <p class="field-hint">Valid base58check address starting with <span class="mono">T</span>. Bound into the invoice id with your EVM wallet when both are used.</p>
            <input id="toTron" name="toTron" class="mono" placeholder="T…" autocomplete="off" spellcheck="false" disabled />
            <p class="field-error" id="toTron-error" hidden></p>
          </div>

          <div class="field" id="solana-wallet-field" hidden>
            <label for="toSolana">Solana merchant wallet <span class="required">*</span></label>
            <div class="callout info wallet-settlement-note" role="note">
              <strong>Funds are swept to this address.</strong>
              Devnet USDC is settled here by the program — the sweeper cannot redirect to another wallet.
            </div>
            <p class="field-hint">Base58 Solana pubkey. Bound into the invoice PDA seeds with the invoice id.</p>
            <input id="toSolana" name="toSolana" class="mono" placeholder="So…" autocomplete="off" spellcheck="false" disabled />
            <p class="field-error" id="toSolana-error" hidden></p>
          </div>

          <div class="field">
            <label>Accepted tokens <span class="required">*</span></label>
            <p class="field-hint">Base → USDC, BNB → USDC/USDT, Sepolia → USDC/USDT, Tron → USDT (required when Tron is on). Only offer tokens your sweeper is configured to settle.</p>
            <div class="field-row" id="tokens"></div>
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
          The same fields become a query string on <span class="mono">/pay</span> (no invoice id / seed), or a JSON body for
          <span class="mono">POST /api/invoices</span>, which assigns a random seed and returns the created invoice id. Poll status with
          <span class="mono">GET /api/invoices/&#123;invoiceId&#125;</span>.
        </p>

        <h3 style="margin-top:1.5rem">1. Pay link query string</h3>
        <p class="field-hint">Shareable checkout URL. It does <strong>not</strong> include <span class="mono">invoice_seed</span> or an invoice id — those are created server-side when checkout continues.</p>
        <pre id="docs-query"></pre>

        <h3 style="margin-top:1.5rem">2. Create an invoice (one step)</h3>
        <pre>POST /api/invoices
Content-Type: application/json

{
  "price": "10.00",
  "to": ["0x…", "T…"],
  "chains": ["11155111", "nile"],
  "tokens": ["USDC", "USDT"],
  "clientInvoiceId": "order-1042",
  "chainId": "11155111",
  "token": "USDC",
  "selectedTo": "0x…",
  "callback": "https://shop.example/hooks",
  "title": "Invoice",
  "description": "Optional",
  "allowPartial": false
}</pre>
        <p class="field-hint">Do not send <span class="mono">invoiceSeed</span> — the API generates it. Response includes <span class="mono">invoice.id</span> and a resume <span class="mono">payLink</span> (<span class="mono">/pay?id=…</span>). Duplicate invoice ids are rejected with <span class="mono">409</span>. Use <span class="mono">Idempotency-Key</span> for safe retries.</p>

        <h3 style="margin-top:1.5rem">3. Check invoice status</h3>
        <pre>GET /api/invoices/{invoiceId}

Statuses: created · awaiting_payment · paid · paid_partial · swept</pre>
        <p class="field-hint">Use the <span class="mono">invoice.id</span> returned from create — not a field on the shareable pay link.</p>

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

  const syncKindFields = () => {
    const chains = checked(root, "chains");
    const needsEvm = chains.some((id) => networkKind(id) === "evm");
    const needsTron = chains.some((id) => networkKind(id) === "tron");
    const needsSolana = chains.some((id) => networkKind(id) === "solana");
    const evmField = root.querySelector<HTMLElement>("#evm-wallet-field");
    const tronField = root.querySelector<HTMLElement>("#tron-wallet-field");
    const solanaField = root.querySelector<HTMLElement>("#solana-wallet-field");
    const toEvm = root.querySelector<HTMLInputElement>("#toEvm");
    const toTron = root.querySelector<HTMLInputElement>("#toTron");
    const toSolana = root.querySelector<HTMLInputElement>("#toSolana");

    setWalletField(evmField, toEvm, needsEvm);
    setWalletField(tronField, toTron, needsTron);
    setWalletField(solanaField, toSolana, needsSolana);
    if (docsQuery) {
      try {
        docsQuery.textContent = `${location.origin}/pay?${encodePayLink(readFormLoose(root))}`;
      } catch {
        docsQuery.textContent = `${location.origin}/pay?…`;
      }
    }
  };

  const refresh = () => {
    syncKindFields();
    renderTokenOptions(root, checked(root, "chains"));
    if (!previewBody) return;
    try {
      const fields = readForm(root);
      const link = `${location.origin}${payPath(fields)}`;
      previewBody.innerHTML = `
        <div class="field">
          <label>Pay link</label>
          <div class="field-row">
            <input class="mono" readonly value="${escapeHtml(link)}" />
            <button type="button" class="secondary" data-copy="${escapeHtml(link)}">Copy</button>
          </div>
        </div>
        <div class="field">
          <label>Embed button</label>
          <pre>&lt;a href="${escapeHtml(link)}"&gt;Pay with crypto&lt;/a&gt;</pre>
          <button type="button" class="secondary" data-copy="${escapeHtml(`<a href="${link}">Pay with crypto</a>`)}">Copy HTML</button>
        </div>
        <p class="field-hint" id="copy-status"></p>
      `;
      previewBody.querySelectorAll<HTMLButtonElement>("[data-copy]").forEach((btn) => {
        btn.addEventListener("click", async () => {
          await copyText(btn.dataset.copy ?? "");
          const note = previewBody.querySelector<HTMLElement>("#copy-status");
          if (note) note.textContent = "Copied.";
        });
      });
      if (docsQuery) {
        docsQuery.textContent = `${location.origin}/pay?${encodePayLink(fields)}`;
      }
    } catch (error) {
      previewBody.innerHTML = `<p class="danger">${escapeHtml(error instanceof Error ? error.message : "Incomplete")}</p>`;
      if (docsQuery) {
        try {
          docsQuery.textContent = `${location.origin}/pay?${encodePayLink(readFormLoose(root))}`;
        } catch {
          docsQuery.textContent = `${location.origin}/pay?…`;
        }
      }
    }
  };

  const ensureMinOneChain = (event: Event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement) || target.name !== "chains") return;
    if (target.checked) return;
    if (checked(root, "chains").length === 0) {
      target.checked = true;
    }
  };

  form?.addEventListener("change", ensureMinOneChain);
  form?.addEventListener("input", refresh);
  form?.addEventListener("change", refresh);

  for (const [id, kind] of [
    ["toEvm", "evm"],
    ["toTron", "tron"],
    ["toSolana", "solana"],
  ] as const) {
    const input = root.querySelector<HTMLInputElement>(`#${id}`);
    input?.addEventListener("blur", () => markAddressField(root, id, kind));
    input?.addEventListener("input", () => {
      if (input.value.trim()) markAddressField(root, id, kind);
      else clearAddressFieldError(root, id);
    });
  }

  refresh();

  if (location.hash === "#docs") {
    root.querySelector("#docs")?.scrollIntoView({ behavior: "smooth" });
  }
}

function chainPillHtml(network: NetworkOption, checked: boolean): string {
  return `
    <label class="chain-pill">
      <input type="checkbox" name="chains" value="${escapeHtml(network.id)}" ${checked ? "checked" : ""} />
      <span class="chain-pill-face">
        ${chainLogoSvg(network.id, 20)}
        <span class="chain-pill-label">${escapeHtml(network.short)}</span>
      </span>
    </label>`;
}

function setWalletField(
  field: HTMLElement | null,
  input: HTMLInputElement | null,
  enabled: boolean
): void {
  if (field) field.hidden = !enabled;
  if (input) {
    input.required = enabled;
    input.disabled = !enabled;
    if (!enabled) {
      input.value = "";
      input.removeAttribute("aria-invalid");
      const err = field?.querySelector<HTMLElement>(".field-error");
      if (err) {
        err.hidden = true;
        err.textContent = "";
      }
    }
  }
}

function clearAddressFieldError(root: HTMLElement, inputId: string): void {
  const input = root.querySelector<HTMLInputElement>(`#${inputId}`);
  const err = root.querySelector<HTMLElement>(`#${inputId}-error`);
  input?.removeAttribute("aria-invalid");
  if (err) {
    err.hidden = true;
    err.textContent = "";
  }
}

function markAddressField(root: HTMLElement, inputId: string, kind: ChainKind): void {
  const input = root.querySelector<HTMLInputElement>(`#${inputId}`);
  const err = root.querySelector<HTMLElement>(`#${inputId}-error`);
  if (!input || input.disabled) return;
  const value = input.value.trim();
  if (!value) {
    clearAddressFieldError(root, inputId);
    return;
  }
  try {
    normalizeAddress(value, kind);
    clearAddressFieldError(root, inputId);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid address";
    input.setAttribute("aria-invalid", "true");
    if (err) {
      err.hidden = false;
      err.textContent = message;
    }
  }
}

function renderTokenOptions(root: HTMLElement, chains: string[]): void {
  const host = root.querySelector<HTMLElement>("#tokens");
  if (!host) return;
  const previous = new Set(
    [...root.querySelectorAll<HTMLInputElement>('input[name="tokens"]:checked')].map((el) => el.value)
  );
  const tokens = tokensForChains(chains);
  const needsTron = chains.some((id) => networkKind(id) === "tron");
  if (tokens.length === 0) {
    host.innerHTML = `<p class="field-hint">Select a network to see matching tokens.</p>`;
    return;
  }
  host.innerHTML = tokens
    .map((t) => {
      const locked = needsTron && t.id === "USDT";
      const selected = locked || (previous.size > 0 ? previous.has(t.id) : true);
      return `
        <label class="check">
          <input type="checkbox" name="tokens" value="${escapeHtml(t.id)}"
            ${selected ? "checked" : ""} ${locked ? "disabled" : ""} />
          ${escapeHtml(t.label)}${locked ? " · required for Tron" : ""}
        </label>`;
    })
    .join("");

  if (needsTron) {
    host.insertAdjacentHTML(
      "beforeend",
      `<input type="hidden" name="tokens" value="USDT" data-tron-usdt-lock="1" />`
    );
  }
}

function checked(root: HTMLElement, name: string): string[] {
  const values = [...root.querySelectorAll<HTMLInputElement>(`input[name="${name}"]:checked`)].map(
    (el) => el.value
  );
  for (const el of root.querySelectorAll<HTMLInputElement>(`input[name="${name}"][disabled], input[name="${name}"][data-tron-usdt-lock]`)) {
    if (el.value && !values.includes(el.value)) values.push(el.value);
  }
  return values;
}

function readForm(root: HTMLElement): PayLinkFields {
  const value = (id: string) =>
    root.querySelector<HTMLInputElement | HTMLTextAreaElement>(`#${id}`)?.value.trim() ?? "";

  const price = value("price");
  const clientInvoiceId = value("clientInvoiceId") || undefined;
  const chains = checked(root, "chains");
  const tokens = checked(root, "tokens");
  const needsEvm = chains.some((id) => networkKind(id) === "evm");
  const needsTron = chains.some((id) => networkKind(id) === "tron");
  const needsSolana = chains.some((id) => networkKind(id) === "solana");
  const toEvm = value("toEvm");
  const toTron = value("toTron");
  const toSolana = value("toSolana");

  if (!price) throw new Error("Amount (USD) is required.");
  if (chains.length === 0) throw new Error("Select at least one network.");
  if (tokens.length === 0) throw new Error("Select at least one token.");
  if (needsTron && !tokens.includes("USDT")) {
    throw new Error("USDT is required when Tron is selected.");
  }

  for (const chainId of chains) {
    const allowed = tokens.some((token) => tokenAllowedOnChain(chainId, token));
    if (!allowed) {
      throw new Error(`No compatible token selected for ${chainId}.`);
    }
  }

  const to: string[] = [];
  if (needsEvm) {
    if (!toEvm) throw new Error("EVM merchant wallet is required.");
    to.push(normalizeAddress(toEvm, "evm"));
  }
  if (needsTron) {
    if (!toTron) throw new Error("Tron merchant wallet is required.");
    to.push(normalizeAddress(toTron, "tron"));
  }
  if (needsSolana) {
    if (!toSolana) throw new Error("Solana merchant wallet is required.");
    to.push(normalizeAddress(toSolana, "solana"));
  }

  return {
    price,
    to,
    chains,
    tokens,
    clientInvoiceId,
    callback: value("callback") || undefined,
    title: value("title") || undefined,
    description: value("description") || undefined,
    allowPartial: root.querySelector<HTMLInputElement>("#allowPartial")?.checked ?? false,
  };
}

function readFormLoose(root: HTMLElement): PayLinkFields {
  const value = (id: string) =>
    root.querySelector<HTMLInputElement | HTMLTextAreaElement>(`#${id}`)?.value.trim() ?? "";

  const chains = checked(root, "chains");
  const tokens = checked(root, "tokens");
  const needsEvm = chains.some((id) => networkKind(id) === "evm");
  const needsTron = chains.some((id) => networkKind(id) === "tron");
  const needsSolana = chains.some((id) => networkKind(id) === "solana");

  const to: string[] = [];
  if (needsEvm) to.push(value("toEvm") || "0x…");
  if (needsTron) to.push(value("toTron") || "T…");
  if (needsSolana) to.push(value("toSolana") || "So…");

  return {
    price: value("price") || "0",
    to: to.length > 0 ? to : ["0x…"],
    chains: chains.length > 0 ? chains : ["11155111"],
    tokens: tokens.length > 0 ? tokens : ["USDC"],
    clientInvoiceId: value("clientInvoiceId") || undefined,
    callback: value("callback") || undefined,
    title: value("title") || undefined,
    description: value("description") || undefined,
    allowPartial: root.querySelector<HTMLInputElement>("#allowPartial")?.checked ?? false,
  };
}
