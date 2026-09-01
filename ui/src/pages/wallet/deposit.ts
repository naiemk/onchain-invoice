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
import { createWalletOnrampSession } from "../../shared/wallet-api.js";
import {
  paintWalletLoading,
  paintWalletPage,
  showStatus,
  type WalletRenderOptions,
} from "../../shared/wallet-ui.js";

export async function renderWalletDeposit(root: HTMLElement, opts?: WalletRenderOptions): Promise<void> {
  const gen = currentSpaRender();
  const session = loadWalletSession();
  if (!session) {
    spaNavigate("/wallet", "replace");
    return;
  }

  paintWalletLoading(root, "receive", t("wallet.depositTitle"), undefined, opts);

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
  if (!isSpaRenderCurrent(gen)) return;

  if (!enabled) {
    paintWalletPage(
      root,
      {
        current: "receive",
        title: t("wallet.depositTitle"),
        lede: t("wallet.depositLede"),
        body: `<p class="danger">${escapeHtml(t("wallet.depositUnavailable"))}</p>
        <p><a href="/wallet/receive" data-route>${escapeHtml(t("wallet.depositBackReceive"))}</a></p>`,
      },
      opts
    );
    return;
  }

  const defaultFiat = fiats[0] ?? "USD";
  paintWalletPage(
    root,
    {
      current: "receive",
      title: t("wallet.depositTitle"),
      lede: t("wallet.depositLede"),
      body: `
      <div class="field">
        <label for="wallet-deposit-fiat">${escapeHtml(t("wallet.depositFiatLabel"))}</label>
        <select id="wallet-deposit-fiat">${fiats
          .map(
            (code) =>
              `<option value="${escapeHtml(code)}" ${code === defaultFiat ? "selected" : ""}>${escapeHtml(
                `${code} · ${FIAT_LABELS[code] ?? code}`
              )}</option>`
          )
          .join("")}</select>
      </div>
      <div class="btn-row">
        <button type="button" class="tc-btn" id="wallet-deposit-start">${escapeHtml(t("wallet.depositContinue"))}</button>
      </div>
      <p class="field-hint">${escapeHtml(t("wallet.depositHint"))}</p>
      ${sandbox ? `<p class="callout info">${escapeHtml(t("wallet.depositSandboxNote"))}</p>` : ""}
      <div id="wallet-deposit-frame" class="onramp-frame-host" hidden></div>
      <p id="wallet-deposit-status" class="status wallet-status" role="status"></p>`,
    },
    opts,
    (r) => {
      r.querySelector("#wallet-deposit-start")?.addEventListener("click", () => {
        void startDeposit(r, session.address);
      });
    }
  );
}

async function startDeposit(root: HTMLElement, walletAddress: string): Promise<void> {
  const fiat =
    root.querySelector<HTMLSelectElement>("#wallet-deposit-fiat")?.value.trim().toUpperCase() ?? "USD";
  const host = root.querySelector<HTMLElement>("#wallet-deposit-frame");
  const status = root.querySelector<HTMLElement>("#wallet-deposit-status");
  const btn = root.querySelector<HTMLButtonElement>("#wallet-deposit-start");
  if (!host) return;

  if (btn) btn.disabled = true;
  host.hidden = false;
  host.innerHTML = onramperSkeletonHtml(t("wallet.depositLoading"));
  if (status) showStatus(status, "");

  try {
    const session = await createWalletOnrampSession({
      walletAddress,
      fiat,
      theme: currentUiTheme(),
    });
    await mountOnramperIframe(host, session.widgetUrl, t("wallet.depositIframeTitle"));
  } catch (error) {
    host.hidden = true;
    if (status) {
      showStatus(status, error instanceof Error ? error.message : t("wallet.depositFailed"), "error");
    }
  } finally {
    if (btn) btn.disabled = false;
  }
}
