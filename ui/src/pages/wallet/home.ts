import { t } from "../../i18n/t.js";
import { escapeHtml } from "../../shared/dom.js";
import { fetchWalletBalance } from "../../shared/wallet-api.js";
import { currentSpaRender, isSpaRenderCurrent, spaNavigate } from "../../shared/spa-render.js";
import {
  listWalletRegistry,
  loadWalletSession,
  formatPasskeyError,
  webAuthnSupported,
} from "../../shared/webauthn.js";
import { unlockRegistryWallet, unlockWalletWithPasskey } from "../../shared/wallet-unlock.js";
import {
  bindCopyButtons,
  bindWalletAccountBar,
  bindWalletModeToggle,
  chainBalanceRows,
  showStatus,
  walletAccountBarHtml,
  walletPickerCard,
  walletSubnav,
} from "../../shared/wallet-ui.js";
import { isAdvancedMode } from "../../shared/wallet-mode.js";
import { listDevices } from "../../shared/wallet-api.js";
import { fetchWalletRecovery } from "../../shared/wallet-recovery-api.js";
import { fetchAdvancedPolicy, listWalletEntities } from "../../shared/wallet-advanced-api.js";

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
  const advanced = isAdvancedMode();
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
          <a class="tc-btn" href="/wallet/get-paid" data-route>${escapeHtml(t("wallet.actionGetPaid"))}</a>
          <a class="tc-btn secondary" href="/wallet/send" data-route>${escapeHtml(t("wallet.actionPay"))}</a>
          <a class="tc-btn secondary" href="/wallet/cash" data-route>${escapeHtml(t("wallet.actionCashIn"))}</a>
          <a class="tc-btn secondary" href="/wallet/cash" data-route>${escapeHtml(t("wallet.actionCashOut"))}</a>
        </div>
        <div id="wallet-needs-attention" class="wallet-needs-attention hidden" hidden></div>
        ${
          advanced
            ? `<div class="wallet-advanced-home" id="wallet-advanced-home">
                <p class="field-hint">${escapeHtml(t("wallet.advancedHomeLoading"))}</p>
              </div>`
            : ""
        }
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
  bindWalletModeToggle(root);
  bindCopyButtons(root);

  void (async () => {
    const attention = root.querySelector<HTMLElement>("#wallet-needs-attention");
    try {
      const recovery = await fetchWalletRecovery(session.address);
      if (recovery.request || recovery.pendingOwner?.active) {
        if (attention) {
          attention.hidden = false;
          attention.classList.remove("hidden");
          attention.innerHTML = `
            <p class="banner warn">${escapeHtml(t("wallet.pendingRecovery"))}
              <a href="/wallet/security#recovery" data-route>${escapeHtml(t("wallet.recoverOpen"))}</a>
            </p>`;
        }
      }
    } catch {
      /* ignore */
    }

    if (!advanced) return;
    const box = root.querySelector<HTMLElement>("#wallet-advanced-home");
    if (!box) return;
    let deviceCount = 1;
    let onChainAdvanced = false;
    try {
      deviceCount = (await listDevices(session.address, session.chainId)).length || 1;
    } catch {
      deviceCount = 1;
    }
    try {
      const policy = await fetchAdvancedPolicy(session.address);
      onChainAdvanced = policy.advanced;
      if (onChainAdvanced) {
        const roster = await listWalletEntities(session.address);
        deviceCount = Math.max(roster.keys.length, roster.entities.length, 1);
      }
    } catch {
      onChainAdvanced = false;
    }
    const devicesBodyKey = onChainAdvanced ? "wallet.advancedDevicesBodySuper" : "wallet.advancedDevicesBodySimple";
    const superCard = !onChainAdvanced
      ? `<a class="wallet-advanced-card wallet-advanced-card-highlight" href="/wallet/super-wallet" data-route>
          <strong>${escapeHtml(t("wallet.superWalletHomeCta"))}</strong>
          <span>${escapeHtml(t("wallet.superWalletHomeBanner"))}</span>
        </a>`
      : `<a class="wallet-advanced-card" href="/wallet/super-wallet" data-route>
          <strong>${escapeHtml(t("wallet.superWalletTitle"))}</strong>
          <span>${escapeHtml(t("wallet.superWalletActiveShort"))}</span>
        </a>`;
    box.innerHTML = `
      <div class="wallet-advanced-cards">
        ${superCard}
        <a class="wallet-advanced-card" href="/wallet/security" data-route>
          <strong>${escapeHtml(t("wallet.advancedDevicesTitle"))}</strong>
          <span>${escapeHtml(t(devicesBodyKey, { count: deviceCount }))}</span>
        </a>
        <a class="wallet-advanced-card" href="/wallet/security#recovery" data-route>
          <strong>${escapeHtml(t("wallet.advancedRecoveryTitle"))}</strong>
          <span>${escapeHtml(t("wallet.advancedRecoveryBody"))}</span>
        </a>
        <a class="wallet-advanced-card" href="/wallet/invoices" data-route>
          <strong>${escapeHtml(t("wallet.advancedInvoicesTitle"))}</strong>
          <span>${escapeHtml(t("wallet.advancedInvoicesBody"))}</span>
        </a>
        <a class="wallet-advanced-card" href="/wallet/developers" data-route>
          <strong>${escapeHtml(t("wallet.developersTab"))}</strong>
          <span>${escapeHtml(t("wallet.advancedDevBody"))}</span>
        </a>
      </div>`;
  })();
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
  const open = async (addr: string | undefined) => {
    if (!addr) return;
    const entry = listWalletRegistry().find((w) => w.address.toLowerCase() === addr.toLowerCase());
    if (!entry) return;
    const status = root.querySelector<HTMLElement>("#wallet-home-status");
    status?.removeAttribute("hidden");
    try {
      showStatus(status, t("wallet.sendSigning"));
      await unlockRegistryWallet(entry);
      spaNavigate("/wallet", "replace");
    } catch (error) {
      showStatus(status, formatPasskeyError(error), "error");
    }
  };
  root.querySelector(".wallet-picker-list")?.addEventListener("click", (ev) => {
    const target = (ev.target as HTMLElement).closest<HTMLElement>("[data-wallet-open]");
    void open(target?.dataset.walletOpen);
  });
  root.querySelectorAll<HTMLElement>("[data-wallet-open]").forEach((el) => {
    el.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" || ev.key === " ") {
        ev.preventDefault();
        void open(el.dataset.walletOpen);
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
      showStatus(status, formatPasskeyError(error), "error");
    }
  });
}
