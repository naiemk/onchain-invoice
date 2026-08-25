import { escapeHtml } from "../../shared/dom.js";
import { t } from "../../i18n/t.js";
import { countryDatalistHtml } from "./country.js";
import { AUTO_VALUE } from "./fiat-rules.js";
import { loadCreatePrefs } from "./prefs.js";

export function stepAmountHtml(): string {
  const prefs = loadCreatePrefs();
  const country = prefs.quoteCountry || "se";
  const slippage = prefs.quoteSlippagePct || "1";
  return `
    <div class="wizard-step" data-step="3" hidden>
      <div class="field">
        <label for="price" id="price-label">${t("create.amountLabel")} <span class="required">${t("common.required")}</span></label>
        <p class="field-hint" id="price-hint">${t("create.amountHint")}</p>
        <input id="price" name="price" required inputmode="decimal" placeholder="10.00" value="10.00" />
        <p class="field-hint" id="amount-limits" hidden></p>
      </div>

      <div class="field" id="allow-partial-field">
        <label class="check">
          <input type="checkbox" id="allowPartial" name="allowPartial" />
          ${t("create.allowPartial")}
        </label>
        <p class="field-hint">${t("create.allowPartialHint")}</p>
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
        <p class="field-hint">${t("create.countrySearchHint")}</p>
        <input id="quoteCountry" name="quoteCountry" class="mono" list="quote-country-list" value="${escapeHtml(country)}" maxlength="2" autocomplete="off" />
        ${countryDatalistHtml("quote-country-list")}

        <label for="quotePaymentMethod" style="margin-top:0.75rem;display:block">${t("create.quoteMethodLabel")}</label>
        <select id="quotePaymentMethod" name="quotePaymentMethod">
          <option value="${AUTO_VALUE}">${escapeHtml(t("create.quoteMethodAuto"))}</option>
        </select>

        <label for="quoteProvider" style="margin-top:0.75rem;display:block">${t("create.quoteProviderLabel")}</label>
        <select id="quoteProvider" name="quoteProvider">
          <option value="${AUTO_VALUE}">${escapeHtml(t("create.quoteProviderAuto"))}</option>
        </select>

        <label for="quoteSlippagePct" style="margin-top:0.75rem;display:block">${t("create.quoteSlippageLabel")}</label>
        <p class="field-hint">${t("create.quoteSlippageHint")}</p>
        <input id="quoteSlippagePct" name="quoteSlippagePct" inputmode="decimal" value="${escapeHtml(slippage)}" placeholder="1" />

        <p class="callout info" id="fiat-charge-preview" hidden></p>
        <p class="field-hint" id="fiat-quote-status"></p>
      </div>
    </div>`;
}
