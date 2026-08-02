import "./styles.css";
import { renderAdmin } from "./pages/admin.js";
import { renderCreate } from "./pages/create.js";
import { renderHome } from "./pages/home.js";
import { renderMerchant } from "./pages/merchant.js";
import { renderPay } from "./pages/pay.js";
import { SITE } from "./shared/site.js";
import { applyTheme, initThemeToggle, preferredTheme } from "./shared/theme.js";

export type PageRenderer = (root: HTMLElement) => void | Promise<void>;

const routes: Record<string, PageRenderer> = {
  "/": renderHome,
  "/create": renderCreate,
  "/pay": renderPay,
  "/merchant": renderMerchant,
  "/admin": renderAdmin,
};

const pageMeta: Record<string, { title: string; description: string }> = {
  "/": {
    title: "Trustless Commerce",
    description: "Accept crypto payments with deterministic on-chain invoices. No account, no KYC.",
  },
  "/create": {
    title: "Create invoice · Trustless Commerce",
    description: "Build a crypto payment link and share it with your customer.",
  },
  "/pay": {
    title: "Pay invoice · Trustless Commerce",
    description: "Pay a Trustless Commerce crypto invoice on-chain.",
  },
  "/merchant": {
    title: "Merchant · Trustless Commerce",
    description: "View and manage your Trustless Commerce invoices.",
  },
  "/admin": {
    title: "Admin · Trustless Commerce",
    description: "Platform admin overview.",
  },
};

applyTheme(preferredTheme());

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
  const pathname = location.pathname;
  applyMeta(pathname);
  const route =
    routes[pathname] ??
    (pathname.startsWith("/merchant/") ? renderMerchant : renderHome);
  appRoot.innerHTML = shell(pathname);
  const outlet = appRoot.querySelector<HTMLElement>("#outlet");
  if (!outlet) throw new Error("Missing outlet");
  initThemeToggle(appRoot.querySelector<HTMLButtonElement>("#theme-toggle"));
  await route(outlet);
}

function applyMeta(pathname: string): void {
  const key = pathname.startsWith("/merchant") ? "/merchant" : pathname;
  const meta = pageMeta[key] ?? pageMeta["/"];
  document.title = meta.title;
  const desc = document.querySelector('meta[name="description"]');
  if (desc) desc.setAttribute("content", meta.description);
}

function shell(pathname: string): string {
  const active = (href: string) =>
    pathname === href || (href !== "/" && pathname.startsWith(href));
  const link = (href: string, label: string) =>
    `<a href="${href}" data-route${active(href) ? ' aria-current="page"' : ""}>${label}</a>`;
  return `
    <header class="topbar">
      <a class="brand" href="/" data-route>
        <span class="brand-mark"><img src="/logo-64.png" alt="" width="32" height="32" /></span>
        <span>Trustless Commerce</span>
      </a>
      <nav>
        ${link("/", "Product")}
        ${link("/create", "Create invoice")}
        ${link("/merchant", "Merchant")}
        <a href="${SITE.docsUrl}" target="_blank" rel="noopener noreferrer">Docs</a>
        <button type="button" class="theme-toggle" id="theme-toggle" aria-pressed="false" aria-label="Switch theme"></button>
      </nav>
    </header>
    <main id="outlet"></main>
    <footer class="site-footer global-footer">
      <span>Trustless Commerce</span>
      <span>
        <a href="${SITE.docsUrl}" target="_blank" rel="noopener noreferrer">Docs</a>
        ·
        <a href="${SITE.githubUrl}" target="_blank" rel="noopener noreferrer">GitHub</a>
        ·
        <a href="${SITE.telegramChannel}" target="_blank" rel="noopener noreferrer">Telegram</a>
        ·
        <a href="${SITE.telegramSupport}" target="_blank" rel="noopener noreferrer">Support</a>
      </span>
    </footer>
  `;
}
