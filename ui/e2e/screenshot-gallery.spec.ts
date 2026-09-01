import { test } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, "../screenshots");

const ROUTES = [
  "/",
  "/get-paid",
  "/security",
  "/integrations",
  "/create",
  "/pay?invalid=1",
  "/merchant",
  "/wallet",
  "/wallet/create",
  "/wallet/send",
  "/wallet/receive",
  "/wallet/cash",
  "/wallet/security",
  "/wallet/recover",
  "/wallet/deposit",
  "/admin",
  "/guardian",
];

async function setTheme(page: import("@playwright/test").Page, theme: "light" | "dark") {
  await page.addInitScript((t) => {
    localStorage.setItem("tc-theme", t);
    document.documentElement.dataset.theme = t;
    document.documentElement.classList.toggle("dark", t === "dark");
    document.documentElement.style.colorScheme = t;
  }, theme);
}

for (const theme of ["light", "dark"] as const) {
  test.describe(`screenshots ${theme}`, () => {
    for (const route of ROUTES) {
      test(`${route} desktop`, async ({ page }) => {
        await setTheme(page, theme);
        await page.setViewportSize({ width: 1280, height: 900 });
        await page.goto(route);
        await page.waitForTimeout(800);
        const safe = route.replace(/[^a-z0-9]+/gi, "_").replace(/^_|_$/g, "");
        await page.screenshot({
          path: path.join(OUT, `${theme}-1280-${safe}.png`),
          fullPage: true,
        });
      });
    }
  });
}

const MOBILE_ROUTES = ["/", "/create", "/pay?invalid=1", "/wallet", "/wallet/create"];

for (const theme of ["light", "dark"] as const) {
  test.describe(`mobile ${theme}`, () => {
    for (const route of MOBILE_ROUTES) {
      test(`${route} 390px`, async ({ page }) => {
        await setTheme(page, theme);
        await page.setViewportSize({ width: 390, height: 844 });
        await page.goto(route);
        await page.waitForTimeout(800);
        const safe = route.replace(/[^a-z0-9]+/gi, "_").replace(/^_|_$/g, "");
        await page.screenshot({
          path: path.join(OUT, `${theme}-390-${safe}.png`),
          fullPage: true,
        });
      });
    }
  });
}
