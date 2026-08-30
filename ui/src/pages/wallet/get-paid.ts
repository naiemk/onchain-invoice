import { t } from "../../i18n/t.js";
import { escapeHtml } from "../../shared/dom.js";
import {
  bindWalletAccountBar,
  bindWalletModeToggle,
  walletFrame,
} from "../../shared/wallet-ui.js";

/** In-wallet Get paid shortcuts (invoice + receive). */
export async function renderWalletGetPaid(root: HTMLElement): Promise<void> {
  root.innerHTML = walletFrame({
    current: "getPaid",
    title: t("wallet.getPaidTitle"),
    lede: t("wallet.getPaidLede"),
    body: `
      <div class="wallet-cash-hub">
        <a class="wallet-cash-tile" href="/create" data-route>
          <h2>${escapeHtml(t("wallet.getPaidInvoiceTitle"))}</h2>
          <p>${escapeHtml(t("wallet.getPaidInvoiceBody"))}</p>
          <span class="tc-btn">${escapeHtml(t("wallet.getPaidInvoiceCta"))}</span>
        </a>
        <a class="wallet-cash-tile" href="/wallet/receive" data-route>
          <h2>${escapeHtml(t("wallet.getPaidReceiveTitle"))}</h2>
          <p>${escapeHtml(t("wallet.getPaidReceiveBody"))}</p>
          <span class="tc-btn secondary">${escapeHtml(t("wallet.getPaidReceiveCta"))}</span>
        </a>
      </div>`,
  });
  bindWalletAccountBar(root);
  bindWalletModeToggle(root);
}
