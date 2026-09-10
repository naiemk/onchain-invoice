import { t } from "../../i18n/t.js";
import { escapeHtml } from "../../shared/dom.js";
import { currentSpaRender, isSpaRenderCurrent, spaNavigate } from "../../shared/spa-render.js";
import { loadWalletSession } from "../../shared/webauthn.js";
import { mountOnrampFlow } from "../../onramp/mountOnrampFlow.js";
import {
  paintWalletLoading,
  paintWalletPage,
  type WalletRenderOptions,
} from "../../shared/wallet-ui.js";

export async function renderWalletDeposit(root: HTMLElement, opts?: WalletRenderOptions): Promise<void> {
  const gen = currentSpaRender();
  const session = loadWalletSession();
  if (!session) {
    spaNavigate("/wallet", "replace");
    return;
  }

  paintWalletLoading(root, "cash", t("wallet.depositTitle"), undefined, opts);
  if (!isSpaRenderCurrent(gen)) return;

  paintWalletPage(
    root,
    {
      current: "cash",
      title: t("wallet.depositTitle"),
      lede: t("wallet.depositLede"),
      body: `<div id="wallet-deposit-onramp"></div>`,
    },
    opts,
    (r) => {
      const host = r.querySelector<HTMLElement>("#wallet-deposit-onramp");
      if (host) mountOnrampFlow(host, { lockedAddress: session.address });
    }
  );
}
