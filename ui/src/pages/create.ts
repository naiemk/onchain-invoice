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
import type { PayLinkFields } from "../shared/types.js";

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
            <label for="price">${t("create.amountLabel")} <span class="required">${t("common.required")}</span></label>
            <p class="field-hint">${t("create.amountHint")}</p>
            <input id="price" name="price" required inputmode="decimal" placeholder="128.00" value="10.00" />
          </div>

          <div class="field">
            <label>${t("create.networksLabel")} <span class="required">${t("common.required")}</span></label>
            <p class="field-hint">${t("create.networksHint")}</p>
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
  "allowPartial": false
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
  const tokens = tokensForChains(chains);
  const needsTron = chains.some((id) => networkKind(id) === "tron");
  if (tokens.length === 0) {
    host.innerHTML = `<p class="field-hint">${t("create.selectNetworkForTokens")}</p>`;
    return;
  }
  host.innerHTML = tokens
    .map((token) => {
      const locked = needsTron && token.id === "USDT";
      const selected = locked || (previous.size > 0 ? previous.has(token.id) : true);
      return `
        <label class="check">
          <input type="checkbox" name="tokens" value="${escapeHtml(token.id)}"
            ${selected ? "checked" : ""} ${locked ? "disabled" : ""} />
          ${escapeHtml(token.label)}${locked ? ` · ${t("create.usdtRequiredForTron")}` : ""}
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
