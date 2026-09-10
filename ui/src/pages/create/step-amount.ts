import { escapeHtml } from "../../shared/dom.js";
import { t } from "../../i18n/t.js";
import { countryDatalistHtml } from "./country.js";
import { loadCreatePrefs } from "./prefs.js";

export function stepAmountHtml(): string {
  const prefs = loadCreatePrefs();
  const country = prefs.quoteCountry || "se";
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
      </div>
    </div>`;
}
