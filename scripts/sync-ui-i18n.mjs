#!/usr/bin/env node
/**
 * Copy missing message keys from en.ts / wallet-en.ts into other locale files (English fallback).
 */
import fs from "fs";
import path from "path";
import { pathToFileURL } from "url";

const root = process.cwd();
const dictDir = path.join(root, "ui/src/i18n/dictionaries");

const localeFiles = fs
  .readdirSync(dictDir)
  .filter(
    (f) =>
      f.endsWith(".ts") &&
      f !== "en.ts" &&
      f !== "index.ts" &&
      !f.startsWith("wallet-") &&
      !f.startsWith("create-") &&
      !f.startsWith("onramp-") &&
      !f.startsWith("pay-")
  );

const walletLocaleFiles = fs.readdirSync(dictDir).filter((f) => f.startsWith("wallet-") && f !== "wallet-en.ts");

function exportName(file) {
  const base = file.replace(/\.ts$/, "");
  if (base === "pt-BR") return "ptBR";
  if (base.startsWith("wallet-")) {
    const tail = base.slice("wallet-".length);
    if (tail === "pt-BR") return "walletPtBR";
    if (tail.startsWith("zh-")) return "wallet" + tail.replace("-", "");
    return "wallet" + tail.charAt(0).toUpperCase() + tail.slice(1);
  }
  if (base.startsWith("zh-")) return base.replace("-", "");
  return base;
}

async function loadModule(relPath) {
  const mod = await import(pathToFileURL(path.join(root, relPath)).href);
  return mod[exportName(path.basename(relPath))];
}

function leafPaths(value, prefix = "") {
  if (typeof value === "string") return [prefix];
  if (!value || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([key, child]) => leafPaths(child, prefix ? `${prefix}.${key}` : key));
}

function getAt(obj, dotted) {
  return dotted.split(".").reduce((node, part) => (node && typeof node === "object" ? node[part] : undefined), obj);
}

function escapeString(value) {
  return JSON.stringify(value);
}

function insertKeyInBlock(src, parentKey, key, value) {
  if (src.includes(`${parentKey}: {`) && new RegExp(`${parentKey}:\\s*\\{[\\s\\S]*?\\b${key}:`).test(src)) {
    return src;
  }
  const parentRe = new RegExp(`(\\b${parentKey}:\\s*\\{)([\\s\\S]*?)(\\n\\s*\\},)`, "m");
  const m = src.match(parentRe);
  if (!m) throw new Error(`parent block ${parentKey} not found in file`);
  const blockBody = m[2];
  const indent = blockBody.match(/\n(\s+)\w+:/)?.[1] ?? "    ";
  const insertion = `\n${indent}${key}: ${escapeString(value)},`;
  return src.replace(parentRe, `$1${blockBody}${insertion}$3`);
}

function insertRootBlock(src, blockKey, entries) {
  if (src.includes(`${blockKey}:`)) {
    let out = src;
    for (const [key, value] of Object.entries(entries)) {
      out = insertKeyInBlock(out, blockKey, key, value);
    }
    return out;
  }
  const block = `\n  ${blockKey}: {\n${Object.entries(entries)
    .map(([k, v]) => `    ${k}: ${escapeString(v)},`)
    .join("\n")}\n  },`;
  return src.replace(/\n\} satisfies Messages;\s*$/, `${block}\n} satisfies Messages;\n`);
}

function patchMainLocale(file, enMessages, localeMessages) {
  const missing = leafPaths(enMessages).filter((p) => !p.startsWith("wallet.") && getAt(localeMessages, p) === undefined);
  if (missing.length === 0) return false;

  let src = fs.readFileSync(path.join(dictDir, file), "utf8");
  const byParent = new Map();
  for (const dotted of missing) {
    const parts = dotted.split(".");
    const key = parts.pop();
    const parent = parts.join(".");
    if (!byParent.has(parent)) byParent.set(parent, []);
    byParent.get(parent).push([key, getAt(enMessages, dotted)]);
  }

  for (const [parent, pairs] of [...byParent.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (parent.includes(".")) {
      const top = parent.split(".")[0];
      for (const [key, value] of pairs) {
        src = insertKeyInBlock(src, top, key, value);
      }
      continue;
    }
    if (parent === "footer" && !src.includes("footer:")) {
      src = insertRootBlock(src, "footer", Object.fromEntries(pairs));
      continue;
    }
    for (const [key, value] of pairs) {
      src = insertKeyInBlock(src, parent, key, value);
    }
  }

  fs.writeFileSync(path.join(dictDir, file), src);
  console.log("patched main", file, missing.length, "keys");
  return true;
}

function patchWalletLocale(file, enWallet, localeWallet) {
  const missing = leafPaths(enWallet).filter((p) => getAt(localeWallet, p) === undefined);
  if (missing.length === 0) return false;

  let src = fs.readFileSync(path.join(dictDir, file), "utf8");
  const inserts = [];
  for (const dotted of missing) {
    const key = dotted.includes(".") ? dotted.split(".").pop() : dotted;
    if (src.includes(`${key}:`)) continue;
    inserts.push(`  ${key}: ${escapeString(getAt(enWallet, dotted))},`);
  }
  if (inserts.length === 0) return false;
  src = src.replace(/\n\};\s*$/, `\n${inserts.join("\n")}\n};\n`);
  fs.writeFileSync(path.join(dictDir, file), src);
  console.log("patched wallet", file, inserts.length, "keys");
  return true;
}

const en = await loadModule("ui/src/i18n/dictionaries/en.ts");
const enWallet = await loadModule("ui/src/i18n/dictionaries/wallet-en.ts");

for (const file of localeFiles) {
  const locale = await loadModule(`ui/src/i18n/dictionaries/${file}`);
  patchMainLocale(file, en, locale);
}

for (const file of walletLocaleFiles) {
  const localeWallet = await loadModule(`ui/src/i18n/dictionaries/${file}`);
  patchWalletLocale(file, enWallet, localeWallet);
}

console.log("done");
