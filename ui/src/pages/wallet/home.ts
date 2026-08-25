import { t } from "../../i18n/t.js";
import { fetchWalletBalance } from "../../shared/wallet-api.js";
import {
  authenticatePasskey,
  clearWalletSession,
  loadWalletSession,
} from "../../shared/webauthn.js";
import {
  addressBox,
  bindCopyButtons,
  chainBalanceRows,
  showStatus,
  walletSubnav,
} from "../../shared/wallet-ui.js";

export async function renderWalletHome(root: HTMLElement): Promise<void> {
  const session = loadWalletSession();
  let balanceHtml = "";
  if (session) {
    try {
      const balance = await fetchWalletBalance(session.address);
      balanceHtml = `
        <div class="wallet-dashboard-balance">
          <p class="eyebrow">${escapeHtml(t("wallet.totalBalance"))}</p>
          <p class="wallet-balance-total">${escapeHtml(balance.totalUsd)} ${escapeHtml(t("wallet.usd"))}</p>
        </div>
        <section class="wallet-chain-breakdown">
          <h2>${escapeHtml(t("wallet.byChain"))}</h2>
          ${chainBalanceRows(balance.chains)}
        </section>`;
    } catch {
      balanceHtml = `<p class="field-hint">${escapeHtml(t("wallet.balanceUnavailable"))}</p>`;
    }
  }

  root.innerHTML = `
    <header class="page-header wallet-page-header">
      <p class="eyebrow">${escapeHtml(t("wallet.eyebrow"))}</p>
      <h1>${escapeHtml(t("wallet.homeTitle"))}</h1>
      <p class="lede">${escapeHtml(t("wallet.homeLede"))}</p>
    </header>
    <section class="panel wallet-panel">
      ${session ? walletSubnav("home") : ""}
      ${
        session
          ? `<div class="wallet-session-card">
              <p><strong>${escapeHtml(session.label)}</strong></p>
              ${addressBox(session.address)}
              ${balanceHtml}
              <div class="cta-row wallet-actions">
                <a class="tc-btn" href="/wallet/send" data-route>${escapeHtml(t("wallet.sendTitle"))}</a>
                <a class="tc-btn secondary" href="/wallet/security" data-route>${escapeHtml(t("wallet.securityTab"))}</a>
                <a class="tc-btn secondary" href="/wallet/pair" data-route>${escapeHtml(t("wallet.pairDevice"))}</a>
                <button type="button" class="tc-btn secondary" id="wallet-signout">${escapeHtml(t("wallet.signOut"))}</button>
              </div>
            </div>`
          : `<div class="choice-card-row wallet-choice-row">
              <a class="choice-card" href="/wallet/create" data-route>
                <span class="choice-card-face">
                  <span class="choice-card-title">${escapeHtml(t("wallet.create"))}</span>
                  <span class="choice-card-hint">${escapeHtml(t("wallet.createCardHint"))}</span>
                </span>
              </a>
              <button type="button" class="choice-card" id="wallet-login">
                <span class="choice-card-face">
                  <span class="choice-card-title">${escapeHtml(t("wallet.signIn"))}</span>
                  <span class="choice-card-hint">${escapeHtml(t("wallet.signInCardHint"))}</span>
                </span>
              </button>
              <a class="choice-card" href="/wallet/pair" data-route>
                <span class="choice-card-face">
                  <span class="choice-card-title">${escapeHtml(t("wallet.pairDevice"))}</span>
                  <span class="choice-card-hint">${escapeHtml(t("wallet.pairCardHint"))}</span>
                </span>
              </a>
            </div>`
      }
      <p class="field-hint wallet-sync-hint">${escapeHtml(t("wallet.syncHint"))}</p>
      <p id="wallet-home-status" class="status wallet-status" role="status" hidden></p>
    </section>`;

  bindCopyButtons(root);
  root.querySelector("#wallet-signout")?.addEventListener("click", () => {
    clearWalletSession();
    void renderWalletHome(root);
  });
  root.querySelector("#wallet-login")?.addEventListener("click", async () => {
    const status = root.querySelector<HTMLElement>("#wallet-home-status");
    status?.removeAttribute("hidden");
    const ok = await authenticatePasskey();
    if (!ok) {
      showStatus(status, t("wallet.signInFailed"), "error");
      return;
    }
    location.href = "/wallet";
  });
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
