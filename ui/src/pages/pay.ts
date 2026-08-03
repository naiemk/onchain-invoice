import QRCode from "qrcode";
import { decodePayLink, encodePayLink, invoiceIdFromPayLink } from "../shared/invoice.js";
import { escapeHtml } from "../shared/dom.js";
import {
  chainChipHtml,
  chainLogoSvg,
  explorerAddressUrl,
  formatTokenAmount,
  looksLikeSolanaAddress,
  looksLikeTronAddress,
  networkKind,
  networkLabel,
  testnetPillHtml,
  tokenAllowedOnChain,
  tokenChipHtml,
} from "../shared/networks.js";
import type {
  CreateInvoiceResponse,
  InvoiceRecord,
  InvoiceStatus,
  InvoiceWithEvents,
  PayLinkFields,
} from "../shared/types.js";
import { apiUrl } from "../shared/site.js";

const ACTIVATION_KEY = (invoiceId: string) => `tc.activation.${invoiceId}`;
const POLL_MS = 2000;

type PayRoot = HTMLElement & { __tcPollToken?: number };

export function renderPay(root: HTMLElement): void {
  stopPolling(root);

  let fields: PayLinkFields;
  try {
    fields = decodePayLink(location.search);
  } catch (error) {
    root.innerHTML = `
      <div class="invoice-shell">
        <section class="invoice-doc">
          <p class="eyebrow">Checkout</p>
          <h1>Pay link missing</h1>
          <p class="danger">${escapeHtml(error instanceof Error ? error.message : "Invalid pay link")}</p>
          <p>Open a link from <a href="/create" data-route>Create invoice</a>, or pass price, to, and client_invoice_id query params.</p>
        </section>
      </div>
    `;
    return;
  }

  const invoiceId = invoiceIdFromPayLink(fields);
  const activation = readJson<CreateInvoiceResponse>(ACTIVATION_KEY(invoiceId));
  const invoice = activation?.invoice;
  const hasAddress = Boolean(invoice?.invoiceAddress);

  if (hasAddress && invoice && isPaidLike(invoice.status)) {
    renderPaidStage(root, fields, invoiceId, invoice);
    return;
  }

  if (hasAddress && invoice) {
    void renderInvoiceStage(root, fields, invoiceId, invoice);
  } else {
    renderCheckoutStage(root, fields, invoiceId);
  }
}

function renderCheckoutStage(root: HTMLElement, fields: PayLinkFields, invoiceId: string): void {
  const initialChain = fields.chains[0];
  const recipientsForChain = (chainId: string) =>
    fields.to.filter((addr) => {
      const kind = networkKind(chainId);
      if (kind === "tron") return looksLikeTronAddress(addr);
      if (kind === "solana") return looksLikeSolanaAddress(addr);
      return !looksLikeTronAddress(addr) && !looksLikeSolanaAddress(addr);
    });
  const initialRecipients = recipientsForChain(initialChain);
  const toField =
    fields.to.length > 1
      ? `<div class="field">
          <label for="to">Recipient</label>
          <p class="field-hint">Choose which merchant wallet this payment settles to.</p>
          <select id="to">${initialRecipients
            .map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(maskMerchant(value))}</option>`)
            .join("")}</select>
        </div>`
      : `<input type="hidden" id="to" value="${escapeHtml(initialRecipients[0] ?? fields.to[0] ?? "")}" />`;

  const tokensFor = (chainId: string) => fields.tokens.filter((t) => tokenAllowedOnChain(chainId, t));
  const initialTokens = tokensFor(initialChain);
  const merchantHint = maskMerchant(initialRecipients[0] ?? fields.to[0] ?? "");

  root.innerHTML = `
    <section class="checkout">
      <aside class="checkout-summary">
        <p class="eyebrow">Order summary</p>
        <h1>${escapeHtml(fields.title ?? "Invoice")}</h1>
        <p class="amount">$${escapeHtml(fields.price)}</p>
        <p class="muted">${escapeHtml(fields.description ?? "Complete payment with crypto.")}</p>
        <p class="muted" style="margin-top:1.25rem;font-size:0.78rem">Invoice · ${escapeHtml(short(invoiceId))}</p>
      </aside>
      <div class="checkout-panel">
        <p class="eyebrow">Payment method</p>
        <div id="testnet-banner">${testnetPillHtml(initialChain)}</div>
        <h2>Choose network & token</h2>
        <p>Select where you’ll send funds. You’ll get a dedicated invoice address on the next step.</p>
        ${toField}
        <div class="field">
          <label for="chain">Network</label>
          <p class="field-hint">Send only on the network you select here.</p>
          <select id="chain">${fields.chains
            .map(
              (value) =>
                `<option value="${escapeHtml(value)}">${escapeHtml(networkLabel(value))}</option>`
            )
            .join("")}</select>
          <div class="chain-select-preview" id="chain-preview">${chainChipHtml(initialChain, { size: "md" })}</div>
        </div>
        <div class="field">
          <label for="token">Token</label>
          <p class="field-hint">Use the same asset your wallet will transfer.</p>
          <select id="token">${initialTokens.map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join("")}</select>
          <div class="chain-select-preview" id="token-preview">${tokenChipHtml(initialTokens[0] ?? fields.tokens[0], { size: "md" })}</div>
        </div>
        <button id="activate">Continue to payment</button>
        <button id="copy-link" type="button" class="secondary" style="margin-left:.5rem">Copy pay link</button>
        <div id="pay-status" class="status">Ready when your network and token are set.</div>
        <p class="merchant-hint">${escapeHtml(merchantHint)}</p>
      </div>
    </section>
  `;

  const status = root.querySelector<HTMLElement>("#pay-status");

  const chainSelect = root.querySelector<HTMLSelectElement>("#chain");
  const chainPreview = root.querySelector<HTMLElement>("#chain-preview");
  const testnetBanner = root.querySelector<HTMLElement>("#testnet-banner");
  const tokenSelect = root.querySelector<HTMLSelectElement>("#token");
  const tokenPreview = root.querySelector<HTMLElement>("#token-preview");
  const toSelect = root.querySelector<HTMLSelectElement>("#to");

  const syncChainExtras = () => {
    const chainId = chainSelect?.value ?? initialChain;
    if (chainPreview) chainPreview.innerHTML = chainChipHtml(chainId, { size: "md" });
    if (testnetBanner) testnetBanner.innerHTML = testnetPillHtml(chainId);
    const nextTokens = tokensFor(chainId);
    if (tokenSelect) {
      tokenSelect.innerHTML = nextTokens
        .map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`)
        .join("");
      if (tokenPreview) tokenPreview.innerHTML = tokenChipHtml(nextTokens[0] ?? "", { size: "md" });
    }
    if (toSelect && toSelect.tagName === "SELECT") {
      const recipients = recipientsForChain(chainId);
      toSelect.innerHTML = recipients
        .map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(maskMerchant(value))}</option>`)
        .join("");
    }
  };

  chainSelect?.addEventListener("change", syncChainExtras);

  tokenSelect?.addEventListener("change", () => {
    if (tokenPreview && tokenSelect.value) {
      tokenPreview.innerHTML = tokenChipHtml(tokenSelect.value, { size: "md" });
    }
  });

  root.querySelector<HTMLButtonElement>("#copy-link")?.addEventListener("click", async () => {
    await navigator.clipboard.writeText(`${location.origin}/pay?${encodePayLink(fields)}`);
    if (status) status.textContent = "Pay link copied.";
  });

  root.querySelector<HTMLButtonElement>("#activate")?.addEventListener("click", async () => {
    const chainId = root.querySelector<HTMLSelectElement>("#chain")?.value ?? fields.chains[0];
    const token = root.querySelector<HTMLSelectElement>("#token")?.value ?? fields.tokens[0];
    const toEl = root.querySelector<HTMLSelectElement | HTMLInputElement>("#to");
    const selectedTo = toEl?.value ?? recipientsForChain(chainId)[0] ?? fields.to[0];
    if (status) status.textContent = "Creating invoice address…";
    try {
      const response = await fetch(apiUrl("/api/invoices"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...fieldsToBody(fields),
          chainId,
          token,
          selectedTo,
        }),
      });
      const body = (await response.json()) as CreateInvoiceResponse & { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Create failed");
      sessionStorage.setItem(ACTIVATION_KEY(invoiceId), JSON.stringify(body));
      renderPay(root);
    } catch (error) {
      if (status) status.textContent = error instanceof Error ? error.message : "Create failed";
    }
  });
}

async function renderInvoiceStage(
  root: HTMLElement,
  fields: PayLinkFields,
  invoiceId: string,
  invoice: InvoiceRecord
): Promise<void> {
  const address = invoice.invoiceAddress ?? "";
  const chainId = invoice.chainId ?? fields.chains[0];
  const token = invoice.token ?? fields.tokens[0];
  const statusClass = invoice.status ?? "awaiting_payment";
  let qrDataUrl = "";
  if (address) {
    try {
      qrDataUrl = await QRCode.toDataURL(address, { margin: 1, width: 180, color: { dark: "#0a2540", light: "#ffffff" } });
    } catch {
      qrDataUrl = "";
    }
  }

  root.innerHTML = `
    <div class="invoice-shell">
      <section class="invoice-doc">
        <p class="eyebrow">Invoice</p>
        ${testnetPillHtml(chainId)}
        <h1>${escapeHtml(fields.title ?? "Payment due")}</h1>
        <p class="amount-due">$${escapeHtml(fields.price)}</p>
        <span class="status-badge ${escapeHtml(statusClass)}" id="status-badge">${escapeHtml(formatStatus(statusClass))}</span>
        <div class="pay-asset-banner">
          <div class="pay-asset-item">
            <span class="pay-asset-label">Network</span>
            ${chainChipHtml(chainId, { size: "lg" })}
          </div>
          <div class="pay-asset-item">
            <span class="pay-asset-label">Token</span>
            ${tokenChipHtml(token, { size: "lg" })}
          </div>
        </div>
        ${
          fields.description
            ? `<p style="margin:0 0 1rem">${escapeHtml(fields.description)}</p>`
            : ""
        }
        ${
          qrDataUrl
            ? `<div class="qr-wrap"><img src="${qrDataUrl}" alt="Payment address QR code" /></div>`
            : ""
        }
        <p class="field-hint" style="text-align:left">Send exactly on this network</p>
        <div class="address-box" id="invoice-address">${escapeHtml(address || "Address pending")}</div>
        <div class="btn-row" style="justify-content:center">
          <button type="button" id="copy-address" ${address ? "" : "disabled"}>Copy address</button>
          <button type="button" class="secondary" id="change-method">Change network / token</button>
        </div>
        <div class="callout warn">
          <strong class="callout-chain">${chainLogoSvg(chainId, 22)}${escapeHtml(networkLabel(chainId))} only</strong>
          Sending from another chain can result in lost funds. Confirm your wallet network matches before you send.
          ${
            networkKind(chainId) === "tron"
              ? " Use Nile Tronscan to verify the address when paying on Nile."
              : networkKind(chainId) === "solana"
                ? " Send SPL USDC to this token account (ATA). Use Solana Explorer (devnet) to verify."
                : ""
          }
        </div>
        <div class="callout info">
          Pay with <strong class="pay-token-emphasis">${escapeHtml(token ?? "token")}</strong> to the address above.
          Keep this page open — status updates automatically when payment is detected.
          Partial payments are ${fields.allowPartial ? "allowed" : "not allowed"} on this invoice.
        </div>
        <div id="pay-status" class="status">
          <p><strong>Status:</strong> ${escapeHtml(formatStatus(statusClass))} · monitoring…</p>
          <p class="field-hint" style="margin:0.35rem 0 0">Invoice · <span class="mono">${escapeHtml(short(invoiceId))}</span></p>
        </div>
        <p class="merchant-hint">${escapeHtml(maskMerchant(invoice.selectedTo ?? fields.to[0] ?? ""))}</p>
      </section>
    </div>
  `;

  const statusEl = root.querySelector<HTMLElement>("#pay-status");
  let copyFlash: ReturnType<typeof setTimeout> | undefined;

  root.querySelector<HTMLButtonElement>("#copy-address")?.addEventListener("click", async () => {
    if (!address || !statusEl) return;
    await navigator.clipboard.writeText(address);
    const previous = statusEl.innerHTML;
    statusEl.innerHTML = `<p>Address copied.</p>`;
    clearTimeout(copyFlash);
    copyFlash = setTimeout(() => {
      if (statusEl.isConnected) statusEl.innerHTML = previous;
    }, 1500);
  });

  root.querySelector<HTMLButtonElement>("#change-method")?.addEventListener("click", () => {
    stopPolling(root);
    sessionStorage.removeItem(ACTIVATION_KEY(invoiceId));
    renderPay(root);
  });

  startPolling(root, invoiceId, fields);
}

function renderPaidStage(
  root: HTMLElement,
  fields: PayLinkFields,
  invoiceId: string,
  invoice: InvoiceRecord
): void {
  stopPolling(root);
  const status = invoice.status;
  const title =
    status === "swept" ? "Payment complete" : status === "paid_partial" ? "Partial payment received" : "Payment received";
  const chainId = invoice.chainId ?? fields.chains[0];
  const addressUrl = invoice.invoiceAddress ? explorerAddressUrl(chainId, invoice.invoiceAddress) : null;
  const paidDisplay = formatTokenAmount(invoice.amountPaid, invoice.token);

  root.innerHTML = `
    <div class="invoice-shell">
      <section class="invoice-doc">
        <p class="eyebrow">Invoice</p>
        ${testnetPillHtml(chainId)}
        <h1>${escapeHtml(fields.title ?? "Invoice")}</h1>
        <p class="amount-due">$${escapeHtml(fields.price)}</p>
        <span class="status-badge ${escapeHtml(status)}">${escapeHtml(formatStatus(status))}</span>
        <div class="pay-asset-banner">
          <div class="pay-asset-item">
            <span class="pay-asset-label">Network</span>
            ${chainChipHtml(chainId, { size: "lg" })}
          </div>
          <div class="pay-asset-item">
            <span class="pay-asset-label">Token</span>
            ${tokenChipHtml(invoice.token, { size: "lg" })}
          </div>
        </div>
        <div class="callout ok">
          <strong>${escapeHtml(title)}.</strong>
          ${status === "swept" ? " Payment confirmed." : " We’re confirming settlement on-chain."}
        </div>
        <div class="address-box" style="text-align:left">
          <div><strong>Invoice id</strong><br /><span class="mono">${escapeHtml(invoiceId)}</span></div>
          ${
            invoice.invoiceAddress
              ? `<div style="margin-top:0.75rem"><strong>Payment address</strong><br />${
                  addressUrl
                    ? `<a class="mono" href="${escapeHtml(addressUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(invoice.invoiceAddress)}</a>`
                    : `<span class="mono">${escapeHtml(invoice.invoiceAddress)}</span>`
                }</div>`
              : ""
          }
          ${
            invoice.amountPaid && invoice.amountPaid !== "0"
              ? `<div style="margin-top:0.75rem"><strong>Amount paid</strong><br /><span class="mono">${escapeHtml(paidDisplay)}</span></div>`
              : ""
          }
        </div>
        <div id="pay-status" class="status"></div>
        <p class="merchant-hint">${escapeHtml(maskMerchant(invoice.selectedTo ?? fields.to[0] ?? ""))}</p>
      </section>
    </div>
  `;

  if (fields.callback && isPaidLike(status)) {
    const statusEl = root.querySelector<HTMLElement>("#pay-status");
    const url = new URL(fields.callback);
    url.searchParams.set("invoice_id", invoiceId);
    url.searchParams.set("client_invoice_id", fields.clientInvoiceId);
    url.searchParams.set("status", status);
    if (invoice.invoiceAddress) url.searchParams.set("invoice_address", invoice.invoiceAddress);
    if (statusEl) {
      statusEl.innerHTML = `<p class="ok">Redirecting to <span class="mono">${escapeHtml(url.toString())}</span>…</p>`;
    }
    setTimeout(() => {
      location.href = url.toString();
    }, 1500);
  }
}

function startPolling(root: HTMLElement, invoiceId: string, fields: PayLinkFields): void {
  const payRoot = root as PayRoot;
  const token = (payRoot.__tcPollToken ?? 0) + 1;
  payRoot.__tcPollToken = token;

  const poll = async () => {
    if (payRoot.__tcPollToken !== token) return;
    try {
      const response = await fetch(apiUrl(`/api/invoices/${encodeURIComponent(invoiceId)}`));
      if (payRoot.__tcPollToken !== token) return;
      if (response.ok) {
        const invoice = (await response.json()) as InvoiceWithEvents;
        sessionStorage.setItem(ACTIVATION_KEY(invoiceId), JSON.stringify({ invoice }));

        if (isPaidLike(invoice.status)) {
          renderPaidStage(root, fields, invoiceId, invoice);
          return;
        }

        const badge = root.querySelector("#status-badge");
        if (badge) {
          badge.className = `status-badge ${invoice.status}`;
          badge.textContent = formatStatus(invoice.status);
        }
        const statusEl = root.querySelector<HTMLElement>("#pay-status");
        if (statusEl) {
          statusEl.innerHTML = `
            <p><strong>Status:</strong> ${escapeHtml(formatStatus(invoice.status))} · monitoring…</p>
            <p class="field-hint" style="margin:0.35rem 0 0">Checking every ${POLL_MS / 1000}s for on-chain payment.</p>
          `;
        }
      }
    } catch {
      /* keep polling */
    }
    if (payRoot.__tcPollToken === token) {
      setTimeout(() => void poll(), POLL_MS);
    }
  };
  void poll();
}

function stopPolling(root: HTMLElement): void {
  const payRoot = root as PayRoot;
  payRoot.__tcPollToken = (payRoot.__tcPollToken ?? 0) + 1;
}

function isPaidLike(status: InvoiceStatus): boolean {
  return status === "paid" || status === "paid_partial" || status === "swept";
}

function formatStatus(status: string): string {
  return status.replace(/_/g, " ");
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

function short(value: string): string {
  return value.length > 18 ? `${value.slice(0, 10)}…${value.slice(-6)}` : value;
}

/** Discreet merchant wallet hint for testing (first 4 + last 4 chars). */
function maskMerchant(address: string): string {
  if (!address || address.length < 10) return address;
  return `${address.slice(0, 4)}…${address.slice(-4)}`;
}
