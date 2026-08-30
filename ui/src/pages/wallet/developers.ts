import { t } from "../../i18n/t.js";
import { escapeHtml } from "../../shared/dom.js";
import { SITE } from "../../shared/site.js";
import {
  bindWalletAccountBar,
  bindWalletModeToggle,
  walletFrame,
} from "../../shared/wallet-ui.js";

/** Soft Developers entry for Advanced mode. */
export async function renderWalletDevelopers(root: HTMLElement): Promise<void> {
  root.innerHTML = walletFrame({
    current: "developers",
    title: t("wallet.developersTitle"),
    lede: t("wallet.developersLede"),
    body: `
      <ul class="wallet-dev-links">
        <li>
          <a href="${SITE.docsUrl}" target="_blank" rel="noopener noreferrer">${escapeHtml(t("wallet.developersDocs"))}</a>
          <p class="field-hint">${escapeHtml(t("wallet.developersDocsHint"))}</p>
        </li>
        <li>
          <a href="${SITE.docsUrl}wallet-client-api/" target="_blank" rel="noopener noreferrer">${escapeHtml(t("wallet.developersApi"))}</a>
          <p class="field-hint">${escapeHtml(t("wallet.developersApiHint"))}</p>
        </li>
        <li>
          <span class="cmp-chip cmp-chip-muted">${escapeHtml(t("wallet.comingBadge"))}</span>
          ${escapeHtml(t("wallet.developersKeysComing"))}
        </li>
      </ul>`,
  });
  bindWalletAccountBar(root);
  bindWalletModeToggle(root);
}
