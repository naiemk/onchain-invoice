import { escapeHtml } from "../shared/dom.js";
import { t } from "../i18n/t.js";
import { saveWalletMode } from "../shared/wallet-mode.js";
import { spaNavigate } from "../shared/spa-render.js";

/** Marketing hub: create invoice + merchant list + receive wallet. */
export function renderGetPaid(root: HTMLElement): void {
  root.innerHTML = `
    <header class="page-header">
      <p class="eyebrow">${escapeHtml(t("getPaid.eyebrow"))}</p>
      <h1>${escapeHtml(t("getPaid.title"))}</h1>
      <p class="lede">${escapeHtml(t("getPaid.lede"))}</p>
    </header>

    <section class="panel get-paid-hub">
      <div class="get-paid-grid">
        <a class="get-paid-tile" href="/create" data-route>
          <h2>${escapeHtml(t("getPaid.createTitle"))}</h2>
          <p>${escapeHtml(t("getPaid.createBody"))}</p>
          <span class="get-paid-tile-cta">${escapeHtml(t("getPaid.createCta"))}</span>
        </a>
        <a class="get-paid-tile" href="/merchant" data-route>
          <h2>${escapeHtml(t("getPaid.listTitle"))}</h2>
          <p>${escapeHtml(t("getPaid.listBody"))}</p>
          <span class="get-paid-tile-cta">${escapeHtml(t("getPaid.listCta"))}</span>
        </a>
        <a class="get-paid-tile" href="/wallet/receive" data-route>
          <h2>${escapeHtml(t("getPaid.receiveTitle"))}</h2>
          <p>${escapeHtml(t("getPaid.receiveBody"))}</p>
          <span class="get-paid-tile-cta">${escapeHtml(t("getPaid.receiveCta"))}</span>
        </a>
      </div>
      <p class="field-hint get-paid-advanced-hint">
        ${escapeHtml(t("getPaid.advancedHint"))}
        <button type="button" class="linkish" id="get-paid-advanced">${escapeHtml(t("getPaid.switchAdvanced"))}</button>
      </p>
    </section>`;

  root.querySelector("#get-paid-advanced")?.addEventListener("click", () => {
    saveWalletMode("advanced");
    spaNavigate("/merchant");
  });
}
