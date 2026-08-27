import { t } from "../../i18n/t.js";
import { escapeHtml } from "../../shared/dom.js";
import { apiUrl } from "../../shared/site.js";
import {
  currentUiTheme,
  FIAT_LABELS,
  mountOnramperIframe,
  onramperSkeletonHtml,
} from "../../shared/onramper-iframe.js";
import { currentSpaRender, isSpaRenderCurrent, spaNavigate } from "../../shared/spa-render.js";
import { loadWalletSession } from "../../shared/webauthn.js";
import {
  createWalletOfframpSession,
  fetchWalletBalance,
} from "../../shared/wallet-api.js";
import {
  bindWalletAccountBar,
  showStatus,
  walletFrame,
  walletLoadingFrame,
} from "../../shared/wallet-ui.js";

export async function renderWalletWithdraw(root: HTMLElement): Promise<void> {
  const gen = currentSpaRender();
  const session = loadWalletSession();
  if (!session) {
    spaNavigate("/wallet", "replace");
    return;
  }

  root.innerHTML = walletLoadingFrame("send", t("wallet.withdrawTitle"));
  bindWalletAccountBar(root);

  let fiats = ["USD", "EUR", "GBP", "SEK"];
  let sandbox = false;
  let enabled = true;
  try {
    const res = await fetch(apiUrl("/api/public/onramp"));
    if (res.ok) {
      const body = (await res.json()) as { enabled?: boolean; fiats?: string[]; sandbox?: boolean };
      enabled = Boolean(body.enabled);
      if (body.fiats?.length) fiats = body.fiats;
      sandbox = Boolean(body.sandbox);
    }
  } catch {
    /* defaults */
  }

  let maxAvailable = "0.00";
  try {
    const balance = await fetchWalletBalance(session.address);
    maxAvailable = balance.totalUsd;
  } catch {
    /* ignore */
  }
  if (!isSpaRenderCurrent(gen)) return;

  if (!enabled) {
    root.innerHTML = walletFrame({
      current: "send",
      title: t("wallet.withdrawTitle"),
      lede: t("wallet.withdrawLede"),
      body: `<p class="danger">${escapeHtml(t("wallet.withdrawUnavailable"))}</p>
        <p><a href="/wallet/send" data-route>${escapeHtml(t("wallet.withdrawBackSend"))}</a></p>`,
    });
    bindWalletAccountBar(root);
    return;
  }

  const defaultFiat = fiats[0] ?? "USD";
  root.innerHTML = walletFrame({
    current: "send",
    title: t("wallet.withdrawTitle"),
    lede: t("wallet.withdrawLede"),
    body: `
      <p class="wallet-balance-total">${escapeHtml(
        t("wallet.sendAvailable", { amount: maxAvailable, symbol: t("wallet.usd") })
      )}</p>
      <div class="field">
        <label for="wallet-withdraw-fiat">${escapeHtml(t("wallet.withdrawFiatLabel"))}</label>
        <select id="wallet-withdraw-fiat">${fiats
          .map(
            (code) =>
              `<option value="${escapeHtml(code)}" ${code === defaultFiat ? "selected" : ""}>${escapeHtml(
                `${code} · ${FIAT_LABELS[code] ?? code}`
              )}</option>`
          )
          .join("")}</select>
      </div>
      <div class="btn-row">
        <button type="button" class="tc-btn" id="wallet-withdraw-start">${escapeHtml(t("wallet.withdrawContinue"))}</button>
      </div>
      <p class="field-hint">${escapeHtml(t("wallet.withdrawHint"))}</p>
      ${sandbox ? `<p class="callout info">${escapeHtml(t("wallet.withdrawSandboxNote"))}</p>` : ""}
      <div id="wallet-withdraw-frame" class="onramp-frame-host" hidden></div>
      <p id="wallet-withdraw-status" class="status wallet-status" role="status"></p>`,
  });
  bindWalletAccountBar(root);

  root.querySelector("#wallet-withdraw-start")?.addEventListener("click", () => {
    void startWithdraw(root, session.address, maxAvailable);
  });
}

async function startWithdraw(
  root: HTMLElement,
  walletAddress: string,
  maxAvailableCrypto: string
): Promise<void> {
  const fiat =
    root.querySelector<HTMLSelectElement>("#wallet-withdraw-fiat")?.value.trim().toUpperCase() ?? "USD";
  const host = root.querySelector<HTMLElement>("#wallet-withdraw-frame");
  const status = root.querySelector<HTMLElement>("#wallet-withdraw-status");
  const btn = root.querySelector<HTMLButtonElement>("#wallet-withdraw-start");
  if (!host) return;

  if (btn) btn.disabled = true;
  host.hidden = false;
  host.innerHTML = onramperSkeletonHtml(t("wallet.withdrawLoading"));
  if (status) showStatus(status, "");

  try {
    const session = await createWalletOfframpSession({
      walletAddress,
      fiat,
      theme: currentUiTheme(),
      maxAvailableCrypto,
    });
    await mountOnramperIframe(host, session.widgetUrl, t("wallet.withdrawIframeTitle"));
  } catch (error) {
    host.hidden = true;
    if (status) {
      showStatus(status, error instanceof Error ? error.message : t("wallet.withdrawFailed"), "error");
    }
  } finally {
    if (btn) btn.disabled = false;
  }
}
