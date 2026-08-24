import { encodePayLink, payPath } from "../shared/invoice.js";
import { copyText, escapeHtml } from "../shared/dom.js";
import { localizeError } from "../i18n/errors.js";
import { t } from "../i18n/t.js";
import {
  chainLogoSvg,
  deploymentMode,
  networkKind,
  networkShort,
  networksForDeployment,
  normalizeAddress,
  tokenAllowedOnChain,
  tokensForChains,
  type ChainKind,
  type NetworkOption,
} from "../shared/networks.js";
import { apiUrl } from "../shared/site.js";
import type { PayLinkFields, PaymentMode } from "../shared/types.js";

interface OnrampPublicConfig {
  enabled: boolean;
  sandbox?: boolean;
  fiats: string[];
  supportedPairs: Array<{ chainId: string; token: string }>;
}

interface OnrampQuoteResponse {
  fiatAmount: string;
  cryptoAmount: string;
  fiat: string;
  demo?: boolean;
  quotes?: Array<{ provider: string; paymentMethod: string; fiatAmount: string; cryptoAmount: string }>;
  recommended?: { provider: string; paymentMethod: string; fiatAmount: string; cryptoAmount: string };
}

let fiatQuoteTimer: ReturnType<typeof setTimeout> | undefined;

function onrampSupportedSet(root: HTMLElement): Set<string> {
  const raw = root.dataset.onrampPairs;
  if (!raw) return new Set();
  try {
    const pairs = JSON.parse(raw) as Array<{ chainId: string; token: string }>;
    return new Set(pairs.map((p) => `${p.chainId}:${p.token.toUpperCase()}`));
  } catch {
    return new Set();
  }
}

function chainHasOnrampSupport(root: HTMLElement, chainId: string): boolean {
  const supported = onrampSupportedSet(root);
  return supported.has(`${chainId}:USDC`) || supported.has(`${chainId}:USDT`);
}

export function renderCreate(root: HTMLElement): void {
  const mode = deploymentMode();
  const networks = networksForDeployment(mode);
  const modeLabel = mode === "testnet" ? t("common.testnet") : t("common.mainnet");
  const initialOrderId = `order-${Date.now().toString(36)}`;

  root.innerHTML = `
    <header class="page-header">
      <p class="eyebrow">${escapeHtml(t("create.eyebrow", { mode: modeLabel }))}</p>
      <h1>${t("create.h1")}</h1>
      <p>${t("create.lede")}</p>
      ${
        mode === "testnet"
          ? `<p class="callout info" role="status">${t("create.testnetCallout")}</p>`
          : ""
      }
    </header>

    <div class="create-layout">
      <section class="panel">
        <form id="create-form" autocomplete="off">
          <div class="field">
            <label for="clientInvoiceId">${t("create.clientIdLabel")}</label>
            <p class="field-hint">${t("create.clientIdHint")}</p>
            <input id="clientInvoiceId" name="clientInvoiceId" class="mono" placeholder="${escapeHtml(t("create.clientIdPlaceholder"))}" value="${escapeHtml(initialOrderId)}" />
          </div>

          <div class="field">
            <label for="title">${t("create.titleLabel")}</label>
            <p class="field-hint">${t("create.titleHint")}</p>
            <input id="title" name="title" placeholder="${escapeHtml(t("create.titlePlaceholder"))}" />
          </div>

          <div class="field">
            <label for="description">${t("create.descriptionLabel")}</label>
            <p class="field-hint">${t("create.descriptionHint")}</p>
            <textarea id="description" name="description" placeholder="${escapeHtml(t("create.descriptionPlaceholder"))}"></textarea>
          </div>

          <div class="field">
            <label for="price" id="price-label">${t("create.amountLabel")} <span class="required">${t("common.required")}</span></label>
            <p class="field-hint" id="price-hint">${t("create.amountHint")}</p>
            <input id="price" name="price" required inputmode="decimal" placeholder="128.00" value="10.00" />
          </div>

          <div class="field" id="fiat-quote-field" hidden>
            <label for="displayFiat">${t("create.displayFiatLabel")}</label>
            <select id="displayFiat" name="displayFiat">
              <option value="SEK">SEK</option>
              <option value="EUR">EUR</option>
              <option value="USD">USD</option>
              <option value="GBP">GBP</option>
            </select>
            <label for="quoteCountry" style="margin-top:0.75rem;display:block">${t("create.quoteCountryLabel")}</label>
            <input id="quoteCountry" name="quoteCountry" class="mono" value="se" maxlength="2" />
            <label for="quotePaymentMethod" style="margin-top:0.75rem;display:block">${t("create.quoteMethodLabel")}</label>
            <select id="quotePaymentMethod" name="quotePaymentMethod">
              <option value="creditcard">Credit card</option>
            </select>
            <label for="quoteProvider" style="margin-top:0.75rem;display:block">${t("create.quoteProviderLabel")}</label>
            <select id="quoteProvider" name="quoteProvider">
              <option value="">—</option>
            </select>
            <label for="quoteSlippagePct" style="margin-top:0.75rem;display:block">${t("create.quoteSlippageLabel")}</label>
            <p class="field-hint">${t("create.quoteSlippageHint")}</p>
            <input id="quoteSlippagePct" name="quoteSlippagePct" inputmode="decimal" value="1" placeholder="1" />
            <p class="callout info" id="fiat-charge-preview" hidden></p>
            <p class="field-hint" id="fiat-quote-status"></p>
          </div>

          <div class="field" id="payment-mode-field" hidden>
            <label>${t("create.paymentModeLabel")}</label>
            <p class="field-hint">${t("create.paymentModeHint")}</p>
            <div class="choice-card-row" id="payment-mode" role="radiogroup" aria-label="${escapeHtml(t("create.paymentModeAria"))}">
              ${paymentModeCardHtml("crypto", true)}
              ${paymentModeCardHtml("crypto_or_fiat", false)}
              ${paymentModeCardHtml("fiat", false)}
            </div>
          </div>

          <div class="field">
            <label id="networks-label">${t("create.networksLabel")} <span class="required">${t("common.required")}</span></label>
            <p class="field-hint" id="networks-hint">${t("create.networksHint")}</p>
            <div class="chain-pill-row" id="chains" role="group" aria-label="${escapeHtml(t("create.networksAria"))}">
              ${
                networks.length === 0
                  ? `<p class="danger">${escapeHtml(t("create.noNetworks", { mode: modeLabel }))}</p>`
                  : networks.map((n, i) => chainPillHtml(n, i === 0)).join("")
              }
            </div>
          </div>

          <div class="field" id="evm-wallet-field" hidden>
            <label for="toEvm">${t("create.evmWalletLabel")} <span class="required">${t("common.required")}</span></label>
            <div class="callout info wallet-settlement-note" role="note">
              <strong>${t("create.fundsSweptStrong")}</strong>
              ${t("create.evmWalletNote")}
            </div>
            <p class="field-hint">${t("create.evmWalletHint")}</p>
            <input id="toEvm" name="toEvm" class="mono" placeholder="0x…" autocomplete="off" spellcheck="false" disabled />
            <p class="field-error" id="toEvm-error" hidden></p>
          </div>

          <div class="field" id="tron-wallet-field" hidden>
            <label for="toTron">${t("create.tronWalletLabel")} <span class="required">${t("common.required")}</span></label>
            <div class="callout info wallet-settlement-note" role="note">
              <strong>${t("create.fundsSweptStrong")}</strong>
              ${t("create.tronWalletNote")}
            </div>
            <p class="field-hint">${t("create.tronWalletHint")}</p>
            <input id="toTron" name="toTron" class="mono" placeholder="T…" autocomplete="off" spellcheck="false" disabled />
            <p class="field-error" id="toTron-error" hidden></p>
          </div>

          <div class="field" id="solana-wallet-field" hidden>
            <label for="toSolana">${t("create.solanaWalletLabel")} <span class="required">${t("common.required")}</span></label>
            <div class="callout info wallet-settlement-note" role="note">
              <strong>${t("create.fundsSweptStrong")}</strong>
              ${t("create.solanaWalletNote")}
            </div>
            <p class="field-hint">${t("create.solanaWalletHint")}</p>
            <input id="toSolana" name="toSolana" class="mono" placeholder="So…" autocomplete="off" spellcheck="false" disabled />
            <p class="field-error" id="toSolana-error" hidden></p>
          </div>

          <div class="field">
            <label>${t("create.tokensLabel")} <span class="required">${t("common.required")}</span></label>
            <p class="field-hint">${t("create.tokensHint")}</p>
            <div class="field-row" id="tokens"></div>
          </div>

          <div class="field">
            <label for="callback">${t("create.callbackLabel")}</label>
            <p class="field-hint">${t("create.callbackHint")}</p>
            <input id="callback" name="callback" type="url" placeholder="https://shop.example/webhooks/trustless-commerce" />
          </div>

          <div class="field">
            <label class="check">
              <input type="checkbox" id="allowPartial" name="allowPartial" />
              ${t("create.allowPartial")}
            </label>
            <p class="field-hint">${t("create.allowPartialHint")}</p>
          </div>

          <div class="btn-row create-actions">
            <button type="submit" id="open-checkout" disabled>${t("create.openCheckout")}</button>
            <button type="button" id="copy-pay-link" class="secondary" disabled>${t("create.copyPayLink")}</button>
          </div>
          <p class="status" id="form-action-status" role="status"></p>
        </form>
      </section>

      <aside class="panel create-output" id="preview">
        <p class="eyebrow">${t("create.outputEyebrow")}</p>
        <h2>${t("create.outputTitle")}</h2>
        <p class="field-hint">${t("create.outputHint")}</p>
        <div id="preview-body"></div>
      </aside>
    </div>

    <section class="docs-block" id="docs">
      <div class="panel panel-quiet">
        <p class="eyebrow">${t("create.docsEyebrow")}</p>
        <h2>${t("create.docsTitle")}</h2>
        <p>${t("create.docsIntro")}</p>

        <h3 style="margin-top:1.5rem">${t("create.docsQueryTitle")}</h3>
        <p class="field-hint">${t("create.docsQueryHint")}</p>
        <pre id="docs-query"></pre>

        <h3 style="margin-top:1.5rem">${t("create.docsCreateTitle")}</h3>
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
  "allowPartial": false,
  "paymentMode": "crypto"
}</pre>
        <p class="field-hint">${t("create.docsCreateHint")}</p>

        <h3 style="margin-top:1.5rem">${t("create.docsStatusTitle")}</h3>
        <pre>GET /api/invoices/{invoiceId}

${t("create.docsStatusLine")}</pre>
        <p class="field-hint">${t("create.docsStatusHint")}</p>

        <h3 style="margin-top:1.5rem">${t("create.docsAgentsTitle")}</h3>
        <p>
          ${t("create.docsAgentsBody")}
          <a href="https://raw.githubusercontent.com/naiemk/onchain-invoice/main/.cursor/skills/trustless-commerce-invoice/SKILL.md"
             rel="alternate noopener noreferrer"
             target="_blank"><span class="mono">.cursor/skills/trustless-commerce-invoice/SKILL.md</span></a>
          ·
          <a href="https://naiemk.github.io/onchain-invoice/" target="_blank" rel="noopener noreferrer">${t("create.docsGithubPages")}</a>.
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
    const openBtn = root.querySelector<HTMLButtonElement>("#open-checkout");
    const copyBtn = root.querySelector<HTMLButtonElement>("#copy-pay-link");
    if (!previewBody) return;
    try {
      const fields = readForm(root);
      const path = payPath(fields);
      const link = `${location.origin}${path}`;
      const payLabel = t("create.payWithCrypto", { price: fields.price });
      const embed = `<a href="${link}" class="tc-pay-button" target="_blank" rel="noopener noreferrer">${payLabel}</a>`;
      previewBody.innerHTML = `
        <div class="field">
          <label>${t("create.payLinkLabel")}</label>
          <div class="mono-block" id="out-url">${escapeHtml(link)}</div>
        </div>
        <div class="field">
          <label>${t("create.embedLabel")}</label>
          <div class="mono-block" id="out-embed">${escapeHtml(embed)}</div>
          <button type="button" class="secondary" id="copy-embed">${t("create.copyHtml")}</button>
        </div>
        <div class="field">
          <label>${t("create.renderedLabel")}</label>
          <div class="pay-button-preview">
            <a href="${escapeHtml(path)}" class="tc-pay-button" target="_blank" rel="noopener noreferrer">${escapeHtml(payLabel)}</a>
          </div>
        </div>
        <p class="field-hint" id="copy-status"></p>
      `;
      if (openBtn) openBtn.disabled = false;
      if (copyBtn) {
        copyBtn.disabled = false;
        copyBtn.dataset.link = link;
      }
      previewBody.querySelector<HTMLButtonElement>("#copy-embed")?.addEventListener("click", async () => {
        await copyText(embed);
        const note = previewBody.querySelector<HTMLElement>("#copy-status");
        if (note) note.textContent = t("create.embedCopied");
      });
      if (docsQuery) {
        docsQuery.textContent = `${location.origin}/pay?${encodePayLink(fields)}`;
      }
    } catch (error) {
      previewBody.innerHTML = `<p class="danger">${escapeHtml(error instanceof Error ? localizeError(error) : t("common.incomplete"))}</p>`;
      if (openBtn) openBtn.disabled = true;
      if (copyBtn) {
        copyBtn.disabled = true;
        delete copyBtn.dataset.link;
      }
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
  form?.addEventListener("submit", (event) => {
    event.preventDefault();
    const mode = selectedPaymentMode(root);
    if (mode === "fiat") {
      void submitFiatInvoice(root);
      return;
    }
    try {
      const fields = readForm(root);
      const path = payPath(fields);
      window.open(path, "_blank", "noopener,noreferrer");
      const note = root.querySelector<HTMLElement>("#form-action-status");
      if (note) note.textContent = t("create.openedCheckout");
    } catch (error) {
      const note = root.querySelector<HTMLElement>("#form-action-status");
      if (note) {
        note.textContent = error instanceof Error ? localizeError(error) : t("errors.fillRequired");
        note.classList.add("danger");
      }
    }
  });
  root.querySelector<HTMLButtonElement>("#copy-pay-link")?.addEventListener("click", async () => {
    const btn = root.querySelector<HTMLButtonElement>("#copy-pay-link");
    const link = btn?.dataset.link ?? "";
    if (!link) return;
    await copyText(link);
    const note = root.querySelector<HTMLElement>("#form-action-status");
    if (note) {
      note.textContent = t("create.payLinkCopied");
      note.classList.remove("danger");
    }
  });

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

  root.querySelector("#payment-mode")?.addEventListener("change", () => {
    applyPaymentModeUi(root);
    refresh();
  });

  for (const id of ["displayFiat", "quoteCountry", "quotePaymentMethod", "quoteProvider", "quoteSlippagePct", "price"]) {
    root.querySelector(`#${id}`)?.addEventListener("input", () => {
      if (selectedPaymentMode(root) === "fiat") {
        if (id === "displayFiat" || id === "quoteCountry" || id === "quotePaymentMethod" || id === "price") {
          if (id === "displayFiat" || id === "quoteCountry") void loadQuotePaymentMethods(root);
          if (id !== "quoteProvider" && id !== "quoteSlippagePct") scheduleFiatQuote(root);
        }
      }
    });
    root.querySelector(`#${id}`)?.addEventListener("change", () => {
      if (selectedPaymentMode(root) === "fiat") {
        if (id === "displayFiat" || id === "quoteCountry") void loadQuotePaymentMethods(root);
        if (id !== "quoteSlippagePct") scheduleFiatQuote(root);
      }
    });
  }

  void loadOnrampConfig(root).then(() => {
    applyPaymentModeUi(root);
    refresh();
  });

  refresh();

  if (location.hash === "#docs") {
    root.querySelector("#docs")?.scrollIntoView({ behavior: "smooth" });
  }
}

function paymentModeCardHtml(mode: PaymentMode, selected: boolean): string {
  const titles: Record<PaymentMode, string> = {
    crypto: t("create.paymentModeCryptoTitle"),
    crypto_or_fiat: t("create.paymentModeBothTitle"),
    fiat: t("create.paymentModeFiatTitle"),
  };
  const hints: Record<PaymentMode, string> = {
    crypto: t("create.paymentModeCryptoHint"),
    crypto_or_fiat: t("create.paymentModeBothHint"),
    fiat: t("create.paymentModeFiatHint"),
  };
  return `
    <label class="choice-card ${selected ? "is-selected" : ""}">
      <input type="radio" name="paymentMode" value="${mode}" ${selected ? "checked" : ""} />
      <span class="choice-card-face">
        <span class="choice-card-title">${escapeHtml(titles[mode])}</span>
        <span class="choice-card-hint">${escapeHtml(hints[mode])}</span>
      </span>
    </label>`;
}

async function loadOnrampConfig(root: HTMLElement): Promise<void> {
  const field = root.querySelector<HTMLElement>("#payment-mode-field");
  if (!field) return;
  try {
    const res = await fetch(apiUrl("/api/public/onramp"));
    if (!res.ok) {
      field.hidden = true;
      return;
    }
    const body = (await res.json()) as OnrampPublicConfig;
    field.hidden = !body.enabled;
    root.dataset.onrampEnabled = body.enabled ? "1" : "0";
    root.dataset.onrampSandbox = body.sandbox ? "1" : "0";
    root.dataset.onrampPairs = JSON.stringify(body.supportedPairs ?? []);
        if (body.enabled && body.fiats.length > 0) {
      const select = root.querySelector<HTMLSelectElement>("#displayFiat");
      if (select) {
        select.innerHTML = body.fiats
          .map((code) => `<option value="${escapeHtml(code)}">${escapeHtml(code)}</option>`)
          .join("");
        if (body.fiats.includes("SEK")) select.value = "SEK";
      }
    }
    if (body.enabled) {
      const cryptoOrFiat = root.querySelector<HTMLInputElement>(
        'input[name="paymentMode"][value="crypto_or_fiat"]'
      );
      const crypto = root.querySelector<HTMLInputElement>('input[name="paymentMode"][value="crypto"]');
      if (cryptoOrFiat && crypto?.checked) {
        cryptoOrFiat.checked = true;
        crypto.checked = false;
      }
    }
  } catch {
    field.hidden = true;
  }
}

function selectedPaymentMode(root: HTMLElement): PaymentMode {
  if (root.dataset.onrampEnabled !== "1") return "crypto";
  const value = root.querySelector<HTMLInputElement>('input[name="paymentMode"]:checked')?.value;
  if (value === "crypto" || value === "crypto_or_fiat" || value === "fiat") return value;
  return "crypto_or_fiat";
}

function scheduleFiatQuote(root: HTMLElement): void {
  clearTimeout(fiatQuoteTimer);
  fiatQuoteTimer = setTimeout(() => void refreshFiatQuote(root), 400);
}

async function loadQuotePaymentMethods(root: HTMLElement): Promise<void> {
  if (selectedPaymentMode(root) !== "fiat") return;
  const chains = checked(root, "chains");
  const tokens = checked(root, "tokens");
  const chainId = chains[0];
  const token = tokens[0];
  const fiat = root.querySelector<HTMLSelectElement>("#displayFiat")?.value ?? "SEK";
  const country = root.querySelector<HTMLInputElement>("#quoteCountry")?.value.trim().toLowerCase() ?? "us";
  if (!chainId || !token) return;
  const select = root.querySelector<HTMLSelectElement>("#quotePaymentMethod");
  if (!select) return;
  try {
    const params = new URLSearchParams({ fiat, chainId, token, country });
    const res = await fetch(apiUrl(`/api/public/onramp-methods?${params}`));
    if (!res.ok) return;
    const body = (await res.json()) as { methods?: Array<{ id: string; name: string }> };
    if (!body.methods?.length) return;
    const previous = select.value;
    select.innerHTML = body.methods
      .map((m) => `<option value="${escapeHtml(m.id)}">${escapeHtml(m.name)}</option>`)
      .join("");
    if (body.methods.some((m) => m.id === previous)) select.value = previous;
  } catch {
    /* keep defaults */
  }
}

async function refreshFiatQuote(root: HTMLElement): Promise<void> {
  if (selectedPaymentMode(root) !== "fiat") return;
  const preview = root.querySelector<HTMLElement>("#fiat-charge-preview");
  const status = root.querySelector<HTMLElement>("#fiat-quote-status");
  const providerSelect = root.querySelector<HTMLSelectElement>("#quoteProvider");
  const chains = checked(root, "chains");
  const tokens = checked(root, "tokens");
  const chainId = chains[0];
  const token = tokens[0] ?? "USDC";
  // In fiat mode the amount field is the customer-facing fiat (e.g. SEK).
  const fiatAmount = root.querySelector<HTMLInputElement>("#price")?.value.trim();
  const fiat = root.querySelector<HTMLSelectElement>("#displayFiat")?.value ?? "SEK";
  const country = root.querySelector<HTMLInputElement>("#quoteCountry")?.value.trim().toLowerCase() ?? "us";
  const paymentMethod = root.querySelector<HTMLSelectElement>("#quotePaymentMethod")?.value ?? "creditcard";
  const preferredProvider = providerSelect?.value.trim() || undefined;
  if (!preview || !chainId || !token || !fiatAmount) return;
  if (status) status.textContent = t("create.quoteLoading");
  preview.hidden = true;
  try {
    const params = new URLSearchParams({
      fiat,
      chainId,
      token,
      country,
      paymentMethod,
      direction: "pay",
      fiatAmount,
    });
    if (preferredProvider) params.set("provider", preferredProvider);
    const res = await fetch(apiUrl(`/api/public/onramp-quote?${params}`));
    const body = (await res.json()) as OnrampQuoteResponse & { error?: string };
    if (!res.ok) throw new Error(body.error ?? t("create.quoteError"));
    const recommended = body.recommended ?? {
      provider: body.quotes?.[0]?.provider ?? "demo",
      paymentMethod,
      fiatAmount: body.fiatAmount,
      cryptoAmount: body.cryptoAmount,
    };
    if (providerSelect && body.quotes?.length) {
      const previous = preferredProvider || recommended.provider;
      providerSelect.innerHTML = body.quotes
        .map(
          (q) =>
            `<option value="${escapeHtml(q.provider)}">${escapeHtml(
              `${q.provider} · ${q.cryptoAmount} ${token}`
            )}</option>`
        )
        .join("");
      if (body.quotes.some((q) => q.provider === previous)) providerSelect.value = previous;
      else providerSelect.value = recommended.provider;
    }
    const activeProvider = providerSelect?.value || recommended.provider;
    const active =
      body.quotes?.find((q) => q.provider === activeProvider) ?? recommended;
    preview.textContent = t("create.settlePreview", { amount: active.cryptoAmount, token });
    preview.hidden = false;
    if (status) status.textContent = body.demo ? "Demo quote (no live Onramper keys)" : "";
    root.dataset.quotedDisplayAmount = active.fiatAmount;
    root.dataset.quotedDisplayFiat = body.fiat;
    root.dataset.quotedSettlement = active.cryptoAmount;
    root.dataset.quotedProvider = active.provider;
  } catch (error) {
    if (status) {
      status.textContent = error instanceof Error ? localizeError(error) : t("create.quoteError");
    }
    delete root.dataset.quotedDisplayAmount;
    delete root.dataset.quotedSettlement;
    delete root.dataset.quotedProvider;
  }
}

function applyPaymentModeUi(root: HTMLElement): void {
  const mode = selectedPaymentMode(root);
  for (const card of root.querySelectorAll<HTMLElement>(".choice-card")) {
    const input = card.querySelector<HTMLInputElement>('input[name="paymentMode"]');
    card.classList.toggle("is-selected", Boolean(input?.checked));
  }

  const networksLabel = root.querySelector<HTMLElement>("#networks-label");
  const networksHint = root.querySelector<HTMLElement>("#networks-hint");
  if (networksLabel) {
    networksLabel.innerHTML =
      mode === "fiat"
        ? `${t("create.settlementNetworkLabel")} <span class="required">${t("common.required")}</span>`
        : `${t("create.networksLabel")} <span class="required">${t("common.required")}</span>`;
  }
  if (networksHint) {
    networksHint.textContent = mode === "fiat" ? t("create.settlementNetworkHint") : t("create.networksHint");
  }

  const priceLabel = root.querySelector<HTMLElement>("#price-label");
  const priceHint = root.querySelector<HTMLElement>("#price-hint");
  const fiatQuoteField = root.querySelector<HTMLElement>("#fiat-quote-field");
  if (priceLabel) {
    priceLabel.innerHTML =
      mode === "fiat"
        ? `${t("create.fiatPayLabel")} <span class="required">${t("common.required")}</span>`
        : `${t("create.amountLabel")} <span class="required">${t("common.required")}</span>`;
  }
  if (priceHint) {
    priceHint.textContent = mode === "fiat" ? t("create.fiatPayHint") : t("create.amountHint");
  }
  if (fiatQuoteField) {
    fiatQuoteField.hidden = mode !== "fiat";
    if (mode === "fiat") scheduleFiatQuote(root);
  }

  const chainInputs = [...root.querySelectorAll<HTMLInputElement>('input[name="chains"]')];
  if (mode === "fiat") {
    const checkedChains = chainInputs.filter((el) => el.checked);
    let keep = checkedChains.find((el) => chainHasOnrampSupport(root, el.value));
    if (!keep) {
      keep =
        chainInputs.find((el) => chainHasOnrampSupport(root, el.value)) ??
        chainInputs.find((el) => el.value === "8453" || el.value === "11155111" || el.value === "tron" || el.value === "nile" || el.value === "56") ??
        chainInputs[0];
    }
    for (const el of chainInputs) {
      const chainSupported = chainHasOnrampSupport(root, el.value);
      el.checked = keep ? el === keep : false;
      el.disabled = !chainSupported;
      el.type = "radio";
      el.name = "chains";
    }
  } else {
    for (const el of chainInputs) {
      el.disabled = false;
      el.type = "checkbox";
      el.name = "chains";
    }
    if (chainInputs.every((el) => !el.checked) && chainInputs[0]) {
      chainInputs[0].checked = true;
    }
  }
}

function chainPillHtml(network: NetworkOption, checked: boolean): string {
  return `
    <label class="chain-pill">
      <input type="checkbox" name="chains" value="${escapeHtml(network.id)}" ${checked ? "checked" : ""} />
      <span class="chain-pill-face">
        ${chainLogoSvg(network.id, 20)}
        <span class="chain-pill-label">${escapeHtml(networkShort(network.id))}</span>
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
    const message = error instanceof Error ? localizeError(error) : t("errors.invalidAddress");
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
  const fiatMode = selectedPaymentMode(root) === "fiat";
  const supported = onrampSupportedSet(root);
  let tokens = tokensForChains(chains);
  if (fiatMode && supported.size > 0) {
    tokens = tokens.filter((token) =>
      chains.some((chainId) => supported.has(`${chainId}:${token.id}`))
    );
  }
  const needsTron = chains.some((id) => networkKind(id) === "tron");
  if (tokens.length === 0) {
    host.innerHTML = `<p class="field-hint">${t("create.selectNetworkForTokens")}</p>`;
    return;
  }
  const inputType = fiatMode ? "radio" : "checkbox";
  let keepToken =
    tokens.find((token) => previous.has(token.id)) ??
    tokens.find((token) => needsTron && token.id === "USDT") ??
    tokens[0];
  host.innerHTML = tokens
    .map((token) => {
      const locked = !fiatMode && needsTron && token.id === "USDT";
      const selected = fiatMode ? token.id === keepToken?.id : locked || (previous.size > 0 ? previous.has(token.id) : true);
      return `
        <label class="check">
          <input type="${inputType}" name="tokens" value="${escapeHtml(token.id)}"
            ${selected ? "checked" : ""} ${locked ? "disabled" : ""} />
          ${escapeHtml(token.label)}${locked ? ` · ${t("create.usdtRequiredForTron")}` : ""}
        </label>`;
    })
    .join("");

  if (!fiatMode && needsTron) {
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

  if (!price) throw new Error(t("errors.missingPrice"));
  if (chains.length === 0) throw new Error(t("errors.missingNetwork"));
  if (tokens.length === 0) throw new Error(t("errors.missingToken"));
  if (needsTron && !tokens.includes("USDT")) {
    throw new Error(t("errors.usdtRequiredForTron"));
  }

  for (const chainId of chains) {
    const allowed = tokens.some((token) => tokenAllowedOnChain(chainId, token));
    if (!allowed) {
      throw new Error(t("errors.noCompatibleToken", { chainId }));
    }
  }

  const to: string[] = [];
  if (needsEvm) {
    if (!toEvm) throw new Error(t("errors.evmWalletRequired"));
    to.push(normalizeAddress(toEvm, "evm"));
  }
  if (needsTron) {
    if (!toTron) throw new Error(t("errors.tronWalletRequired"));
    to.push(normalizeAddress(toTron, "tron"));
  }
  if (needsSolana) {
    if (!toSolana) throw new Error(t("errors.solanaWalletRequired"));
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
    paymentMode: selectedPaymentMode(root),
    ...(selectedPaymentMode(root) === "fiat"
      ? {
          // Amount field is customer fiat; settlement USDC comes from the quote.
          price: root.dataset.quotedSettlement || "0",
          displayFiat: value("displayFiat") || root.dataset.quotedDisplayFiat || "SEK",
          displayAmount: value("price") || root.dataset.quotedDisplayAmount,
          quoteCountry: value("quoteCountry") || "us",
          quotePaymentMethod: value("quotePaymentMethod") || "creditcard",
          quoteProvider: value("quoteProvider") || root.dataset.quotedProvider,
          quoteSlippageBps: (() => {
            const pct = Number(value("quoteSlippagePct") || "1");
            if (!Number.isFinite(pct) || pct < 0) return 100;
            return Math.round(pct * 100);
          })(),
        }
      : {}),
  };
}

async function submitFiatInvoice(root: HTMLElement): Promise<void> {
  const note = root.querySelector<HTMLElement>("#form-action-status");
  const openBtn = root.querySelector<HTMLButtonElement>("#open-checkout");
  try {
    if (openBtn) openBtn.disabled = true;
    if (note) {
      note.textContent = t("pay.creatingAddress");
      note.classList.remove("danger");
    }
    await refreshFiatQuote(root);
    const fields = readForm(root);
    if (!fields.displayAmount || !fields.displayFiat) throw new Error(t("create.quoteError"));
    if (!fields.price || fields.price === "0") throw new Error(t("create.quoteError"));
    if (!fields.quoteProvider) throw new Error(t("create.quoteError"));
    const chainId = fields.chains[0];
    const token = fields.tokens[0];
    const selectedTo = fields.to[0];
    const response = await fetch(apiUrl("/api/invoices"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        price: fields.price,
        to: fields.to,
        chains: fields.chains,
        tokens: fields.tokens,
        clientInvoiceId: fields.clientInvoiceId,
        callback: fields.callback,
        title: fields.title,
        description: fields.description,
        allowPartial: fields.allowPartial,
        paymentMode: "fiat",
        displayFiat: fields.displayFiat,
        displayAmount: fields.displayAmount,
        quoteCountry: fields.quoteCountry,
        quotePaymentMethod: fields.quotePaymentMethod,
        quoteProvider: fields.quoteProvider,
        quoteSlippageBps: fields.quoteSlippageBps,
        chainId,
        token,
        selectedTo,
      }),
    });
    const body = (await response.json()) as { payLink?: string; error?: string };
    if (!response.ok || !body.payLink) throw new Error(body.error ?? t("errors.createFailed"));
    window.open(body.payLink, "_blank", "noopener,noreferrer");
    if (note) note.textContent = t("create.openedCheckout");
  } catch (error) {
    if (note) {
      note.textContent = error instanceof Error ? localizeError(error) : t("errors.fillRequired");
      note.classList.add("danger");
    }
  } finally {
    if (openBtn) openBtn.disabled = false;
  }
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
    paymentMode: selectedPaymentMode(root),
  };
}
