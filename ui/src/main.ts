import "./styles.css";
import { renderIntegrations } from "./pages/integrations.js";
import { renderAdmin } from "./pages/admin.js";
import { renderCreate } from "./pages/create.js";
import { renderHome } from "./pages/home.js";
import { renderMerchant } from "./pages/merchant.js";
import { renderPay } from "./pages/pay.js";
import { renderWallet } from "./pages/wallet/index.js";
import { SITE } from "./shared/site.js";
import { applyTheme, initThemeToggle, preferredTheme } from "./shared/theme.js";
import { isLocale, LOCALES, LOCALE_NATIVE_NAMES } from "./i18n/locales.js";
import { applyLocale, getLocale, setLocale, t } from "./i18n/t.js";
import { resolvePageLocale } from "./i18n/detect.js";

export type PageRenderer = (root: HTMLElement) => void | Promise<void>;

const routes: Record<string, PageRenderer> = {
  "/": renderHome,
  "/integrations": renderIntegrations,
  "/create": renderCreate,
  "/pay": renderPay,
  "/merchant": renderMerchant,
  "/admin": renderAdmin,
  "/wallet": renderWallet,
  "/wallet/security": renderWallet,
  "/wallet/create": renderWallet,
  "/wallet/pair": renderWallet,
  "/wallet/send": renderWallet,
};

applyTheme(preferredTheme());
applyLocale(resolvePageLocale());

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) throw new Error("Missing #app");
const appRoot = app;

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

async function render(): Promise<void> {
  applyLocale(resolvePageLocale());
  const pathname = location.pathname;
  applyMeta(pathname);
  const route =
    routes[pathname] ??
    (pathname.startsWith("/merchant/") ? renderMerchant : pathname.startsWith("/wallet") ? renderWallet : renderHome);
  appRoot.innerHTML = shell(pathname);
  const outlet = appRoot.querySelector<HTMLElement>("#outlet");
  if (!outlet) throw new Error("Missing outlet");
  initThemeToggle(appRoot.querySelector<HTMLButtonElement>("#theme-toggle"));
  initLocaleSelect(appRoot.querySelector<HTMLSelectElement>("#locale-select"));
  await route(outlet);
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
    case "/wallet":
    case "/wallet/security":
    case "/wallet/create":
    case "/wallet/pair":
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
    void render();
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

function shell(pathname: string): string {
  const active = (href: string) =>
    pathname === href || (href !== "/" && pathname.startsWith(href));
  const link = (href: string, label: string) =>
    `<a href="${href}" data-route${active(href) ? ' aria-current="page"' : ""}>${label}</a>`;
  return `
    <header class="topbar">
      <a class="brand" href="/" data-route>
        <span class="brand-mark"><img src="/logo.svg" alt="" width="32" height="32" /></span>
        <span>${t("brand")}</span>
      </a>
      <nav>
        ${link("/", t("nav.product"))}
        ${link("/integrations", t("nav.integrations"))}
        ${link("/create", t("nav.create"))}
        ${link("/wallet", t("nav.wallet"))}
        ${link("/merchant", t("nav.merchant"))}
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
