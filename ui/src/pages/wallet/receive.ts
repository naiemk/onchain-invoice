import QRCode from "qrcode";
import { t } from "../../i18n/t.js";
import { escapeHtml } from "../../shared/dom.js";
import { currentSpaRender, isSpaRenderCurrent, spaNavigate } from "../../shared/spa-render.js";
import { loadWalletSession } from "../../shared/webauthn.js";
import {
  addressBox,
  bindCopyButtons,
  bindWalletAccountBar,
  walletFrame,
} from "../../shared/wallet-ui.js";

export async function renderWalletReceive(root: HTMLElement): Promise<void> {
  const gen = currentSpaRender();
  const session = loadWalletSession();
  if (!session) {
    spaNavigate("/wallet", "replace");
    return;
  }

  root.innerHTML = walletFrame({
    current: "receive",
    title: t("wallet.receiveTitle"),
    lede: t("wallet.receiveLede"),
    body: `
      <div class="wallet-receive">
        <div id="wallet-receive-qr" class="wallet-receive-qr-slot" aria-busy="true"></div>
        <p class="eyebrow">${escapeHtml(t("wallet.yourAddress"))}</p>
        ${addressBox(session.address, "wallet-receive-address")}
        <p class="field-hint">${escapeHtml(t("wallet.receiveSameAddress"))}</p>
      </div>`,
  });
  bindWalletAccountBar(root);
  bindCopyButtons(root);

  let qrDataUrl = "";
  try {
    qrDataUrl = await QRCode.toDataURL(session.address, {
      margin: 2,
      width: 240,
      color: { dark: "#0a2540", light: "#ffffff" },
    });
  } catch {
    qrDataUrl = "";
  }
  if (!isSpaRenderCurrent(gen)) return;
  const slot = root.querySelector("#wallet-receive-qr");
  if (slot && qrDataUrl) {
    slot.removeAttribute("aria-busy");
    slot.innerHTML = `<img class="wallet-qr-img wallet-receive-qr" src="${qrDataUrl}" alt="${escapeHtml(t("wallet.receiveQrAlt"))}" width="240" height="240" />`;
  } else {
    slot?.remove();
  }
}
