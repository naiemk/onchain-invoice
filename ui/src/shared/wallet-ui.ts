import { copyText, escapeHtml } from "./dom.js";
import { t } from "../i18n/t.js";
import type { WalletBalanceChain } from "../../../commerce/shared/wallet.js";
import {
  clearActiveWallet,
  listWalletRegistry,
  loadWalletSession,
  setActiveWallet,
  shortAddress,
  type WalletSession,
} from "./wallet-session.js";
import { spaNavigate } from "./spa-render.js";
import { isAdvancedMode, loadWalletMode, saveWalletMode, type WalletMode } from "./wallet-mode.js";

export type WalletTab =
  | "home"
  | "security"
  | "superWallet"
  | "send"
  | "receive"
  | "create"
  | "pair"
  | "recover"
  | "cash"
  | "getPaid"
  | "invoices"
  | "developers";

export interface WalletRenderOptions {
  /** When true, paint only the page body (React WalletFrame supplies chrome). */
  frameless?: boolean;
}

/** Paint wallet page chrome + body, or body-only for React migration. */
export function paintWalletPage(
  root: HTMLElement,
  frame: { current: WalletTab; body: string; title?: string; lede?: string },
  opts?: WalletRenderOptions,
  bindBody?: (root: HTMLElement) => void
): void {
  if (opts?.frameless) {
    root.innerHTML = frame.body;
    bindBody?.(root);
    return;
  }
  root.innerHTML = walletFrame(frame);
  bindWalletChrome(root);
  bindBody?.(root);
}

export function paintWalletLoading(
  root: HTMLElement,
  current: WalletTab,
  title: string,
  lede?: string,
  opts?: WalletRenderOptions
): void {
  paintWalletPage(
    root,
    {
      current,
      title,
      lede,
      body: `<p class="field-hint wallet-route-loading" aria-busy="true">${escapeHtml(t("wallet.balanceLoading"))}</p>`,
    },
    opts
  );
}

const ICON_COPY = `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false"><rect x="9" y="9" width="13" height="13" rx="2" fill="none" stroke="currentColor" stroke-width="1.75"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"/></svg>`;
const ICON_CHECK = `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false"><path d="M5 12.5l4.2 4.2L19 7.5" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const ICON_LOCK = `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false"><rect x="4" y="11" width="16" height="11" rx="2" fill="none" stroke="currentColor" stroke-width="1.75"/><path d="M8 11V7.5a4 4 0 0 1 8 0V11" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"/></svg>`;
const ICON_CHEVRON = `<svg class="wallet-account-caret" viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" focusable="false"><path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const ICON_PLUS = `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false"><path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/></svg>`;

function labelInitials(label: string): string {
  const parts = label.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0][0] ?? ""}${parts[1][0] ?? ""}`.toUpperCase();
  const word = parts[0] ?? "?";
  return word.slice(0, 2).toUpperCase();
}

/** Distinct, designed hues — raw address→HSL often lands on brand navy. */
const IDENT_PALETTE: ReadonlyArray<{ h: number; s: number; l: number }> = [
  { h: 211, s: 78, l: 44 },
  { h: 168, s: 56, l: 32 },
  { h: 28, s: 82, l: 44 },
  { h: 338, s: 62, l: 44 },
  { h: 262, s: 48, l: 48 },
  { h: 145, s: 46, l: 34 },
  { h: 198, s: 64, l: 38 },
  { h: 12, s: 70, l: 46 },
];

function addressPalette(address: string): (typeof IDENT_PALETTE)[number] {
  const hex = address.replace(/^0x/i, "");
  let n = 0;
  for (let i = 0; i < hex.length; i++) {
    n = (n * 33 + parseInt(hex[i] ?? "0", 16)) >>> 0;
  }
  return IDENT_PALETTE[n % IDENT_PALETTE.length]!;
}

function identiconHtml(session: WalletSession): string {
  const { h, s, l } = addressPalette(session.address);
  const initials = escapeHtml(labelInitials(session.label));
  return `<span class="wallet-identicon" style="--ident-h:${h};--ident-s:${s}%;--ident-l:${l}%" aria-hidden="true">${initials}</span>`;
}

export function walletAccountBarHtml(session: WalletSession, registry: WalletSession[]): string {
  const multiple = registry.length > 1;
  const chipInner = `
    ${identiconHtml(session)}
    <span class="wallet-account-name-row">
      <span class="wallet-account-name">${escapeHtml(session.label)}</span>
      ${multiple ? ICON_CHEVRON : ""}
    </span>`;
  const chip = multiple
    ? `<button type="button" class="wallet-account-chip" id="wallet-account-chip" aria-haspopup="menu" aria-expanded="false" aria-controls="wallet-account-menu" aria-label="${escapeHtml(t("wallet.switchWallet"))}">
        ${chipInner}
      </button>`
    : `<div class="wallet-account-chip is-static">${chipInner}</div>`;

  const menu = multiple
    ? `<div class="wallet-account-menu hidden" id="wallet-account-menu" role="menu" hidden>
        <p class="wallet-account-menu-label">${escapeHtml(t("wallet.walletsOnDevice"))}</p>
        ${registry
          .map((w) => {
            const active = w.address.toLowerCase() === session.address.toLowerCase();
            return `
          <button type="button" class="wallet-account-menu-item ${active ? "is-active" : ""}" role="menuitem" data-wallet-switch="${escapeHtml(w.address)}" ${active ? 'aria-current="true"' : ""}>
            ${identiconHtml(w)}
            <span class="wallet-account-meta">
              <span class="wallet-account-name">${escapeHtml(w.label)}</span>
              <span class="mono wallet-account-addr">${escapeHtml(shortAddress(w.address))}</span>
            </span>
            <span class="wallet-account-check ${active ? "is-on" : ""}">${active ? ICON_CHECK : ""}</span>
          </button>`;
          })
          .join("")}
        <a class="wallet-account-menu-item wallet-account-menu-create" href="/wallet/create" data-route role="menuitem">
          <span class="wallet-identicon is-add" aria-hidden="true">${ICON_PLUS}</span>
          <span class="wallet-account-meta">
            <span class="wallet-account-name">${escapeHtml(t("wallet.createAnother"))}</span>
          </span>
        </a>
      </div>`
    : "";

  return `
    <div class="wallet-account-bar">
      <div class="wallet-account-identity">
        ${chip}
        <button type="button" class="wallet-account-addr-btn" id="wallet-account-copy" title="${escapeHtml(t("wallet.copyAddress"))}" aria-label="${escapeHtml(t("wallet.copyAddress"))}">
          <span class="mono wallet-account-addr">${escapeHtml(shortAddress(session.address))}</span>
          <span class="wallet-account-copy-icon">${ICON_COPY}</span>
        </button>
        ${menu}
      </div>
      <button type="button" class="wallet-account-lock" id="wallet-account-lock" title="${escapeHtml(t("wallet.lockHint"))}">
        ${ICON_LOCK}
        <span>${escapeHtml(t("wallet.signOut"))}</span>
      </button>
      <span class="visually-hidden" id="wallet-account-live" aria-live="polite"></span>
    </div>`;
}

export function bindWalletAccountBar(root: HTMLElement): void {
  bindWalletModeToggle(root);
  const bar = root.querySelector<HTMLElement>(".wallet-account-bar");
  if (!bar) return;
  const session = loadWalletSession();
  if (!session) return;

  const chip = bar.querySelector<HTMLButtonElement>("#wallet-account-chip");
  const menu = bar.querySelector<HTMLElement>("#wallet-account-menu");
  const live = bar.querySelector<HTMLElement>("#wallet-account-live");

  const closeMenu = (): void => {
    if (!menu || !chip) return;
    menu.classList.add("hidden");
    menu.hidden = true;
    chip.setAttribute("aria-expanded", "false");
  };
  const openMenu = (): void => {
    if (!menu || !chip) return;
    menu.classList.remove("hidden");
    menu.hidden = false;
    chip.setAttribute("aria-expanded", "true");
  };

  chip?.addEventListener("click", (ev) => {
    ev.stopPropagation();
    if (menu?.hidden) openMenu();
    else closeMenu();
  });

  bar.querySelector("#wallet-account-copy")?.addEventListener("click", async (ev) => {
    ev.stopPropagation();
    closeMenu();
    try {
      await copyText(session.address);
    } catch {
      return;
    }
    const btn = ev.currentTarget as HTMLButtonElement;
    const icon = btn.querySelector(".wallet-account-copy-icon");
    btn.classList.add("is-copied");
    if (icon) icon.innerHTML = ICON_CHECK;
    if (live) live.textContent = t("wallet.addressCopied");
    window.setTimeout(() => {
      if (!btn.isConnected) return;
      btn.classList.remove("is-copied");
      if (icon) icon.innerHTML = ICON_COPY;
    }, 1600);
  });

  bar.querySelector("#wallet-account-lock")?.addEventListener("click", (ev) => {
    ev.stopPropagation();
    closeMenu();
    clearActiveWallet();
    spaNavigate("/wallet", "replace");
  });

  bar.querySelectorAll<HTMLElement>("[data-wallet-switch]").forEach((item) => {
    item.addEventListener("click", (ev) => {
      ev.stopPropagation();
      const addr = item.dataset.walletSwitch;
      if (!addr || addr.toLowerCase() === session.address.toLowerCase()) {
        closeMenu();
        return;
      }
      if (setActiveWallet(addr)) spaNavigate(location.pathname, "replace");
    });
  });

  const onDocClick = (ev: MouseEvent): void => {
    if (!root.isConnected) {
      document.removeEventListener("click", onDocClick);
      document.removeEventListener("keydown", onKey);
      return;
    }
    if (!bar.contains(ev.target as Node)) closeMenu();
  };
  const onKey = (ev: KeyboardEvent): void => {
    if (ev.key === "Escape") closeMenu();
  };
  document.addEventListener("click", onDocClick);
  document.addEventListener("keydown", onKey);
}

/** Panel chrome: account bar (when unlocked) + subnav + optional title. */
export function walletFrame(opts: {
  current: WalletTab;
  body: string;
  title?: string;
  lede?: string;
}): string {
  const session = loadWalletSession();
  const registry = listWalletRegistry();
  if (!session) {
    return `
      ${
        opts.title
          ? `<header class="page-header wallet-page-header">
        <p class="eyebrow">${escapeHtml(t("wallet.eyebrow"))}</p>
        <h1>${escapeHtml(opts.title)}</h1>
        ${opts.lede ? `<p class="lede">${escapeHtml(opts.lede)}</p>` : ""}
      </header>`
          : ""
      }
      <section class="panel wallet-panel">
        ${walletSubnav(opts.current)}
        ${opts.body}
      </section>`;
  }
  return `
    <section class="panel wallet-panel wallet-panel-unlocked">
      ${walletAccountBarHtml(session, registry)}
      ${walletSubnav(opts.current)}
      ${opts.title ? `<h1 class="wallet-panel-title">${escapeHtml(opts.title)}</h1>` : ""}
      ${opts.lede ? `<p class="lede wallet-panel-lede">${escapeHtml(opts.lede)}</p>` : ""}
      ${opts.body}
    </section>`;
}

/** After painting walletFrame HTML, bind mode toggle + account bar helpers. */
export function bindWalletChrome(root: HTMLElement): void {
  bindWalletAccountBar(root);
  bindWalletModeToggle(root);
}

/** Chrome + subnav so a tab can paint before async data arrives. */
export function walletLoadingFrame(
  current: WalletTab,
  title: string,
  lede?: string
): string {
  return walletFrame({
    current,
    title,
    lede,
    body: `<p class="field-hint wallet-route-loading" aria-busy="true">${escapeHtml(t("wallet.balanceLoading"))}</p>`,
  });
}

export function walletModeToggleHtml(): string {
  const mode = loadWalletMode();
  return `
    <div class="wallet-mode-toggle" role="group" aria-label="${escapeHtml(t("wallet.modeLabel"))}">
      <button type="button" class="wallet-mode-btn ${mode === "simple" ? "is-active" : ""}" data-wallet-mode="simple">${escapeHtml(t("wallet.modeSimple"))}</button>
      <button type="button" class="wallet-mode-btn ${mode === "advanced" ? "is-active" : ""}" data-wallet-mode="advanced">${escapeHtml(t("wallet.modeAdvanced"))}</button>
    </div>`;
}

export function bindWalletModeToggle(root: HTMLElement, onChange?: (mode: WalletMode) => void): void {
  root.querySelectorAll<HTMLButtonElement>("[data-wallet-mode]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const mode = btn.dataset.walletMode as WalletMode;
      if (mode !== "simple" && mode !== "advanced") return;
      saveWalletMode(mode);
      onChange?.(mode);
      spaNavigate(location.pathname + location.search, "replace");
    });
  });
}

export function walletSubnav(current: WalletTab): string {
  const session = loadWalletSession();
  const advanced = isAdvancedMode();
  const links: Array<{ href: string; key: WalletTab; label: string }> = [
    { href: "/wallet", key: "home", label: t("wallet.homeTab") },
    { href: "/wallet/get-paid", key: "getPaid", label: t("wallet.getPaidTab") },
    { href: "/wallet/send", key: "send", label: t("wallet.payTab") },
    { href: "/wallet/cash", key: "cash", label: t("wallet.cashTab") },
    { href: "/wallet/security", key: "security", label: t("wallet.securityTab") },
  ];
  if (advanced) {
    links.push({ href: "/wallet/super-wallet", key: "superWallet", label: t("wallet.superWalletTab") });
    links.push({ href: "/merchant", key: "invoices", label: t("wallet.invoicesTab") });
    links.push({ href: "/wallet/recover", key: "recover", label: t("wallet.recoverTab") });
    links.push({ href: "/wallet/developers", key: "developers", label: t("wallet.developersTab") });
  } else if (session || current === "recover") {
    links.push({ href: "/wallet/recover", key: "recover", label: t("wallet.recoverTab") });
  }
  return `
    <div class="wallet-subnav-row">
      ${walletModeToggleHtml()}
      <nav class="wallet-subnav" aria-label="${escapeHtml(t("wallet.navLabel"))}">
        ${links
          .map((l) =>
            l.key === current
              ? `<span aria-current="page">${escapeHtml(l.label)}</span>`
              : `<a href="${l.href}" data-route>${escapeHtml(l.label)}</a>`
          )
          .join("")}
      </nav>
    </div>`;
}

export function addressBox(address: string, id = "wallet-address-copy"): string {
  return `
    <div class="address-box wallet-address-box">
      <code class="mono" id="${id}">${escapeHtml(address)}</code>
      <button type="button" class="tc-btn secondary small copy-btn" data-copy-target="${id}">${escapeHtml(t("wallet.copy"))}</button>
    </div>`;
}

export function bindCopyButtons(root: HTMLElement): void {
  root.querySelectorAll<HTMLElement>("[data-copy-target]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const targetId = btn.dataset.copyTarget;
      const el = targetId ? root.querySelector(`#${targetId}`) : null;
      const text = el?.textContent?.trim();
      if (text) await copyText(text);
    });
  });
  root.querySelectorAll<HTMLElement>("[data-copy-text]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const text = btn.dataset.copyText;
      if (text) await copyText(text);
    });
  });
}

/** Available line for send/withdraw — emphasize amount without oversized home total styles. */
export function formatWalletAvailable(amount: string): string {
  const symbol = t("wallet.usd");
  const full = t("wallet.sendAvailable", { amount, symbol });
  const idx = full.indexOf(amount);
  if (idx < 0) return escapeHtml(full);
  return `${escapeHtml(full.slice(0, idx))}<strong class="mono">${escapeHtml(amount)}</strong>${escapeHtml(
    full.slice(idx + amount.length)
  )}`;
}

export function chainBalanceRows(chains: WalletBalanceChain[]): string {
  if (!chains.length) {
    return `<p class="field-hint">${escapeHtml(t("wallet.noChains"))}</p>`;
  }
  return `
    <ul class="wallet-chain-list">
      ${chains
        .map(
          (c) => `
        <li class="wallet-chain-row ${c.deployed ? "is-deployed" : "is-counterfactual"}">
          <div class="wallet-chain-meta">
            <strong>${escapeHtml(c.networkLabel)}</strong>
            <span class="wallet-chain-status">${escapeHtml(c.deployed ? t("wallet.chainActive") : t("wallet.chainPending"))}</span>
          </div>
          <div class="wallet-chain-balance mono">${escapeHtml(c.balanceUsd)} ${escapeHtml(c.feeTokenSymbol)}</div>
        </li>`
        )
        .join("")}
    </ul>`;
}

export function walletPickerCard(
  session: WalletSession,
  balanceUsd: string | null,
  loading: boolean
): string {
  const balanceText = loading
    ? t("wallet.balanceLoading")
    : balanceUsd != null
      ? `${balanceUsd} ${t("wallet.usd")}`
      : t("wallet.balanceUnavailableShort");
  const balanceClass =
    loading || balanceUsd != null ? "wallet-picker-balance" : "wallet-picker-balance is-muted";
  return `
    <article class="wallet-picker-card" data-wallet-open="${escapeHtml(session.address)}" tabindex="0" role="button">
      <div class="wallet-picker-card-main">
        <h3 class="wallet-picker-label">${escapeHtml(session.label)}</h3>
        <p class="mono wallet-picker-addr">${escapeHtml(shortAddress(session.address))}</p>
      </div>
      <div class="wallet-picker-card-side">
        <p class="${balanceClass}">${escapeHtml(balanceText)}</p>
        <span class="tc-btn secondary small wallet-picker-open-btn">${escapeHtml(t("wallet.openWallet"))}</span>
      </div>
    </article>`;
}

export function setButtonLoading(btn: HTMLButtonElement | null, loading: boolean, loadingText?: string): void {
  if (!btn) return;
  if (loading) {
    btn.disabled = true;
    btn.dataset.originalText = btn.textContent ?? "";
    if (loadingText) btn.textContent = loadingText;
  } else {
    btn.disabled = false;
    if (btn.dataset.originalText) btn.textContent = btn.dataset.originalText;
  }
}

export function showStatus(el: HTMLElement | null, message: string, kind: "info" | "error" | "success" = "info"): void {
  if (!el) return;
  el.className = `status wallet-status ${kind}`;
  el.textContent = message;
}

export function shortKey(hex: string): string {
  return `${hex.slice(0, 8)}…${hex.slice(-6)}`;
}

export function renderYubiKeyPinRequiredPanel(): string {
  return `<div class="banner warn wallet-yubikey-pin-panel">
    <h3>${escapeHtml(t("wallet.yubikeyPinRequiredTitle"))}</h3>
    <p>${escapeHtml(t("wallet.yubikeyPinRequiredWhy"))}</p>
    <p class="field-hint">${escapeHtml(t("wallet.yubikeyPinSetupSteps"))}</p>
    <p class="field-hint">${escapeHtml(t("wallet.yubikeyPinNeverStored"))}</p>
  </div>`;
}

export function formatKeyFingerprint(qx: string, qy?: string | null): string {
  if (!qx) return "—";
  return qy ? `${shortKey(qx)} / ${shortKey(qy)}` : shortKey(qx);
}

export { shortAddress };
