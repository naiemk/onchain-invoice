import { t } from "../../i18n/t.js";
import { escapeHtml } from "../../shared/dom.js";
import {
  bindWalletAccountBar,
  bindWalletModeToggle,
  walletFrame,
} from "../../shared/wallet-ui.js";

/** Combined on-ramp / off-ramp hub for Simple mode. */
export async function renderWalletCash(root: HTMLElement): Promise<void> {
  root.innerHTML = walletFrame({
    current: "cash",
    title: t("wallet.cashTitle"),
    lede: t("wallet.cashLede"),
    body: `
      <div class="wallet-cash-hub">
        <a class="wallet-cash-tile" href="/wallet/deposit" data-route>
          <h2>${escapeHtml(t("wallet.cashInTitle"))}</h2>
          <p>${escapeHtml(t("wallet.cashInBody"))}</p>
          <span class="tc-btn">${escapeHtml(t("wallet.depositCta"))}</span>
        </a>
        <a class="wallet-cash-tile" href="/wallet/withdraw" data-route>
          <h2>${escapeHtml(t("wallet.cashOutTitle"))}</h2>
          <p>${escapeHtml(t("wallet.cashOutBody"))}</p>
          <span class="tc-btn secondary">${escapeHtml(t("wallet.withdrawCta"))}</span>
        </a>
      </div>
      <p class="field-hint">${escapeHtml(t("wallet.cashHint"))}</p>`,
  });
  bindWalletAccountBar(root);
  bindWalletModeToggle(root);
}
