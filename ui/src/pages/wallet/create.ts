import { t } from "../../i18n/t.js";
import { createCounterfactualWallet } from "../../shared/wallet-create.js";
import { webAuthnSupported } from "../../shared/webauthn.js";
import {
  addressBox,
  bindCopyButtons,
  setButtonLoading,
  showStatus,
  walletSubnav,
} from "../../shared/wallet-ui.js";

export async function renderWalletCreate(root: HTMLElement): Promise<void> {
  root.innerHTML = `
    <header class="page-header wallet-page-header">
      <p class="eyebrow">${escapeHtml(t("wallet.eyebrow"))}</p>
      <h1>${escapeHtml(t("wallet.createTitle"))}</h1>
      <p class="lede">${escapeHtml(t("wallet.createLede"))}</p>
    </header>
    <section class="panel wallet-panel">
      ${walletSubnav("create")}
      <div class="callout info" role="note">${escapeHtml(t("wallet.counterfactualCallout"))}</div>
      <div class="field">
        <label for="device-name">${escapeHtml(t("wallet.deviceName"))}</label>
        <p class="field-hint">${escapeHtml(t("wallet.deviceNameHint"))}</p>
        <input id="device-name" type="text" placeholder="${escapeHtml(t("wallet.deviceNamePlaceholder"))}" />
      </div>
      <p class="field-hint">${webAuthnSupported() ? escapeHtml(t("wallet.webauthnOk")) : escapeHtml(t("wallet.webauthnNo"))}</p>
      <div class="cta-row">
        <button type="button" class="tc-btn" id="wallet-create-btn">${escapeHtml(t("wallet.createPasskey"))}</button>
        <a class="tc-btn secondary" href="/wallet" data-route>${escapeHtml(t("wallet.cancel"))}</a>
      </div>
      <div id="wallet-create-result" class="hidden"></div>
      <p id="wallet-create-status" class="status wallet-status" role="status"></p>
    </section>`;

  root.querySelector("#wallet-create-btn")?.addEventListener("click", () => void runCreate(root));
}

async function runCreate(root: HTMLElement): Promise<void> {
  const status = root.querySelector<HTMLElement>("#wallet-create-status");
  const resultBox = root.querySelector<HTMLElement>("#wallet-create-result");
  const btn = root.querySelector<HTMLButtonElement>("#wallet-create-btn");
  const nameInput = root.querySelector<HTMLInputElement>("#device-name");
  const label = nameInput?.value.trim() || t("wallet.defaultDevice");
  if (!status) return;

  try {
    setButtonLoading(btn, true, t("wallet.creatingPasskey"));
    status.textContent = t("wallet.creatingPasskey");
    const { address } = await createCounterfactualWallet(label);
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
  } catch (error) {
    showStatus(status, error instanceof Error ? error.message : String(error), "error");
  } finally {
    setButtonLoading(btn, false);
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
