import "./styles.css";
import { renderIntegrations } from "./pages/integrations.js";
import { renderAdmin } from "./pages/admin.js";
import { renderGuardian } from "./pages/guardian.js";
import { renderCreate } from "./pages/create/index.js";
import { renderHome } from "./pages/home.js";
import { renderMerchant } from "./pages/merchant.js";
import { renderPay } from "./pages/pay.js";
import { renderWallet } from "./pages/wallet/index.js";
import { renderGetPaid } from "./pages/get-paid.js";
import { renderSecurityMarketing } from "./pages/security.js";
import { SITE } from "./shared/site.js";
import { applyTheme, initThemeToggle, preferredTheme } from "./shared/theme.js";
import { beginSpaRender, isSpaRenderCurrent } from "./shared/spa-render.js";
import { isLocale, LOCALES, LOCALE_NATIVE_NAMES } from "./i18n/locales.js";
import { applyLocale, getLocale, setLocale, t } from "./i18n/t.js";
import { resolvePageLocale } from "./i18n/detect.js";
import { currentPayChromeFromLocation, type PayChrome } from "./shared/pay-chrome.js";

export type PageRenderer = (root: HTMLElement) => void | Promise<void>;

const routes: Record<string, PageRenderer> = {
  "/": renderHome,
  "/integrations": renderIntegrations,
  "/get-paid": renderGetPaid,
  "/security": renderSecurityMarketing,
  "/create": renderCreate,
  "/pay": renderPay,
  "/merchant": renderMerchant,
  "/admin": renderAdmin,
  "/guardian": renderGuardian,
  "/wallet": renderWallet,
  "/wallet/security": renderWallet,
  "/wallet/create": renderWallet,
  "/wallet/pair": renderWallet,
  "/wallet/send": renderWallet,
  "/wallet/receive": renderWallet,
  "/wallet/deposit": renderWallet,
  "/wallet/withdraw": renderWallet,
  "/wallet/offramp/cashout": renderWallet,
  "/wallet/recover": renderWallet,
  "/wallet/cash": renderWallet,
  "/wallet/get-paid": renderWallet,
  "/wallet/developers": renderWallet,
};

applyTheme(preferredTheme());
applyLocale(resolvePageLocale());

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) throw new Error("Missing #app");
const appRoot = app;

let lastChrome: PayChrome | null = null;

window.addEventListener("popstate", () => void render());
document.addEventListener("click", (event) => {
  const target = event.target as HTMLElement | null;
  const link = target?.closest("a[data-route]") as HTMLAnchorElement | null;
  if (!link) return;
  event.preventDefault();
  history.pushState({}, "", link.href);
  void render();
});

void render();

async function render(options?: { rebuildShell?: boolean }): Promise<void> {
  const gen = beginSpaRender();
  applyLocale(resolvePageLocale());
  const pathname = location.pathname;
  const chrome = pathname === "/pay" ? currentPayChromeFromLocation() : "full";
  applyMeta(pathname);
  const route =
    routes[pathname] ??
    (pathname.startsWith("/merchant/") ? renderMerchant : pathname.startsWith("/wallet") ? renderWallet : renderHome);

  const outletExists = Boolean(appRoot.querySelector("#outlet"));
  const chromeChanged = lastChrome !== null && lastChrome !== chrome;
  if (options?.rebuildShell || !outletExists || chromeChanged) {
    appRoot.innerHTML = shell(pathname, chrome);
    appRoot.dataset.chrome = chrome;
    lastChrome = chrome;
    initThemeToggle(appRoot.querySelector<HTMLButtonElement>("#theme-toggle"));
    initLocaleSelect(appRoot.querySelector<HTMLSelectElement>("#locale-select"));
  } else {
    appRoot.dataset.chrome = chrome;
    lastChrome = chrome;
    syncTopbarNav(pathname);
  }

  const outlet = appRoot.querySelector<HTMLElement>("#outlet");
  if (!outlet) throw new Error("Missing outlet");
  if (!isSpaRenderCurrent(gen)) return;
  await route(outlet);
}

function syncTopbarNav(pathname: string): void {
  const nav = appRoot.querySelector("header.topbar nav");
  if (!nav) return;
  nav.querySelectorAll("a[data-route]").forEach((anchor) => {
    const href = anchor.getAttribute("href") ?? "";
    const isActive =
      pathname === href ||
      (href !== "/" && pathname.startsWith(href)) ||
      (href === "/get-paid" && (pathname.startsWith("/create") || pathname.startsWith("/merchant")));
    if (isActive) anchor.setAttribute("aria-current", "page");
    else anchor.removeAttribute("aria-current");
  });
}

function applyMeta(pathname: string): void {
  const key = pathname.startsWith("/merchant") ? "/merchant" : pathname;
  const meta = pageMeta(key);
  document.title = meta.title;
  const desc = document.querySelector('meta[name="description"]');
  if (desc) desc.setAttribute("content", meta.description);
}

function pageMeta(path: string): { title: string; description: string } {
  switch (path) {
    case "/get-paid":
      return { title: t("meta.getPaidTitle"), description: t("meta.getPaidDescription") };
    case "/security":
      return { title: t("meta.securityTitle"), description: t("meta.securityDescription") };
    case "/create":
      return { title: t("meta.createTitle"), description: t("meta.createDescription") };
    case "/pay":
      return { title: t("meta.payTitle"), description: t("meta.payDescription") };
    case "/merchant":
      return { title: t("meta.merchantTitle"), description: t("meta.merchantDescription") };
    case "/integrations":
      return { title: t("meta.integrationsTitle"), description: t("meta.integrationsDescription") };
    case "/admin":
      return { title: t("meta.adminTitle"), description: t("meta.adminDescription") };
    case "/guardian":
      return { title: t("meta.guardianTitle"), description: t("meta.guardianDescription") };
    case "/wallet":
    case "/wallet/security":
    case "/wallet/create":
    case "/wallet/pair":
    case "/wallet/send":
    case "/wallet/receive":
    case "/wallet/deposit":
    case "/wallet/withdraw":
    case "/wallet/offramp/cashout":
    case "/wallet/recover":
    case "/wallet/cash":
    case "/wallet/get-paid":
    case "/wallet/developers":
      return { title: t("meta.walletTitle"), description: t("meta.walletDescription") };
    default:
      return { title: t("meta.homeTitle"), description: t("meta.homeDescription") };
  }
}

function initLocaleSelect(select: HTMLSelectElement | null): void {
  if (!select) return;
  select.value = getLocale();
  select.addEventListener("change", () => {
    const value = select.value;
    if (!isLocale(value)) return;
    setLocale(value);
    void render({ rebuildShell: true });
  });
}

function localeSelectHtml(): string {
  const current = getLocale();
  const options = LOCALES.map(
    (locale) =>
      `<option value="${locale}" ${locale === current ? "selected" : ""}>${LOCALE_NATIVE_NAMES[locale]}</option>`
  ).join("");
  return `
    <label class="locale-switch">
      <span class="visually-hidden">${t("locale.label")}</span>
      <select id="locale-select" aria-label="${t("locale.label")}">${options}</select>
    </label>`;
}

function shell(pathname: string, chrome: PayChrome = "full"): string {
  if (chrome === "none") {
    return `<main id="outlet" class="outlet-chrome-none"></main>`;
  }

  const active = (href: string) => {
    if (pathname === href || (href !== "/" && pathname.startsWith(href))) return true;
    if (href === "/get-paid" && (pathname.startsWith("/create") || pathname.startsWith("/merchant"))) return true;
    if (href === "/wallet" && pathname.startsWith("/wallet")) return true;
    return false;
  };
  const link = (href: string, label: string) =>
    `<a href="${href}" data-route${active(href) ? ' aria-current="page"' : ""}>${label}</a>`;

  if (chrome === "minimal") {
    return `
    <header class="topbar topbar-minimal">
      <a class="brand" href="/" data-route>
        <span class="brand-mark"><img src="/logo.svg" alt="" width="32" height="32" /></span>
        <span>${t("brand")}</span>
      </a>
      <nav>
        ${localeSelectHtml()}
        <button type="button" class="theme-toggle" id="theme-toggle" aria-pressed="false" aria-label="${t("theme.switchTheme")}"></button>
      </nav>
    </header>
    <main id="outlet"></main>
    <footer class="site-footer global-footer global-footer-minimal">
      <span>${t("brand")}</span>
      <span>
        <a href="${SITE.docsUrl}" target="_blank" rel="noopener noreferrer">${t("nav.docs")}</a>
      </span>
    </footer>
  `;
  }

  return `
    <header class="topbar">
      <a class="brand" href="/" data-route>
        <span class="brand-mark"><img src="/logo.svg" alt="" width="32" height="32" /></span>
        <span>${t("brand")}</span>
      </a>
      <nav>
        ${link("/wallet", t("nav.wallet"))}
        ${link("/get-paid", t("nav.getPaid"))}
        ${link("/integrations", t("nav.integrations"))}
        ${link("/security", t("nav.security"))}
        <a href="${SITE.docsUrl}" target="_blank" rel="noopener noreferrer">${t("nav.docs")}</a>
        ${localeSelectHtml()}
        <button type="button" class="theme-toggle" id="theme-toggle" aria-pressed="false" aria-label="${t("theme.switchTheme")}"></button>
      </nav>
    </header>
    <main id="outlet"></main>
    <footer class="site-footer global-footer">
      <span>${t("brand")}</span>
      <span>
        <a href="${SITE.docsUrl}" target="_blank" rel="noopener noreferrer">${t("nav.docs")}</a>
        ·
        <a href="${SITE.agentSkillUrl}" rel="alternate noopener noreferrer" target="_blank" data-agent-skill="trustless-commerce-invoice">${t("nav.aiSkill")}</a>
        ·
        <a href="${SITE.githubUrl}" target="_blank" rel="noopener noreferrer">${t("nav.github")}</a>
        ·
        <a href="${SITE.telegramChannel}" target="_blank" rel="noopener noreferrer">${t("nav.telegram")}</a>
        ·
        <a href="${SITE.telegramSupport}" target="_blank" rel="noopener noreferrer">${t("nav.support")}</a>
      </span>
    </footer>
  `;
}
