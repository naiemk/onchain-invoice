import "./styles.css";
import { renderAdmin } from "./pages/admin.js";
import { renderHome } from "./pages/home.js";
import { renderMerchant } from "./pages/merchant.js";
import { renderPay } from "./pages/pay.js";

export type PageRenderer = (root: HTMLElement) => void | Promise<void>;

const routes: Record<string, PageRenderer> = {
  "/": renderHome,
  "/pay": renderPay,
  "/merchant": renderMerchant,
  "/admin": renderAdmin,
};

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
  const route = routes[location.pathname] ?? renderHome;
  appRoot.innerHTML = shell();
  const outlet = appRoot.querySelector<HTMLElement>("#outlet");
  if (!outlet) throw new Error("Missing outlet");
  await route(outlet);
}

function shell(): string {
  return `
    <header class="topbar">
      <a class="brand" href="/" data-route>
        <span class="brand-mark">TC</span>
        <span>Trustless Commerce</span>
      </a>
      <nav>
        <a href="/" data-route>Home</a>
        <a href="/pay" data-route>Pay</a>
        <a href="/merchant" data-route>Merchant</a>
        <a href="/admin" data-route>Admin</a>
      </nav>
    </header>
    <main id="outlet"></main>
  `;
}
