import { t } from "../../i18n/t.js";
import { createAnotherIdentityWallet } from "../../shared/wallet-create.js";
import { fetchIdentityMe } from "../../shared/identity-api.js";
import {
  addressBox,
  bindCopyButtons,
  bindWalletAccountBar,
  setButtonLoading,
  showStatus,
  walletFrame,
} from "../../shared/wallet-ui.js";
import { escapeHtml } from "../../shared/dom.js";

export async function renderWalletCreate(root: HTMLElement): Promise<void> {
  const me = await fetchIdentityMe();
  if (me && me.methods.webauthn < 1) {
    root.innerHTML = walletFrame({
      current: "create",
      title: t("wallet.createPageTitle"),
      lede: t("wallet.createPageLede"),
      body: `<p class="status error" role="status">${escapeHtml(t("wallet.createNeedPasskey"))}</p>`,
    });
    return;
  }

  root.innerHTML = walletFrame({
    current: "create",
    title: t("wallet.createPageTitle"),
    lede: t("wallet.createPageLede"),
    body: `
      <div class="field">
        <label for="device-name">${escapeHtml(t("wallet.walletName"))}</label>
        <p class="field-hint">${escapeHtml(t("wallet.walletNameHint"))}</p>
        <input id="device-name" type="text" placeholder="${escapeHtml(t("wallet.walletNamePlaceholder"))}" />
      </div>
      <div class="cta-row">
        <button type="button" class="tc-btn" id="wallet-create-btn">${escapeHtml(t("wallet.createWallet"))}</button>
        <a class="tc-btn secondary" href="/wallet" data-route>${escapeHtml(t("wallet.cancel"))}</a>
      </div>
      <div id="wallet-create-result" class="hidden"></div>
      <p id="wallet-create-status" class="status wallet-status" role="status"></p>`,
  });
  bindWalletAccountBar(root);

  root.querySelector("#wallet-create-btn")?.addEventListener("click", () => void runCreate(root));
}

async function runCreate(root: HTMLElement): Promise<void> {
  const status = root.querySelector<HTMLElement>("#wallet-create-status");
  const resultBox = root.querySelector<HTMLElement>("#wallet-create-result");
  const btn = root.querySelector<HTMLButtonElement>("#wallet-create-btn");
  const nameInput = root.querySelector<HTMLInputElement>("#device-name");
  const label = nameInput?.value.trim() || t("wallet.defaultWalletName");
  if (!status) return;

  try {
    setButtonLoading(btn, true, t("wallet.creatingWallet"));
    status.textContent = t("wallet.creatingWallet");
    const { address } = await createAnotherIdentityWallet(label);
    showStatus(status, t("wallet.createdCounterfactual"), "success");
    if (resultBox) {
      resultBox.classList.remove("hidden");
      resultBox.innerHTML = `
        <h2>${escapeHtml(t("wallet.yourAddress"))}</h2>
        ${addressBox(address, "created-address")}
        <div class="cta-row">
          <a class="tc-btn" href="/wallet" data-route>${escapeHtml(t("wallet.goToWallet"))}</a>
        </div>`;
      bindCopyButtons(resultBox);
    }
    window.history.replaceState({}, "", "/wallet");
    window.dispatchEvent(new PopStateEvent("popstate"));
  } catch (error) {
    showStatus(status, error instanceof Error ? error.message : String(error), "error");
  } finally {
    setButtonLoading(btn, false);
  }
}
