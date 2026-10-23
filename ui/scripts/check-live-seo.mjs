// Post-deploy / scheduled monitor for the live site. Usage: node check-live-seo.mjs [origin]
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const { indexable } = JSON.parse(readFileSync(join(root, "ui/src/shared/seo-routes.json"), "utf8"));
const origin = (process.argv[2] ?? "https://trustless-commerce.com").replace(/\/$/, "");
const fail = [];
const get = (p) => fetch(origin + p, { redirect: "manual", headers: { "user-agent": "tc-seo-monitor" } });

for (const path of indexable) {
  const res = await get(path);
  const html = await res.text();
  if (res.status !== 200) { fail.push(`${path}: HTTP ${res.status}`); continue; }
  const canon = html.match(/<link rel="canonical" href="([^"]*)"/)?.[1];
  if (canon !== `https://trustless-commerce.com${path}`) fail.push(`${path}: canonical ${canon}`);
  if (!/<h1[\s>]/.test(html)) fail.push(`${path}: no <h1> in initial HTML (prerender missing?)`);
  if (/noindex/.test(html.match(/<meta name="robots"[^>]*>/)?.[0] ?? "")) fail.push(`${path}: noindex`);
}
const robots = await (await get("/robots.txt")).text();
if (!robots.includes("Sitemap: https://trustless-commerce.com/sitemap.xml")) fail.push("robots.txt: wrong sitemap line");
const sm = await (await get("/sitemap.xml")).text();
for (const path of indexable) if (!sm.includes(`<loc>https://trustless-commerce.com${path}</loc>`)) fail.push(`sitemap missing ${path}`);
if (/trustlesscommerce\.app/.test(sm + robots)) fail.push("old host in robots/sitemap");
const nf = await get("/this-route-should-not-exist-seo-test");
if (nf.status !== 404) fail.push(`unknown route returned ${nf.status}, expected 404`);

if (fail.length) { console.error("Live SEO check failed:\n" + fail.join("\n")); process.exit(1); }
console.log(`Live SEO check OK for ${origin} (${indexable.length} routes)`);
