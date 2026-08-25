import { encodePayLink, payPath } from "../../shared/invoice.js";
import { copyText, escapeHtml } from "../../shared/dom.js";
import { localizeError, localizeOnrampQuoteError } from "../../i18n/errors.js";
import { t } from "../../i18n/t.js";
import { createCounterfactualWallet } from "../../shared/wallet-create.js";
import { loadWalletSession } from "../../shared/webauthn.js";
import {
  deploymentMode,
  networkKind,
  networkShort,
  networksForDeployment,
} from "../../shared/networks.js";
import { apiUrl } from "../../shared/site.js";
import { AUTO_VALUE, ruleFor, type FiatField } from "./fiat-rules.js";
import {
  chainHasOnrampSupport,
  checked,
  clearAddressFieldError,
  fieldValue,
  fiatMinimumChainIds,
  markAddressField,
  readForm,
  readFormLoose,
  renderTokenOptions,
  selectedOnrampPairs,
  selectedPaymentMode,
  setWalletField,
  validateStep,
  type WizardStep,
} from "./form.js";
import { loadCreatePrefs, patchCreatePrefs, pickRemembered } from "./prefs.js";
import { stepAmountHtml } from "./step-amount.js";
import { stepDetailsHtml } from "./step-details.js";
import { stepNetworkHtml } from "./step-network.js";

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
  chainId?: string;
  token?: string;
}

let fiatQuoteTimer: ReturnType<typeof setTimeout> | undefined;
let currentStep: WizardStep = 1;

export function renderCreate(root: HTMLElement): void {
  const mode = deploymentMode();
  const networks = networksForDeployment(mode);
  const modeLabel = mode === "testnet" ? t("common.testnet") : t("common.mainnet");
  const initialOrderId = `order-${Date.now().toString(36)}`;
  const prefs = loadCreatePrefs();

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
        <nav class="create-wizard-stepper wallet-stepper" aria-label="${escapeHtml(t("create.stepOf", { current: "1", total: "3" }))}">
          <ol>
            <li data-goto="1" class="is-active"><button type="button">${t("create.stepDetails")}</button></li>
            <li data-goto="2"><button type="button">${t("create.stepNetwork")}</button></li>
            <li data-goto="3"><button type="button">${t("create.stepAmount")}</button></li>
          </ol>
        </nav>

        <form id="create-form" autocomplete="off">
          ${stepDetailsHtml(initialOrderId)}
          ${stepNetworkHtml(networks, modeLabel)}
          ${stepAmountHtml()}

          <p class="status" id="form-action-status" role="status"></p>
          <div class="btn-row create-actions wizard-nav">
            <button type="button" class="secondary" id="wizard-back" hidden>${t("create.back")}</button>
            <button type="button" id="wizard-next">${t("create.next")}</button>
            <button type="submit" id="open-checkout" hidden disabled>${t("create.openCheckout")}</button>
            <button type="button" id="copy-pay-link" class="secondary" hidden disabled>${t("create.copyPayLink")}</button>
          </div>
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

  // Prefill remembered wallets
  const toEvm = root.querySelector<HTMLInputElement>("#toEvm");
  const toTron = root.querySelector<HTMLInputElement>("#toTron");
  const toSolana = root.querySelector<HTMLInputElement>("#toSolana");
  if (toTron && prefs.walletTron) toTron.value = prefs.walletTron;
  if (toSolana && prefs.walletSolana) toSolana.value = prefs.walletSolana;

  const form = root.querySelector<HTMLFormElement>("#create-form");
  const previewBody = root.querySelector<HTMLElement>("#preview-body");
  const docsQuery = root.querySelector<HTMLElement>("#docs-query");

  const goToStep = (step: WizardStep) => {
    currentStep = step;
    for (const el of root.querySelectorAll<HTMLElement>(".wizard-step")) {
      el.hidden = Number(el.dataset.step) !== step;
    }
    for (const li of root.querySelectorAll<HTMLElement>(".create-wizard-stepper li")) {
      const n = Number(li.dataset.goto);
      li.classList.toggle("is-active", n === step);
      li.classList.toggle("is-done", n < step);
    }
    const back = root.querySelector<HTMLButtonElement>("#wizard-back");
    const next = root.querySelector<HTMLButtonElement>("#wizard-next");
    const open = root.querySelector<HTMLButtonElement>("#open-checkout");
    const copy = root.querySelector<HTMLButtonElement>("#copy-pay-link");
    if (back) back.hidden = step === 1;
    if (next) next.hidden = step === 3;
    if (open) open.hidden = step !== 3;
    if (copy) copy.hidden = step !== 3;
    const note = root.querySelector<HTMLElement>("#form-action-status");
    if (note) {
      note.textContent = "";
      note.classList.remove("danger");
    }
    applyPaymentModeUi(root);
    refresh();
  };

  const syncKindFields = () => {
    const chains = checked(root, "chains");
    setWalletField(
      root.querySelector("#evm-wallet-field"),
      root.querySelector("#toEvm"),
      chains.some((id) => networkKind(id) === "evm")
    );
    setWalletField(
      root.querySelector("#tron-wallet-field"),
      root.querySelector("#toTron"),
      chains.some((id) => networkKind(id) === "tron")
    );
    setWalletField(
      root.querySelector("#solana-wallet-field"),
      root.querySelector("#toSolana"),
      chains.some((id) => networkKind(id) === "solana")
    );
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
      if (docsQuery) docsQuery.textContent = `${location.origin}/pay?${encodePayLink(fields)}`;
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

  form?.addEventListener("change", (event) => {
    const target = event.target;
    if (target instanceof HTMLInputElement && target.name === "chains" && !target.checked) {
      if (checked(root, "chains").length === 0) target.checked = true;
    }
  });
  form?.addEventListener("input", refresh);
  form?.addEventListener("change", refresh);

  form?.addEventListener("submit", (event) => {
    event.preventDefault();
    const paymentMode = selectedPaymentMode(root);
    if (paymentMode === "fiat") {
      void submitFiatInvoice(root);
      return;
    }
    try {
      const fields = readForm(root);
      window.open(payPath(fields), "_blank", "noopener,noreferrer");
      const note = root.querySelector<HTMLElement>("#form-action-status");
      if (note) note.textContent = t("create.openedCheckout");
      persistPrefs(root);
    } catch (error) {
      const note = root.querySelector<HTMLElement>("#form-action-status");
      if (note) {
        note.textContent = error instanceof Error ? localizeError(error) : t("errors.fillRequired");
        note.classList.add("danger");
      }
    }
  });

  root.querySelector("#wizard-next")?.addEventListener("click", () => {
    try {
      validateStep(root, currentStep);
      if (currentStep === 1) goToStep(2);
      else if (currentStep === 2) goToStep(3);
    } catch (error) {
      const note = root.querySelector<HTMLElement>("#form-action-status");
      if (note) {
        note.textContent = error instanceof Error ? localizeError(error) : t("errors.fillRequired");
        note.classList.add("danger");
      }
    }
  });
  root.querySelector("#wizard-back")?.addEventListener("click", () => {
    if (currentStep === 3) goToStep(2);
    else if (currentStep === 2) goToStep(1);
  });
  root.querySelectorAll<HTMLElement>(".create-wizard-stepper li").forEach((li) => {
    li.querySelector("button")?.addEventListener("click", () => {
      const n = Number(li.dataset.goto) as WizardStep;
      if (n < currentStep) goToStep(n);
      else if (n > currentStep) {
        try {
          for (let s = currentStep; s < n; s++) validateStep(root, s as WizardStep);
          goToStep(n);
        } catch (error) {
          const note = root.querySelector<HTMLElement>("#form-action-status");
          if (note) {
            note.textContent = error instanceof Error ? localizeError(error) : t("errors.fillRequired");
            note.classList.add("danger");
          }
        }
      }
    });
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

  bindWalletPicker(root, refresh);
  bindAddressValidation(root);
  bindFiatCascade(root, refresh);

  root.querySelector("#payment-mode")?.addEventListener("change", () => {
    applyPaymentModeUi(root);
    persistPrefs(root);
    refresh();
  });

  void loadOnrampConfig(root).then(() => {
    applyPaymentModeUi(root);
    refresh();
  });

  goToStep(1);

  if (location.hash === "#docs") {
    root.querySelector("#docs")?.scrollIntoView({ behavior: "smooth" });
  }
}

function persistPrefs(root: HTMLElement): void {
  patchCreatePrefs({
    walletEvm: fieldValue(root, "toEvm") || undefined,
    walletTron: fieldValue(root, "toTron") || undefined,
    walletSolana: fieldValue(root, "toSolana") || undefined,
    displayFiat: fieldValue(root, "displayFiat") || undefined,
    quoteCountry: fieldValue(root, "quoteCountry") || undefined,
    quotePaymentMethod: fieldValue(root, "quotePaymentMethod") || undefined,
    quoteProvider: fieldValue(root, "quoteProvider") || undefined,
    quoteSlippagePct: fieldValue(root, "quoteSlippagePct") || undefined,
    paymentMode: selectedPaymentMode(root),
  });
}

function bindWalletPicker(root: HTMLElement, refresh: () => void): void {
  const applyPasskeyWalletToForm = (address: string): void => {
    const toEvm = root.querySelector<HTMLInputElement>("#toEvm");
    const chip = root.querySelector<HTMLElement>("#passkey-wallet-chip");
    const clearBtn = root.querySelector<HTMLElement>("#clear-passkey-wallet");
    const select = root.querySelector<HTMLSelectElement>("#wallet-picker-select");
    if (!toEvm) return;
    toEvm.value = address;
    toEvm.readOnly = true;
    if (select) {
      if (![...select.options].some((o) => o.value.toLowerCase() === address.toLowerCase())) {
        select.value = "__custom__";
      } else {
        select.value = [...select.options].find((o) => o.value.toLowerCase() === address.toLowerCase())!.value;
      }
    }
    if (chip) {
      chip.hidden = false;
      chip.textContent = t("create.passkeyWalletLinked", { address });
    }
    clearBtn?.removeAttribute("hidden");
    patchCreatePrefs({ walletEvm: address });
    refresh();
  };

  const session = loadWalletSession();
  const prefs = loadCreatePrefs();
  if (session?.address) {
    applyPasskeyWalletToForm(session.address);
  } else if (prefs.walletEvm) {
    const toEvm = root.querySelector<HTMLInputElement>("#toEvm");
    if (toEvm) toEvm.value = prefs.walletEvm;
  }

  root.querySelector("#wallet-picker-select")?.addEventListener("change", () => {
    const select = root.querySelector<HTMLSelectElement>("#wallet-picker-select");
    const toEvm = root.querySelector<HTMLInputElement>("#toEvm");
    if (!select || !toEvm) return;
    if (select.value === "__custom__") {
      toEvm.readOnly = false;
      toEvm.value = prefs.walletEvm && !select.querySelector(`option[value="${prefs.walletEvm}"]`)
        ? prefs.walletEvm
        : "";
    } else {
      toEvm.value = select.value;
      toEvm.readOnly = true;
      patchCreatePrefs({ walletEvm: select.value });
    }
    refresh();
  });

  // If registry has wallets, select first and fill
  const select = root.querySelector<HTMLSelectElement>("#wallet-picker-select");
  if (select && select.value && select.value !== "__custom__") {
    const toEvm = root.querySelector<HTMLInputElement>("#toEvm");
    if (toEvm && !toEvm.value) {
      toEvm.value = select.value;
      toEvm.readOnly = true;
    }
  }

  root.querySelector("#use-passkey-wallet")?.addEventListener("click", async () => {
    const btn = root.querySelector<HTMLButtonElement>("#use-passkey-wallet");
    const note = root.querySelector<HTMLElement>("#form-action-status");
    if (btn) btn.disabled = true;
    try {
      const existing = loadWalletSession();
      if (existing?.address) {
        applyPasskeyWalletToForm(existing.address);
        if (note) note.textContent = t("create.passkeyWalletFilled");
        return;
      }
      const { address } = await createCounterfactualWallet(t("create.passkeyWalletDeviceLabel"));
      applyPasskeyWalletToForm(address);
      if (note) note.textContent = t("create.passkeyWalletCreated");
    } catch (error) {
      if (note) {
        note.textContent = error instanceof Error ? error.message : t("create.passkeyWalletFailed");
        note.classList.add("danger");
      }
    } finally {
      if (btn) btn.disabled = false;
    }
  });

  root.querySelector("#clear-passkey-wallet")?.addEventListener("click", () => {
    const toEvmEl = root.querySelector<HTMLInputElement>("#toEvm");
    const chip = root.querySelector<HTMLElement>("#passkey-wallet-chip");
    const clearBtn = root.querySelector<HTMLElement>("#clear-passkey-wallet");
    const sel = root.querySelector<HTMLSelectElement>("#wallet-picker-select");
    if (toEvmEl) {
      toEvmEl.value = "";
      toEvmEl.readOnly = false;
    }
    if (sel) sel.value = "__custom__";
    if (chip) chip.hidden = true;
    clearBtn?.setAttribute("hidden", "");
    refresh();
  });
}

function bindAddressValidation(root: HTMLElement): void {
  for (const [id, kind] of [
    ["toEvm", "evm"],
    ["toTron", "tron"],
    ["toSolana", "solana"],
  ] as const) {
    const input = root.querySelector<HTMLInputElement>(`#${id}`);
    input?.addEventListener("blur", () => {
      markAddressField(root, id, kind);
      if (id === "toTron") patchCreatePrefs({ walletTron: input.value.trim() || undefined });
      if (id === "toSolana") patchCreatePrefs({ walletSolana: input.value.trim() || undefined });
      if (id === "toEvm" && !input.readOnly) patchCreatePrefs({ walletEvm: input.value.trim() || undefined });
    });
    input?.addEventListener("input", () => {
      if (input.value.trim()) markAddressField(root, id, kind);
      else clearAddressFieldError(root, id);
    });
  }
}

function bindFiatCascade(root: HTMLElement, refresh: () => void): void {
  const run = (field: FiatField) => {
    const mode = selectedPaymentMode(root);
    if (mode !== "fiat" && mode !== "crypto_or_fiat") return;
    const rule = ruleFor(field);
    const exec = async () => {
      for (const action of rule.actions) {
        if (action === "none") continue;
        if (action === "refetchMethods") await loadQuotePaymentMethods(root);
        if (action === "refetchProviders") await refreshFiatQuote(root);
        if (action === "reselectProvider") reselectProvider(root);
      }
      persistPrefs(root);
      refresh();
    };
    if (rule.debounceMs) {
      clearTimeout(fiatQuoteTimer);
      fiatQuoteTimer = setTimeout(() => void exec(), rule.debounceMs);
    } else {
      void exec();
    }
  };

  const map: Array<[string, FiatField]> = [
    ["displayFiat", "currency"],
    ["quoteCountry", "country"],
    ["quotePaymentMethod", "paymentMethod"],
    ["quoteProvider", "provider"],
    ["quoteSlippagePct", "drift"],
    ["price", "amount"],
  ];
  for (const [id, field] of map) {
    root.querySelector(`#${id}`)?.addEventListener("change", () => run(field));
    root.querySelector(`#${id}`)?.addEventListener("input", () => {
      if (field === "amount" || field === "country") run(field);
    });
  }
  root.querySelector("#chains")?.addEventListener("change", () => run("pairs"));
  root.querySelector("#tokens")?.addEventListener("change", () => run("pairs"));
}

function reselectProvider(root: HTMLElement): void {
  const providerSelect = root.querySelector<HTMLSelectElement>("#quoteProvider");
  const preview = root.querySelector<HTMLElement>("#fiat-charge-preview");
  if (!providerSelect || !preview) return;
  const activeProvider = providerSelect.value;
  const quotesRaw = root.dataset.quotedQuotes;
  if (!quotesRaw) return;
  try {
    const quotes = JSON.parse(quotesRaw) as Array<{
      provider: string;
      fiatAmount: string;
      cryptoAmount: string;
    }>;
    const active =
      quotes.find((q) => q.provider === activeProvider) ??
      quotes[0];
    if (!active) return;
    const settleToken = root.dataset.quotedToken ?? "USDC";
    const settleChain = root.dataset.quotedChainId ? ` · ${networkShort(root.dataset.quotedChainId)}` : "";
    preview.textContent =
      t("create.settlePreview", { amount: active.cryptoAmount, token: settleToken }) + settleChain;
    preview.hidden = false;
    root.dataset.quotedSettlement = active.cryptoAmount;
    root.dataset.quotedDisplayAmount = active.fiatAmount;
    root.dataset.quotedProvider = active.provider;
  } catch {
    /* ignore */
  }
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
    const prefs = loadCreatePrefs();
    if (body.enabled && body.fiats.length > 0) {
      const select = root.querySelector<HTMLSelectElement>("#displayFiat");
      if (select) {
        select.innerHTML = body.fiats
          .map((code) => `<option value="${escapeHtml(code)}">${escapeHtml(code)}</option>`)
          .join("");
        select.value = pickRemembered(body.fiats, prefs.displayFiat, body.fiats.includes("SEK") ? "SEK" : body.fiats[0]!);
      }
    }
    if (body.enabled) {
      const remembered = prefs.paymentMode;
      const target =
        remembered === "crypto" || remembered === "crypto_or_fiat" || remembered === "fiat"
          ? remembered
          : "crypto_or_fiat";
      const radio = root.querySelector<HTMLInputElement>(`input[name="paymentMode"][value="${target}"]`);
      if (radio) {
        for (const el of root.querySelectorAll<HTMLInputElement>('input[name="paymentMode"]')) {
          el.checked = el === radio;
        }
      }
    }
  } catch {
    field.hidden = true;
  }
}

async function loadQuotePaymentMethods(root: HTMLElement): Promise<void> {
  const mode = selectedPaymentMode(root);
  if (mode !== "fiat" && mode !== "crypto_or_fiat") return;
  const pairs = selectedOnrampPairs(root);
  const fiat = root.querySelector<HTMLSelectElement>("#displayFiat")?.value ?? "SEK";
  const country = root.querySelector<HTMLInputElement>("#quoteCountry")?.value.trim().toLowerCase() ?? "us";
  if (pairs.length === 0) return;
  const select = root.querySelector<HTMLSelectElement>("#quotePaymentMethod");
  if (!select) return;
  const prefs = loadCreatePrefs();
  try {
    const params = new URLSearchParams({ fiat, country, expand: "1" });
    params.set("pairs", pairs.map((p) => `${p.chainId}:${p.token}`).join(","));
    const res = await fetch(apiUrl(`/api/public/onramp-methods?${params}`));
    if (!res.ok) return;
    const body = (await res.json()) as { methods?: Array<{ id: string; name: string }> };
    const methods = body.methods ?? [];
    const ids = methods.map((m) => m.id);
    const remembered = pickRemembered(ids, prefs.quotePaymentMethod, AUTO_VALUE);
    select.innerHTML =
      `<option value="${AUTO_VALUE}">${escapeHtml(t("create.quoteMethodAuto"))}</option>` +
      methods
        .map((m) => `<option value="${escapeHtml(m.id)}">${escapeHtml(m.name)}</option>`)
        .join("");
    select.value = remembered;
  } catch {
    /* keep defaults */
  }
}

async function refreshFiatQuote(root: HTMLElement): Promise<void> {
  const mode = selectedPaymentMode(root);
  if (mode !== "fiat" && mode !== "crypto_or_fiat") return;
  const preview = root.querySelector<HTMLElement>("#fiat-charge-preview");
  const status = root.querySelector<HTMLElement>("#fiat-quote-status");
  const limits = root.querySelector<HTMLElement>("#amount-limits");
  const providerSelect = root.querySelector<HTMLSelectElement>("#quoteProvider");
  const pairs = selectedOnrampPairs(root);
  const fiatAmount = root.querySelector<HTMLInputElement>("#price")?.value.trim();
  const fiat = root.querySelector<HTMLSelectElement>("#displayFiat")?.value ?? "SEK";
  const country = root.querySelector<HTMLInputElement>("#quoteCountry")?.value.trim().toLowerCase() ?? "us";
  const paymentMethod = root.querySelector<HTMLSelectElement>("#quotePaymentMethod")?.value || undefined;
  const preferredProvider = providerSelect?.value.trim() || undefined;
  if (!preview || pairs.length === 0 || !fiatAmount) return;

  // For crypto_or_fiat, amount is USD settlement — quote direction=receive
  const direction = mode === "fiat" ? "pay" : "receive";
  if (status) status.textContent = t("create.quoteLoading");
  preview.hidden = true;
  if (limits) limits.hidden = true;
  try {
    const params = new URLSearchParams({
      fiat,
      country,
      direction,
      pairs: pairs.map((p) => `${p.chainId}:${p.token}`).join(","),
    });
    if (paymentMethod) params.set("paymentMethod", paymentMethod);
    if (preferredProvider) params.set("provider", preferredProvider);
    if (direction === "pay") params.set("fiatAmount", fiatAmount);
    else params.set("cryptoAmount", fiatAmount);
    const slippagePct = Number(fieldValue(root, "quoteSlippagePct") || "1");
    if (Number.isFinite(slippagePct) && slippagePct >= 0) {
      params.set("slippageBps", String(Math.round(slippagePct * 100)));
    }
    const res = await fetch(apiUrl(`/api/public/onramp-quote?${params}`));
    const body = (await res.json()) as OnrampQuoteResponse & {
      error?: string;
      code?: string;
      fiat?: string;
      minAmount?: number;
      maxAmount?: number;
      demo?: boolean;
    };
    if (!res.ok) {
      if (
        (body.code === "onramp_limit_mismatch" || body.minAmount != null || body.maxAmount != null) &&
        limits
      ) {
        limits.hidden = false;
        limits.textContent = t("create.amountLimits", {
          min: String(body.minAmount ?? "—"),
          max: String(body.maxAmount ?? "—"),
          fiat: body.fiat ?? fiat,
        });
      }
      const localized = localizeOnrampQuoteError(body);
      throw new Error(localized ?? body.error ?? t("create.quoteError"));
    }
    const settleToken = body.token ?? "USDC";
    const recommended = body.recommended ?? {
      provider: body.quotes?.[0]?.provider ?? "demo",
      paymentMethod: paymentMethod || "creditcard",
      fiatAmount: body.fiatAmount,
      cryptoAmount: body.cryptoAmount,
    };
    const prefs = loadCreatePrefs();
    if (providerSelect && body.quotes?.length) {
      const ids = body.quotes.map((q) => q.provider);
      const previous = pickRemembered(
        ids,
        preferredProvider || prefs.quoteProvider,
        AUTO_VALUE
      );
      providerSelect.innerHTML =
        `<option value="${AUTO_VALUE}">${escapeHtml(t("create.quoteProviderAuto"))}</option>` +
        body.quotes
          .map(
            (q) =>
              `<option value="${escapeHtml(q.provider)}">${escapeHtml(
                `${q.provider} · ${q.cryptoAmount} ${settleToken}`
              )}</option>`
          )
          .join("");
      providerSelect.value = previous === AUTO_VALUE ? AUTO_VALUE : previous;
      if (previous !== AUTO_VALUE && !ids.includes(previous)) {
        providerSelect.value = AUTO_VALUE;
      } else if (previous !== AUTO_VALUE) {
        providerSelect.value = previous;
      }
    }
    const activeProvider =
      (providerSelect?.value && providerSelect.value !== AUTO_VALUE
        ? providerSelect.value
        : recommended.provider) || recommended.provider;
    const active = body.quotes?.find((q) => q.provider === activeProvider) ?? recommended;
    const settleChain = body.chainId ? ` · ${networkShort(body.chainId)}` : "";
    preview.textContent =
      t("create.settlePreview", { amount: active.cryptoAmount, token: settleToken }) + settleChain;
    preview.hidden = false;
    if (status) status.textContent = body.demo ? "Demo quote (no live Onramper keys)" : "";
    root.dataset.quotedDisplayAmount = active.fiatAmount;
    root.dataset.quotedDisplayFiat = body.fiat;
    root.dataset.quotedSettlement = active.cryptoAmount;
    root.dataset.quotedProvider = active.provider ?? activeProvider;
    root.dataset.quotedQuotes = JSON.stringify(body.quotes ?? [active]);
    if (body.chainId) root.dataset.quotedChainId = body.chainId;
    if (body.token) root.dataset.quotedToken = body.token;
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
  const lockedHint = root.querySelector<HTMLElement>("#fiat-networks-locked-hint");
  if (networksLabel) {
    networksLabel.innerHTML =
      mode === "fiat"
        ? `${t("create.settlementNetworkLabel")} <span class="required">${t("common.required")}</span>`
        : `${t("create.networksLabel")} <span class="required">${t("common.required")}</span>`;
  }
  if (networksHint) {
    networksHint.textContent = mode === "fiat" ? t("create.settlementNetworkHint") : t("create.networksHint");
  }
  if (lockedHint) lockedHint.hidden = mode !== "fiat";

  const priceLabel = root.querySelector<HTMLElement>("#price-label");
  const priceHint = root.querySelector<HTMLElement>("#price-hint");
  const fiatQuoteField = root.querySelector<HTMLElement>("#fiat-quote-field");
  const allowPartial = root.querySelector<HTMLElement>("#allow-partial-field");
  if (priceLabel) {
    priceLabel.innerHTML =
      mode === "fiat"
        ? `${t("create.fiatPayLabel")} <span class="required">${t("common.required")}</span>`
        : `${t("create.amountLabel")} <span class="required">${t("common.required")}</span>`;
  }
  if (priceHint) {
    priceHint.textContent = mode === "fiat" ? t("create.fiatPayHint") : t("create.amountHint");
  }
  if (allowPartial) allowPartial.hidden = mode === "fiat";
  if (fiatQuoteField) {
    fiatQuoteField.hidden = mode === "crypto";
    if (mode !== "crypto") {
      void loadQuotePaymentMethods(root).then(() => void refreshFiatQuote(root));
    }
  }

  const chainInputs = [...root.querySelectorAll<HTMLInputElement>('input[name="chains"]')];
  if (mode === "fiat") {
    const minimum = new Set(
      fiatMinimumChainIds().filter((id) => chainInputs.some((el) => el.value === id && chainHasOnrampSupport(root, id)))
    );
    if (minimum.size === 0) {
      for (const el of chainInputs) {
        if (chainHasOnrampSupport(root, el.value)) minimum.add(el.value);
      }
    }
    for (const el of chainInputs) {
      const chainSupported = chainHasOnrampSupport(root, el.value);
      const locked = minimum.has(el.value);
      if (locked) {
        el.checked = true;
        el.disabled = true;
        el.dataset.fiatLocked = "1";
      } else {
        el.disabled = !chainSupported;
        delete el.dataset.fiatLocked;
        if (!chainSupported) el.checked = false;
      }
    }
  } else {
    for (const el of chainInputs) {
      el.disabled = false;
      delete el.dataset.fiatLocked;
    }
    if (chainInputs.every((el) => !el.checked) && chainInputs[0]) {
      chainInputs[0].checked = true;
    }
  }
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
    const link = `${location.origin}${payPath(fields)}`;
    window.open(link, "_blank", "noopener,noreferrer");
    if (note) note.textContent = t("create.openedCheckout");
    persistPrefs(root);
  } catch (error) {
    if (note) {
      note.textContent = error instanceof Error ? localizeError(error) : t("errors.fillRequired");
      note.classList.add("danger");
    }
  } finally {
    if (openBtn) openBtn.disabled = false;
  }
}
