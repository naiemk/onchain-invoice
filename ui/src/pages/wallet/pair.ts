import { t } from "../../i18n/t.js";
import type { WalletRenderOptions } from "../../shared/wallet-ui.js";

/** React `/wallet/pair` owns this flow (`PairPage`). Kept so vanilla `renderWallet` still compiles. */
export async function renderWalletPair(root: HTMLElement, _opts?: WalletRenderOptions): Promise<void> {
  root.innerHTML = `<p class="status">${t("wallet.pairPageLede")}</p>`;
}

export async function stopPairScanner(): Promise<void> {
  /* new-device flow has no camera */
}
