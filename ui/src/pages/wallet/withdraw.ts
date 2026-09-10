import { t } from "../../i18n/t.js";
import { escapeHtml } from "../../shared/dom.js";
import { currentSpaRender, isSpaRenderCurrent, spaNavigate } from "../../shared/spa-render.js";
import { loadWalletSession } from "../../shared/webauthn.js";
import { paintWalletLoading, paintWalletPage, type WalletRenderOptions } from "../../shared/wallet-ui.js";

export async function renderWalletWithdraw(root: HTMLElement, opts?: WalletRenderOptions): Promise<void> {
  const gen = currentSpaRender();
  const session = loadWalletSession();
  if (!session) {
    spaNavigate("/wallet", "replace");
    return;
  }

  paintWalletLoading(root, "send", t("wallet.withdrawTitle"), undefined, opts);
  if (!isSpaRenderCurrent(gen)) return;

  paintWalletPage(
    root,
    {
      current: "send",
      title: t("wallet.withdrawTitle"),
      lede: t("wallet.withdrawLede"),
      body: `<p class="danger">${escapeHtml(t("wallet.withdrawUnavailable"))}</p>
        <p><a href="/wallet/send" data-route>${escapeHtml(t("wallet.withdrawBackSend"))}</a></p>`,
    },
    opts
  );
}
