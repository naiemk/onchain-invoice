import { escapeHtml } from "../../shared/dom.js";
import { LOCALES, LOCALE_NATIVE_NAMES } from "../../i18n/locales.js";
import { t } from "../../i18n/t.js";
import type { PaymentMode } from "../../shared/types.js";

function localeOptionsHtml(): string {
  return LOCALES.map(
    (locale) => `<option value="${locale}">${escapeHtml(LOCALE_NATIVE_NAMES[locale])}</option>`
  ).join("");
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

export function stepDetailsHtml(initialOrderId: string): string {
  return `
    <div class="wizard-step" data-step="1">
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
        <label for="callback">${t("create.callbackLabel")}</label>
        <p class="field-hint">${t("create.callbackHint")}</p>
        <input id="callback" name="callback" type="url" placeholder="https://shop.example/webhooks/trustless-commerce" />
      </div>

      <div class="field">
        <label for="lang">${t("create.langLabel")}</label>
        <p class="field-hint">${t("create.langHint")}</p>
        <select id="lang" name="lang">
          <option value="">${escapeHtml(t("create.langDefault"))}</option>
          ${localeOptionsHtml()}
        </select>
      </div>

      <div class="field" id="payment-mode-field" hidden>
        <label>${t("create.invoiceTypeLabel")}</label>
        <p class="field-hint">${t("create.invoiceTypeHint")}</p>
        <div class="choice-card-row" id="payment-mode" role="radiogroup" aria-label="${escapeHtml(t("create.paymentModeAria"))}">
          ${paymentModeCardHtml("crypto", true)}
          ${paymentModeCardHtml("crypto_or_fiat", false)}
          ${paymentModeCardHtml("fiat", false)}
        </div>
      </div>
    </div>`;
}
