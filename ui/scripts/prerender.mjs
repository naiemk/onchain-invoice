// Post-build: snapshot indexable routes with headless Chromium into dist-ui/<route>/index.html,
// write sitemap.xml from ui/src/shared/seo-routes.json and 404.html. Marketing pages only —
// no API/private data is fetched on these routes.
import { chromium } from "playwright-core";
import { createServer } from "node:http";
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from "node:fs";
import { join, extname, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const dist = join(root, "dist-ui");
const { indexable } = JSON.parse(readFileSync(join(root, "ui/src/shared/seo-routes.json"), "utf8"));
const ORIGIN = "https://trustless-commerce.com";
const MIME = { ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".svg": "image/svg+xml", ".ico": "image/x-icon", ".json": "application/json", ".woff2": "font/woff2" };
const shell = readFileSync(join(dist, "index.html"));

const server = createServer((req, res) => {
  const path = decodeURIComponent(new URL(req.url, "http://x").pathname);
  const file = join(dist, path);
  if (file.startsWith(dist) && existsSync(file) && statSync(file).isFile() && path !== "/") {
    res.writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream" });
    res.end(readFileSync(file));
  } else {
    res.writeHead(200, { "content-type": "text/html" });
    res.end(shell); // SPA fallback to the pristine shell (never an already-prerendered file)
  }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch();
const context = await browser.newContext({ locale: "en-US", colorScheme: "light" });
const errors = [];

async function snapshot(path) {
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(`${path}: ${e.message}`));
  await page.goto(base + path, { waitUntil: "networkidle" });
  await page.waitForSelector("h1");
  await page.waitForFunction(() => document.title && document.querySelector('meta[name="robots"]'));
  const html = "<!doctype html>\n" + (await page.evaluate(() => document.documentElement.outerHTML));
  await page.close();
  return html;
}

for (const path of indexable) {
  const out = path === "/" ? join(dist, "index.html") : join(dist, path, "index.html");
  const html = await snapshot(path);
  if (path !== "/") mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, html);
  console.log(`prerendered ${path}`);
}
writeFileSync(join(dist, "404.html"), await snapshot("/__not-found__"));
console.log("prerendered 404.html");

await browser.close();
server.close();
if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}

writeFileSync(
  join(dist, "sitemap.xml"),
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    indexable.map((p) => `  <url><loc>${ORIGIN}${p}</loc></url>\n`).join("") +
    `</urlset>\n`
);
