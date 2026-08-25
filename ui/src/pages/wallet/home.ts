import { t } from "../../i18n/t.js";
import { escapeHtml } from "../../shared/dom.js";
import { fetchWalletBalance } from "../../shared/wallet-api.js";
import { currentSpaRender, isSpaRenderCurrent, spaNavigate } from "../../shared/spa-render.js";
import {
  listWalletRegistry,
  loadWalletSession,
  setActiveWallet,
  webAuthnSupported,
} from "../../shared/webauthn.js";
import { unlockWalletWithPasskey } from "../../shared/wallet-unlock.js";
import {
  bindCopyButtons,
  bindWalletAccountBar,
  chainBalanceRows,
  showStatus,
  walletAccountBarHtml,
  walletPickerCard,
  walletSubnav,
} from "../../shared/wallet-ui.js";

export async function renderWalletHome(root: HTMLElement): Promise<void> {
  const session = loadWalletSession();
  const registry = listWalletRegistry();

  if (session) {
    await renderDashboard(root, session, registry);
    return;
  }

  if (registry.length > 0) {
    await renderPicker(root, registry);
    return;
  }

  renderEmpty(root);
}

async function renderDashboard(
  root: HTMLElement,
  session: NonNullable<ReturnType<typeof loadWalletSession>>,
  registry: ReturnType<typeof listWalletRegistry>
): Promise<void> {
  const gen = currentSpaRender();
  paintDashboard(root, session, registry, {
    totalUsd: t("wallet.balanceLoading"),
    chainHtml: "",
    balanceError: false,
    loading: true,
  });

  try {
    const balance = await fetchWalletBalance(session.address);
    if (!isSpaRenderCurrent(gen)) return;
    paintDashboard(root, session, registry, {
      totalUsd: balance.totalUsd,
      chainHtml: `
      <section class="wallet-chain-breakdown">
        <h2>${escapeHtml(t("wallet.byChain"))}</h2>
        ${chainBalanceRows(balance.chains)}
      </section>`,
      balanceError: false,
      loading: false,
    });
  } catch {
    if (!isSpaRenderCurrent(gen)) return;
    paintDashboard(root, session, registry, {
      totalUsd: t("wallet.balanceZero"),
      chainHtml: `<p class="wallet-balance-error" role="status">${escapeHtml(t("wallet.balanceError"))}</p>`,
      balanceError: true,
      loading: false,
    });
  }
}

function paintDashboard(
  root: HTMLElement,
  session: NonNullable<ReturnType<typeof loadWalletSession>>,
  registry: ReturnType<typeof listWalletRegistry>,
  opts: { totalUsd: string; chainHtml: string; balanceError: boolean; loading: boolean }
): void {
  root.innerHTML = `
    <section class="panel wallet-panel wallet-panel-unlocked">
      ${walletAccountBarHtml(session, registry)}
      ${walletSubnav("home")}
      <div class="wallet-dashboard">
        <div class="wallet-dashboard-balance ${opts.balanceError ? "is-error" : ""} ${opts.loading ? "is-loading" : ""}">
          <p class="eyebrow">${escapeHtml(t("wallet.totalBalance"))}</p>
          <p class="wallet-balance-total"><span class="wallet-balance-amount">${escapeHtml(opts.totalUsd)}</span> <span class="wallet-balance-currency">${escapeHtml(t("wallet.usd"))}</span></p>
        </div>
        <div class="cta-row wallet-actions wallet-actions-primary">
          <a class="tc-btn" href="/wallet/send" data-route>${escapeHtml(t("wallet.sendTitle"))}</a>
          <a class="tc-btn secondary" href="/wallet/receive" data-route>${escapeHtml(t("wallet.receiveTitle"))}</a>
        </div>
        <p class="wallet-device-status">
          <span class="wallet-device-status-label">${escapeHtml(t("wallet.thisDeviceChip"))}</span>
          <a href="/wallet/security" data-route>${escapeHtml(t("wallet.manageDevices"))}</a>
          <span class="wallet-device-status-hint">${escapeHtml(t("wallet.pairOtherDevices"))}</span>
        </p>
        ${opts.chainHtml}
      </div>
      <p id="wallet-home-status" class="status wallet-status" role="status" hidden></p>
    </section>`;

  bindWalletAccountBar(root);
  bindCopyButtons(root);
}

async function renderPicker(
  root: HTMLElement,
  registry: ReturnType<typeof listWalletRegistry>
): Promise<void> {
  const gen = currentSpaRender();
  root.innerHTML = `
    <header class="page-header wallet-page-header">
      <p class="eyebrow">${escapeHtml(t("wallet.eyebrow"))}</p>
      <h1>${escapeHtml(t("wallet.chooseWallet"))}</h1>
      <p class="lede">${escapeHtml(t("wallet.chooseWalletLede"))}</p>
    </header>
    <section class="panel wallet-panel">
      <div class="wallet-picker-list">
        ${registry.map((w) => walletPickerCard(w, null, true)).join("")}
      </div>
      <div class="cta-row wallet-picker-toolbar">
        <a class="tc-btn secondary" href="/wallet/create" data-route>${escapeHtml(t("wallet.createAnother"))}</a>
        <button type="button" class="tc-btn secondary" id="wallet-unlock">${escapeHtml(t("wallet.unlockAnother"))}</button>
      </div>
      <p class="field-hint wallet-sync-hint">${escapeHtml(t("wallet.syncHint"))}</p>
      <p id="wallet-home-status" class="status wallet-status" role="status" hidden></p>
    </section>`;

  bindPickerActions(root);

  await Promise.all(
    registry.map(async (w) => {
      let usd: string | null = null;
      try {
        usd = (await fetchWalletBalance(w.address)).totalUsd;
      } catch {
        usd = null;
      }
      if (!isSpaRenderCurrent(gen)) return;
      const card = root.querySelector<HTMLElement>(`[data-wallet-open="${w.address}"]`);
      const el = card?.querySelector(".wallet-picker-balance");
      if (!el) return;
      if (usd != null) {
        el.textContent = `${usd} ${t("wallet.usd")}`;
        el.classList.remove("is-muted");
      } else {
        el.textContent = t("wallet.balanceUnavailableShort");
        el.classList.add("is-muted");
      }
    })
  );
}

function renderEmpty(root: HTMLElement): void {
  const supported = webAuthnSupported();
  root.innerHTML = `
    <header class="page-header wallet-page-header">
      <p class="eyebrow">${escapeHtml(t("wallet.eyebrow"))}</p>
      <h1>${escapeHtml(t("wallet.homeTitle"))}</h1>
      <p class="lede">${escapeHtml(t("wallet.homeLede"))}</p>
    </header>
    <section class="panel wallet-panel wallet-panel-empty">
      <article class="wallet-empty-card">
        <h2>${escapeHtml(t("wallet.createEmptyTitle"))}</h2>
        <p>${escapeHtml(t("wallet.createEmptyBody"))}</p>
        <p class="field-hint">${escapeHtml(supported ? t("wallet.webauthnOk") : t("wallet.webauthnNo"))}</p>
        <a class="tc-btn" href="/wallet/create" data-route>${escapeHtml(t("wallet.create"))}</a>
      </article>
      <aside class="wallet-empty-secondary">
        <h3>${escapeHtml(t("wallet.unlockSectionTitle"))}</h3>
        <button type="button" class="tc-btn secondary" id="wallet-unlock" ${supported ? "" : "disabled"}>
          ${escapeHtml(t("wallet.unlock"))}
        </button>
        <p class="field-hint">${escapeHtml(t("wallet.unlockHint"))}</p>
        <p class="field-hint wallet-pair-hint">${escapeHtml(t("wallet.pairFromOtherHint"))}</p>
      </aside>
      <p id="wallet-home-status" class="status wallet-status" role="status" hidden></p>
    </section>`;

  bindUnlock(root);
}

function bindPickerActions(root: HTMLElement): void {
  const open = (addr: string | undefined) => {
    if (addr && setActiveWallet(addr)) void renderWalletHome(root);
  };
  root.querySelector(".wallet-picker-list")?.addEventListener("click", (ev) => {
    const target = (ev.target as HTMLElement).closest<HTMLElement>("[data-wallet-open]");
    open(target?.dataset.walletOpen);
  });
  root.querySelectorAll<HTMLElement>("[data-wallet-open]").forEach((el) => {
    el.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" || ev.key === " ") {
        ev.preventDefault();
        open(el.dataset.walletOpen);
      }
    });
  });
  bindUnlock(root);
}

function bindUnlock(root: HTMLElement): void {
  root.querySelector("#wallet-unlock")?.addEventListener("click", async () => {
    const status = root.querySelector<HTMLElement>("#wallet-home-status");
    status?.removeAttribute("hidden");
    try {
      showStatus(status, t("wallet.sendSigning"));
      await unlockWalletWithPasskey();
      spaNavigate("/wallet", "replace");
    } catch (error) {
      showStatus(status, error instanceof Error ? error.message : String(error), "error");
    }
  });
}
