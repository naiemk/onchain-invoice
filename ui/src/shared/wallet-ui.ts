import { copyText, escapeHtml } from "./dom.js";
import { t } from "../i18n/t.js";
import type { WalletBalanceChain } from "../../../commerce/shared/wallet.js";

export function walletSubnav(current: "home" | "security" | "send" | "create" | "pair"): string {
  const links = [
    { href: "/wallet", key: "home" as const, label: t("wallet.homeTitle") },
    { href: "/wallet/send", key: "send" as const, label: t("wallet.sendTitle") },
    { href: "/wallet/security", key: "security" as const, label: t("wallet.securityTab") },
  ];
  return `
    <nav class="wallet-subnav" aria-label="${escapeHtml(t("wallet.navLabel"))}">
      ${links
        .map((l) =>
          l.key === current
            ? `<span aria-current="page">${escapeHtml(l.label)}</span>`
            : `<a href="${l.href}" data-route>${escapeHtml(l.label)}</a>`
        )
        .join("")}
    </nav>`;
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
