import QRCode from "qrcode";
import { decodePayLink, encodeInvoiceResumeLink, encodePayLink } from "../shared/invoice.js";
import { escapeHtml } from "../shared/dom.js";
import { localizeError, statusLabel } from "../i18n/errors.js";
import { t } from "../i18n/t.js";
import {
  chainChipHtml,
  chainLogoSvg,
  explorerAddressUrl,
  formatTokenAmount,
  isTestnet,
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
const CHECKOUT_KEY = (fingerprint: string) => `tc.checkout.${fingerprint}`;
const POLL_MS = 2000;

type PayRoot = HTMLElement & { __tcPollToken?: number; __tcMoreAbort?: AbortController };

export function renderPay(root: HTMLElement): void {
  stopPolling(root);

  const params = new URLSearchParams(location.search);
  const resumeId = params.get("id")?.trim();
  if (resumeId) {
    void resumeByInvoiceId(root, resumeId);
    return;
  }

  let fields: PayLinkFields;
  try {
    fields = decodePayLink(location.search);
  } catch (error) {
    root.innerHTML = `
      <div class="invoice-shell">
        <section class="invoice-doc">
          <p class="eyebrow">${t("pay.eyebrow")}</p>
          <h1>${t("pay.missingTitle")}</h1>
          <p class="danger">${escapeHtml(error instanceof Error ? localizeError(error) : t("errors.invalidPayLink"))}</p>
          <p>${t("pay.missingHint")}</p>
          <p><a href="/create" data-route>${t("pay.createInvoiceLink")}</a></p>
        </section>
      </div>
    `;
    return;
  }

  const fingerprint = checkoutFingerprint(fields);
  const cachedId = sessionStorage.getItem(CHECKOUT_KEY(fingerprint));
  if (cachedId) {
    const activation = readJson<CreateInvoiceResponse>(ACTIVATION_KEY(cachedId));
    const invoice = activation?.invoice;
    if (invoice?.invoiceAddress) {
      replaceResumeUrl(cachedId);
      if (isPaidLike(invoice.status)) {
        renderPaidStage(root, fieldsFromInvoice(invoice, fields), cachedId, invoice);
      } else {
        void renderInvoiceStage(root, fieldsFromInvoice(invoice, fields), cachedId, invoice);
      }
      return;
    }
  }

  renderCheckoutStage(root, fields);
}

async function resumeByInvoiceId(root: HTMLElement, invoiceId: string): Promise<void> {
  const cached = readJson<CreateInvoiceResponse>(ACTIVATION_KEY(invoiceId));
  if (cached?.invoice?.invoiceAddress) {
    const fields = fieldsFromInvoice(cached.invoice);
    if (isPaidLike(cached.invoice.status)) {
      renderPaidStage(root, fields, invoiceId, cached.invoice);
    } else {
      void renderInvoiceStage(root, fields, invoiceId, cached.invoice);
    }
    return;
  }

  root.innerHTML = `
    <div class="invoice-shell">
      <section class="invoice-doc">
          <p class="eyebrow">${t("pay.eyebrow")}</p>
          <h1>${t("pay.loadingTitle")}</h1>
          <div id="pay-status" class="status">${t("pay.fetching", { id: short(invoiceId) })}</div>
      </section>
    </div>
  `;

  try {
    const response = await fetch(apiUrl(`/api/invoices/${encodeURIComponent(invoiceId)}`));
    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error ?? t("errors.invoiceNotFoundStatus", { status: String(response.status) }));
    }
    const invoice = (await response.json()) as InvoiceWithEvents;
    sessionStorage.setItem(ACTIVATION_KEY(invoiceId), JSON.stringify({ invoice, created: false }));
    const fields = fieldsFromInvoice(invoice);
    if (isPaidLike(invoice.status)) {
      renderPaidStage(root, fields, invoiceId, invoice);
    } else {
      void renderInvoiceStage(root, fields, invoiceId, invoice);
    }
  } catch (error) {
    root.innerHTML = `
      <div class="invoice-shell">
        <section class="invoice-doc">
          <p class="eyebrow">${t("pay.eyebrow")}</p>
          <h1>${t("pay.unavailableTitle")}</h1>
          <p class="danger">${escapeHtml(error instanceof Error ? localizeError(error) : t("pay.loadFailed"))}</p>
          <p><a href="/create" data-route>${t("pay.createNewLink")}</a></p>
        </section>
      </div>
    `;
  }
}

function renderCheckoutStage(root: HTMLElement, fields: PayLinkFields): void {
  const initialChain = fields.chains[0];
  const recipientsForChain = (chainId: string) =>
    fields.to.filter((addr) => {
      const kind = networkKind(chainId);
      if (kind === "tron") return looksLikeTronAddress(addr);
      if (kind === "solana") return looksLikeSolanaAddress(addr);
      return !looksLikeTronAddress(addr) && !looksLikeSolanaAddress(addr);
    });
  const tokensFor = (chainId: string) => fields.tokens.filter((t) => tokenAllowedOnChain(chainId, t));
  const initialTokens = tokensFor(initialChain);
  const initialRecipients = recipientsForChain(initialChain);

  // Fiat-only invoices settle on a single rail — skip network/token picker when unique.
  if (fields.paymentMode === "fiat" && fields.chains.length === 1 && initialTokens.length === 1) {
    const selectedTo = initialRecipients[0] ?? fields.to[0];
    root.innerHTML = `
      <div class="invoice-shell">
        <section class="invoice-doc">
          <p class="eyebrow">${t("pay.eyebrow")}</p>
          <h1>${escapeHtml(fields.title ?? t("pay.defaultTitle"))}</h1>
          <div id="pay-status" class="status">${t("pay.creatingAddress")}</div>
        </section>
      </div>
    `;
    void activateInvoice(root, fields, initialChain, initialTokens[0]!, selectedTo);
    return;
  }

  const toField =
    fields.to.length > 1
      ? `<div class="field">
          <label for="to">${t("pay.recipient")}</label>
          <p class="field-hint">${t("pay.recipientHint")}</p>
          <select id="to">${initialRecipients
            .map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(maskMerchant(value))}</option>`)
            .join("")}</select>
        </div>`
      : `<input type="hidden" id="to" value="${escapeHtml(initialRecipients[0] ?? fields.to[0] ?? "")}" />`;

  const merchantHint = maskMerchant(initialRecipients[0] ?? fields.to[0] ?? "");

  root.innerHTML = `
    <section class="checkout">
      <aside class="checkout-summary">
        <p class="eyebrow">${t("pay.orderSummary")}</p>
        <h1>${escapeHtml(fields.title ?? t("pay.defaultTitle"))}</h1>
        <p class="amount">$${escapeHtml(fields.price)}</p>
        <p class="muted">${escapeHtml(fields.description ?? t("pay.defaultDescription"))}</p>
        <p class="muted" style="margin-top:1.25rem;font-size:0.78rem">${t("pay.invoiceIdAssignedLater")}</p>
      </aside>
      <div class="checkout-panel">
        <p class="eyebrow">${t("pay.paymentMethod")}</p>
        <div id="testnet-banner">${testnetPillHtml(initialChain)}</div>
        <h2>${t("pay.chooseNetworkToken")}</h2>
        <p>${t("pay.chooseHint")}</p>
        ${toField}
        <div class="field">
          <label for="chain">${t("pay.network")}</label>
          <p class="field-hint">${t("pay.networkHint")}</p>
          <select id="chain">${fields.chains
            .map(
              (value) =>
                `<option value="${escapeHtml(value)}">${escapeHtml(networkLabel(value))}</option>`
            )
            .join("")}</select>
          <div class="chain-select-preview" id="chain-preview">${chainChipHtml(initialChain, { size: "md" })}</div>
        </div>
        <div class="field">
          <label for="token">${t("pay.token")}</label>
          <p class="field-hint">${t("pay.tokenHint")}</p>
          <select id="token">${initialTokens.map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join("")}</select>
          <div class="chain-select-preview" id="token-preview">${tokenChipHtml(initialTokens[0] ?? fields.tokens[0], { size: "md" })}</div>
        </div>
        <button id="activate">${t("pay.continue")}</button>
        <button id="copy-link" type="button" class="secondary" style="margin-left:.5rem">${t("pay.copyPayLink")}</button>
        <div id="pay-status" class="status">${t("pay.ready")}</div>
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
    if (status) status.textContent = t("pay.payLinkCopied");
  });

  root.querySelector<HTMLButtonElement>("#activate")?.addEventListener("click", async () => {
    const chainId = root.querySelector<HTMLSelectElement>("#chain")?.value ?? fields.chains[0];
    const token = root.querySelector<HTMLSelectElement>("#token")?.value ?? fields.tokens[0];
    const toEl = root.querySelector<HTMLSelectElement | HTMLInputElement>("#to");
    const selectedTo = toEl?.value ?? recipientsForChain(chainId)[0] ?? fields.to[0];
    if (status) status.textContent = t("pay.creatingAddress");
    await activateInvoice(root, fields, chainId, token, selectedTo, status);
  });
}

async function activateInvoice(
  root: HTMLElement,
  fields: PayLinkFields,
  chainId: string,
  token: string,
  selectedTo: string,
  statusEl?: HTMLElement | null
): Promise<void> {
  const status = statusEl ?? root.querySelector<HTMLElement>("#pay-status");
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
    if (!response.ok) throw new Error(body.error ?? t("errors.createFailed"));
    const invoiceId = body.invoice.id;
    sessionStorage.setItem(ACTIVATION_KEY(invoiceId), JSON.stringify(body));
    sessionStorage.setItem(CHECKOUT_KEY(checkoutFingerprint(fields)), invoiceId);
    replaceResumeUrl(invoiceId);
    renderPay(root);
  } catch (error) {
    if (status) status.textContent = error instanceof Error ? localizeError(error) : t("errors.createFailed");
  }
}

async function renderInvoiceStage(
  root: HTMLElement,
  fields: PayLinkFields,
  invoiceId: string,
  invoice: InvoiceRecord
): Promise<void> {
  const paymentMode = invoice.paymentMode ?? fields.paymentMode ?? "crypto";
  const address = invoice.invoiceAddress ?? "";
  const chainId = invoice.chainId ?? fields.chains[0];
  const token = invoice.token ?? fields.tokens[0];
  const statusClass = invoice.status ?? "awaiting_payment";

  if (paymentMode === "fiat") {
    renderFiatInvoiceStage(root, fields, invoiceId, invoice);
    startPolling(root, invoiceId, fields);
    return;
  }

  let qrDataUrl = "";
  if (address) {
    try {
      qrDataUrl = await QRCode.toDataURL(address, { margin: 1, width: 180, color: { dark: "#0a2540", light: "#ffffff" } });
    } catch {
      qrDataUrl = "";
    }
  }

  const showMethodSwitch = paymentMode === "crypto_or_fiat";
  const methodSwitcher = showMethodSwitch
    ? `<div class="choice-card-row pay-method-row" role="radiogroup" aria-label="${escapeHtml(t("pay.paymentMethod"))}">
        <label class="choice-card is-selected">
          <input type="radio" name="payMethod" value="wallet" checked />
          <span class="choice-card-face">
            <span class="choice-card-title">${escapeHtml(t("pay.methodWalletTitle"))}</span>
            <span class="choice-card-hint">${escapeHtml(t("pay.methodWalletHint"))}</span>
          </span>
        </label>
        <label class="choice-card">
          <input type="radio" name="payMethod" value="card" />
          <span class="choice-card-face">
            <span class="choice-card-title">${escapeHtml(t("pay.methodCardTitle"))}</span>
            <span class="choice-card-hint">${escapeHtml(t("pay.methodCardHint", { token: token ?? "USDC" }))}</span>
          </span>
        </label>
      </div>`
    : "";

  root.innerHTML = `
    <div class="invoice-shell">
      <section class="invoice-doc">
        <div class="invoice-doc-head">
          <p class="eyebrow">${t("pay.invoiceEyebrow")}</p>
          <details class="pay-more">
            <summary class="pay-more-summary" aria-label="${escapeHtml(t("pay.changeMethod"))}">
              <svg class="pay-more-icon" viewBox="0 0 16 16" aria-hidden="true">
                <circle cx="3.5" cy="8" r="1.45" />
                <circle cx="8" cy="8" r="1.45" />
                <circle cx="12.5" cy="8" r="1.45" />
              </svg>
            </summary>
            <div class="pay-more-menu" role="menu">
              <button type="button" class="pay-more-item" id="change-method" role="menuitem">${t("pay.changeMethod")}</button>
            </div>
          </details>
        </div>
        ${testnetPillHtml(chainId)}
        <h1>${escapeHtml(fields.title ?? t("pay.paymentDue"))}</h1>
        <p class="amount-due">$${escapeHtml(fields.price)}</p>
        <span class="status-badge ${escapeHtml(statusClass)}" id="status-badge">${escapeHtml(statusLabel(statusClass))}</span>
        <div class="pay-asset-banner">
          <div class="pay-asset-item">
            <span class="pay-asset-label">${t("pay.network")}</span>
            ${chainChipHtml(chainId, { size: "lg" })}
          </div>
          <div class="pay-asset-item">
            <span class="pay-asset-label">${t("pay.token")}</span>
            ${tokenChipHtml(token, { size: "lg" })}
          </div>
        </div>
        ${
          fields.description
            ? `<p style="margin:0 0 1rem">${escapeHtml(fields.description)}</p>`
            : ""
        }
        ${methodSwitcher}
        <div id="pay-wallet-panel">
          ${
            qrDataUrl
              ? `<div class="qr-wrap"><img src="${qrDataUrl}" alt="${escapeHtml(t("pay.qrAlt"))}" /></div>`
              : ""
          }
          <p class="field-hint" style="text-align:start">${t("pay.sendExactly")}</p>
          <div class="address-box" id="invoice-address">${escapeHtml(address || t("pay.addressPending"))}</div>
          <div class="btn-row pay-copy-row">
            <button type="button" id="copy-address" ${address ? "" : "disabled"}>${t("pay.copyAddress")}</button>
          </div>
          <div class="callout warn">
            <strong class="callout-chain">${chainLogoSvg(chainId, 22)}${escapeHtml(t("pay.networkOnly", { network: networkLabel(chainId) }))}</strong>
            ${t("pay.lostFundsWarn")}
            ${
              networkKind(chainId) === "tron"
                ? isTestnet(chainId)
                  ? t("pay.tronNileHint")
                  : t("pay.tronMainnetHint")
                : networkKind(chainId) === "solana"
                  ? t("pay.solanaHint")
                  : ""
            }
          </div>
          <div class="callout info">
            ${t("pay.payWithToken", { token: token ?? t("pay.token") })}
            ${t("pay.keepPageOpen")}
            ${fields.allowPartial ? t("pay.partialAllowed") : t("pay.partialNotAllowed")}
          </div>
        </div>
        <div id="pay-card-panel" hidden></div>
        <div id="pay-status" class="status">
          <p>${escapeHtml(t("pay.statusLine", { status: statusLabel(statusClass) }))}</p>
          <p class="field-hint" style="margin:0.35rem 0 0">${t("pay.invoiceShort", { id: short(invoiceId) })}</p>
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
    statusEl.innerHTML = `<p>${t("pay.addressCopied")}</p>`;
    clearTimeout(copyFlash);
    copyFlash = setTimeout(() => {
      if (statusEl.isConnected) statusEl.innerHTML = previous;
    }, 1500);
  });

  root.querySelector<HTMLButtonElement>("#change-method")?.addEventListener("click", () => {
    stopPolling(root);
    sessionStorage.removeItem(ACTIVATION_KEY(invoiceId));
    const fingerprint = checkoutFingerprint(fields);
    sessionStorage.removeItem(CHECKOUT_KEY(fingerprint));
    history.replaceState(null, "", `/pay?${encodePayLink(fields)}`);
    renderPay(root);
  });

  if (showMethodSwitch) {
    const walletPanel = root.querySelector<HTMLElement>("#pay-wallet-panel");
    const cardPanel = root.querySelector<HTMLElement>("#pay-card-panel");
    const syncMethod = () => {
      const method = root.querySelector<HTMLInputElement>('input[name="payMethod"]:checked')?.value ?? "wallet";
      for (const card of root.querySelectorAll<HTMLElement>(".pay-method-row .choice-card")) {
        const input = card.querySelector<HTMLInputElement>('input[name="payMethod"]');
        card.classList.toggle("is-selected", Boolean(input?.checked));
      }
      if (walletPanel) walletPanel.hidden = method !== "wallet";
      if (cardPanel) {
        cardPanel.hidden = method !== "card";
        if (method === "card" && !cardPanel.dataset.ready) {
          void mountOnrampPanel(cardPanel, invoiceId, invoice, fields, true);
          cardPanel.dataset.ready = "1";
        }
      }
    };
    root.querySelector(".pay-method-row")?.addEventListener("change", syncMethod);
  }

  bindPayMoreMenu(root);
  startPolling(root, invoiceId, fields);
}

function renderFiatInvoiceStage(
  root: HTMLElement,
  fields: PayLinkFields,
  invoiceId: string,
  invoice: InvoiceRecord
): void {
  const chainId = invoice.chainId ?? fields.chains[0];
  const token = invoice.token ?? fields.tokens[0];
  const statusClass = invoice.status ?? "awaiting_payment";

  root.innerHTML = `
    <div class="invoice-shell">
      <section class="invoice-doc">
        <p class="eyebrow">${t("pay.invoiceEyebrow")}</p>
        ${testnetPillHtml(chainId)}
        <h1>${escapeHtml(fields.title ?? t("pay.paymentDue"))}</h1>
        <p class="amount-due">$${escapeHtml(fields.price)}</p>
        <span class="status-badge ${escapeHtml(statusClass)}" id="status-badge">${escapeHtml(statusLabel(statusClass))}</span>
        <p class="settlement-line">${escapeHtml(
          t("pay.settlesAs", { token: token ?? "USDC", network: networkLabel(chainId) })
        )}</p>
        ${
          fields.description
            ? `<p style="margin:0 0 1rem">${escapeHtml(fields.description)}</p>`
            : ""
        }
        <div id="pay-card-panel"></div>
        <div id="pay-status" class="status">
          <p>${escapeHtml(t("pay.waitingPayment"))}</p>
          <p class="field-hint" style="margin:0.35rem 0 0">${t("pay.invoiceShort", { id: short(invoiceId) })}</p>
        </div>
        <p class="merchant-hint">${escapeHtml(maskMerchant(invoice.selectedTo ?? fields.to[0] ?? ""))}</p>
      </section>
    </div>
  `;

  const panel = root.querySelector<HTMLElement>("#pay-card-panel");
  if (panel) void mountOnrampPanel(panel, invoiceId, invoice, fields, true);
}

const FIAT_LABELS: Record<string, string> = {
  USD: "US Dollar",
  EUR: "Euro",
  GBP: "British pound",
  SEK: "Swedish krona",
  NOK: "Norwegian krone",
  DKK: "Danish krone",
  CHF: "Swiss franc",
  CAD: "Canadian dollar",
  AUD: "Australian dollar",
  JPY: "Japanese yen",
  PLN: "Polish złoty",
  CZK: "Czech koruna",
};

async function mountOnrampPanel(
  panel: HTMLElement,
  invoiceId: string,
  invoice: InvoiceRecord,
  fields: PayLinkFields,
  lockFiat: boolean
): Promise<void> {
  const token = invoice.token ?? fields.tokens[0] ?? "USDC";
  let fiats = ["USD", "EUR", "GBP", "SEK"];
  let sandbox = false;
  try {
    const res = await fetch(apiUrl("/api/public/onramp"));
    if (res.ok) {
      const body = (await res.json()) as { enabled?: boolean; fiats?: string[]; sandbox?: boolean };
      if (!body.enabled) {
        panel.innerHTML = `<p class="danger">${escapeHtml(t("pay.checkoutFailed"))}</p>`;
        return;
      }
      if (body.fiats?.length) fiats = body.fiats;
      sandbox = Boolean(body.sandbox);
    }
  } catch {
    /* use defaults */
  }

  const defaultFiat = invoice.payerFiat && fiats.includes(invoice.payerFiat) ? invoice.payerFiat : fiats[0] ?? "USD";
  panel.innerHTML = `
    <div class="field">
      <label for="payer-fiat">${t("pay.payWithLabel")}</label>
      <p class="field-hint">${t("pay.payWithHint", { price: fields.price })}</p>
      <select id="payer-fiat">${fiats
        .map(
          (code) =>
            `<option value="${escapeHtml(code)}" ${code === defaultFiat ? "selected" : ""}>${escapeHtml(
              `${code} · ${FIAT_LABELS[code] ?? code}`
            )}</option>`
        )
        .join("")}</select>
    </div>
    <div class="btn-row">
      <button type="button" id="start-onramp">${t("pay.continueCard")}</button>
    </div>
    <p class="field-hint">${escapeHtml(t("pay.cardFeeNote", { token }))}</p>
    ${sandbox ? `<p class="callout info">${escapeHtml(t("pay.sandboxNote"))}</p>` : ""}
    <div id="onramp-frame-host" class="onramp-frame-host" hidden></div>
    <p id="onramp-error" class="danger" hidden></p>
  `;

  const start = async () => {
    const fiat = panel.querySelector<HTMLSelectElement>("#payer-fiat")?.value ?? defaultFiat;
    const host = panel.querySelector<HTMLElement>("#onramp-frame-host");
    const err = panel.querySelector<HTMLElement>("#onramp-error");
    const btn = panel.querySelector<HTMLButtonElement>("#start-onramp");
    if (err) {
      err.hidden = true;
      err.textContent = "";
    }
    if (btn) btn.disabled = true;
    if (host) {
      host.hidden = false;
      host.innerHTML = `<div class="onramp-skeleton" aria-busy="true">${escapeHtml(t("pay.loadingCheckout"))}</div>`;
    }
    try {
      const res = await fetch(apiUrl(`/api/invoices/${encodeURIComponent(invoiceId)}/onramp-session`), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ fiat }),
      });
      const body = (await res.json()) as { widgetUrl?: string; error?: string };
      if (!res.ok || !body.widgetUrl) throw new Error(body.error ?? t("pay.checkoutFailed"));
      if (host) {
        const iframe = document.createElement("iframe");
        iframe.className = "onramp-iframe";
        iframe.title = t("pay.onrampIframeTitle");
        iframe.allow = "accelerometer; autoplay; camera; gyroscope; payment; microphone; clipboard-write";
        // Same-origin demo HTML is blocked by gateway X-Frame-Options: DENY if
        // loaded via src=. Fetch + srcdoc is not an embed of that response.
        if (isSameOriginWidgetUrl(body.widgetUrl)) {
          const demo = await fetch(body.widgetUrl);
          if (!demo.ok) throw new Error(t("pay.checkoutFailed"));
          iframe.srcdoc = await demo.text();
        } else {
          iframe.src = body.widgetUrl;
          iframe.loading = "lazy";
        }
        host.replaceChildren(iframe);
      }
    } catch (error) {
      if (host) host.hidden = true;
      if (err) {
        err.hidden = false;
        err.textContent = error instanceof Error ? localizeError(error) : t("pay.checkoutFailed");
      }
    } finally {
      if (btn) btn.disabled = false;
    }
  };

  panel.querySelector<HTMLButtonElement>("#start-onramp")?.addEventListener("click", () => void start());
  void lockFiat;
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
    status === "swept" ? t("pay.completeTitle") : status === "paid_partial" ? t("pay.partialTitle") : t("pay.receivedTitle");
  const chainId = invoice.chainId ?? fields.chains[0];
  const addressUrl = invoice.invoiceAddress ? explorerAddressUrl(chainId, invoice.invoiceAddress) : null;
  const paidDisplay = formatTokenAmount(invoice.amountPaid, invoice.token, invoice.chainId);
  const isFiatForward = (invoice.paymentMode ?? fields.paymentMode) === "fiat";

  root.innerHTML = `
    <div class="invoice-shell">
      <section class="invoice-doc">
        <p class="eyebrow">${t("pay.invoiceEyebrow")}</p>
        ${testnetPillHtml(chainId)}
        <h1>${escapeHtml(fields.title ?? t("pay.defaultTitle"))}</h1>
        <p class="amount-due">${escapeHtml(t("pay.paidAmount", { price: fields.price }))}</p>
        <span class="status-badge ${escapeHtml(status)}">${escapeHtml(statusLabel(status))}</span>
        ${
          isFiatForward
            ? ""
            : `<div class="pay-asset-banner">
          <div class="pay-asset-item">
            <span class="pay-asset-label">${t("pay.network")}</span>
            ${chainChipHtml(chainId, { size: "lg" })}
          </div>
          <div class="pay-asset-item">
            <span class="pay-asset-label">${t("pay.token")}</span>
            ${tokenChipHtml(invoice.token, { size: "lg" })}
          </div>
        </div>`
        }
        <div class="callout ok">
          <strong>${escapeHtml(title)}.</strong>
          ${status === "swept" ? t("pay.confirmed") : t("pay.confirming")}
        </div>
        <details class="onchain-receipt" ${isFiatForward ? "" : "open"}>
          <summary>${t("pay.onchainReceipt")}</summary>
          <div class="address-box" style="text-align:start;margin-top:0.75rem">
            <div><strong>${t("pay.invoiceId")}</strong><br /><span class="mono">${escapeHtml(invoiceId)}</span></div>
            ${
              invoice.invoiceAddress
                ? `<div style="margin-top:0.75rem"><strong>${t("pay.paymentAddress")}</strong><br />${
                    addressUrl
                      ? `<a class="mono" href="${escapeHtml(addressUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(invoice.invoiceAddress)}</a>`
                      : `<span class="mono">${escapeHtml(invoice.invoiceAddress)}</span>`
                  }</div>`
                : ""
            }
            ${
              invoice.amountPaid && invoice.amountPaid !== "0"
                ? `<div style="margin-top:0.75rem"><strong>${t("pay.amountPaid")}</strong><br /><span class="mono">${escapeHtml(paidDisplay)}</span></div>`
                : ""
            }
          </div>
        </details>
        <div id="pay-status" class="status"></div>
        <p class="merchant-hint">${escapeHtml(maskMerchant(invoice.selectedTo ?? fields.to[0] ?? ""))}</p>
      </section>
    </div>
  `;

  if (fields.callback && isPaidLike(status)) {
    const statusEl = root.querySelector<HTMLElement>("#pay-status");
    const url = new URL(fields.callback);
    url.searchParams.set("invoice_id", invoiceId);
    if (fields.clientInvoiceId) url.searchParams.set("client_invoice_id", fields.clientInvoiceId);
    url.searchParams.set("status", status);
    if (invoice.invoiceAddress) url.searchParams.set("invoice_address", invoice.invoiceAddress);
    if (statusEl) {
      statusEl.innerHTML = `<p class="ok">${escapeHtml(t("pay.redirecting", { url: url.toString() }))}</p>`;
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
          badge.textContent = statusLabel(invoice.status);
        }
        const statusEl = root.querySelector<HTMLElement>("#pay-status");
        if (statusEl) {
          statusEl.innerHTML = `
            <p>${escapeHtml(t("pay.statusLine", { status: statusLabel(invoice.status) }))}</p>
            <p class="field-hint" style="margin:0.35rem 0 0">${escapeHtml(t("pay.checkingEvery", { seconds: POLL_MS / 1000 }))}</p>
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
  payRoot.__tcMoreAbort?.abort();
}

function bindPayMoreMenu(root: HTMLElement): void {
  const payRoot = root as PayRoot;
  payRoot.__tcMoreAbort?.abort();
  const more = root.querySelector<HTMLDetailsElement>(".pay-more");
  if (!more) return;
  const ac = new AbortController();
  payRoot.__tcMoreAbort = ac;
  document.addEventListener(
    "pointerdown",
    (event) => {
      if (!more.open) return;
      if (!more.contains(event.target as Node)) more.open = false;
    },
    { signal: ac.signal }
  );
  document.addEventListener(
    "keydown",
    (event) => {
      if (event.key === "Escape") more.open = false;
    },
    { signal: ac.signal }
  );
}

function isPaidLike(status: InvoiceStatus): boolean {
  return status === "paid" || status === "paid_partial" || status === "swept";
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
    paymentMode: fields.paymentMode ?? "crypto",
  };
}

function fieldsFromInvoice(invoice: InvoiceRecord, fallback?: PayLinkFields): PayLinkFields {
  return {
    price: invoice.priceUsd || fallback?.price || "0",
    to: invoice.toAddresses?.length ? invoice.toAddresses : fallback?.to ?? [],
    chains: invoice.chainId ? [invoice.chainId] : fallback?.chains ?? [],
    tokens: invoice.token ? [invoice.token] : fallback?.tokens ?? [],
    invoiceSeed: invoice.invoiceSeed || undefined,
    clientInvoiceId: invoice.clientInvoiceId || fallback?.clientInvoiceId,
    callback: invoice.callbackUrl ?? fallback?.callback,
    title: invoice.title ?? fallback?.title,
    description: invoice.description ?? fallback?.description,
    allowPartial: invoice.allowPartial ?? fallback?.allowPartial ?? false,
    paymentMode: invoice.paymentMode ?? fallback?.paymentMode ?? "crypto",
  };
}

function checkoutFingerprint(fields: PayLinkFields): string {
  return [
    fields.price,
    fields.to.join(","),
    fields.chains.join(","),
    fields.tokens.join(","),
    fields.clientInvoiceId ?? "",
    fields.callback ?? "",
    fields.title ?? "",
    fields.description ?? "",
    fields.allowPartial ? "1" : "0",
    fields.paymentMode ?? "crypto",
  ].join("|");
}

function replaceResumeUrl(invoiceId: string): void {
  history.replaceState(null, "", `/pay?${encodeInvoiceResumeLink(invoiceId)}`);
}

function short(value: string): string {
  return value.length > 18 ? `${value.slice(0, 10)}…${value.slice(-6)}` : value;
}

/** Discreet merchant wallet hint for testing (first 4 + last 4 chars). */
function maskMerchant(address: string): string {
  if (!address || address.length < 10) return address;
  return `${address.slice(0, 4)}…${address.slice(-4)}`;
}

function isSameOriginWidgetUrl(url: string): boolean {
  if (url.startsWith("/")) return true;
  try {
    return new URL(url, window.location.href).origin === window.location.origin;
  } catch {
    return false;
  }
}
