// Asserts prerendered HTML in dist-ui is crawlable without JavaScript.
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const dist = join(root, "dist-ui");
const { indexable, appOnly } = JSON.parse(readFileSync(join(root, "ui/src/shared/seo-routes.json"), "utf8"));
const ORIGIN = "https://trustless-commerce.com";
const fail = [];
const titles = new Map();
const descs = new Map();

const textOf = (html) =>
  html.replace(/<(script|style)[\s\S]*?<\/\1>/g, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

for (const path of indexable) {
  const file = join(dist, path === "/" ? "" : path, "index.html");
  if (!existsSync(file)) { fail.push(`${path}: missing ${file}`); continue; }
  const html = readFileSync(file, "utf8");
  const title = html.match(/<title>([^<]*)<\/title>/)?.[1];
  const desc = html.match(/<meta name="description" content="([^"]*)"/)?.[1];
  const canon = html.match(/<link rel="canonical" href="([^"]*)"/)?.[1];
  const h1s = (html.match(/<h1[\s>]/g) ?? []).length;
  const robots = html.match(/<meta name="robots" content="([^"]*)"/)?.[1];
  const ogUrl = html.match(/<meta property="og:url" content="([^"]*)"/)?.[1];
  if (ogUrl !== ORIGIN + path) fail.push(`${path}: og:url ${ogUrl}`);
  for (const m of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
    try { JSON.parse(m[1]); } catch { fail.push(`${path}: invalid JSON-LD`); }
  }
  if (!title) fail.push(`${path}: no title`);
  if (!desc) fail.push(`${path}: no description`);
  if (canon !== ORIGIN + path) fail.push(`${path}: canonical ${canon}`);
  if (h1s !== 1) fail.push(`${path}: ${h1s} h1 elements`);
  if (robots?.includes("noindex")) fail.push(`${path}: noindex on indexable route`);
  if (textOf(html).length < 300) fail.push(`${path}: less than 300 chars of visible text`);
  if (/trustlesscommerce\.app/.test(html)) fail.push(`${path}: references old host`);
  for (const [map, v, label] of [[titles, title, "title"], [descs, desc, "description"]]) {
    if (v && map.has(v)) fail.push(`${path}: duplicate ${label} (also ${map.get(v)})`);
    else if (v) map.set(v, path);
  }
}

// Internal links on prerendered pages must resolve to a known route (no broken nav).
const known = new Set([...indexable, ...appOnly]);
for (const path of indexable) {
  const html = readFileSync(join(dist, path === "/" ? "" : path, "index.html"), "utf8");
  for (const m of html.matchAll(/<a [^>]*href="(\/[^"#?]*)/g)) {
    const href = m[1].length > 1 ? m[1].replace(/\/$/, "") : m[1];
    const ok = known.has(href) || [...appOnly].some((r) => href.startsWith(r + "/")) || existsSync(join(dist, href));
    if (!ok) fail.push(`${path}: broken internal link ${href}`);
  }
}

const sm = readFileSync(join(dist, "sitemap.xml"), "utf8");
const locs = [...sm.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
if (new Set(locs).size !== locs.length) fail.push("sitemap: duplicates");
for (const p of appOnly) if (locs.includes(ORIGIN + p)) fail.push(`sitemap contains app-only ${p}`);
if (locs.length !== indexable.length) fail.push("sitemap/indexable mismatch");

const nf = readFileSync(join(dist, "404.html"), "utf8");
if (!/name="robots" content="noindex/.test(nf)) fail.push("404.html: not noindex");
if (/rel="canonical"/.test(nf)) fail.push("404.html: has canonical");

if (fail.length) { console.error("SEO check failed:\n" + fail.join("\n")); process.exit(1); }
console.log(`SEO check OK (${indexable.length} routes)`);
