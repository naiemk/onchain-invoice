/**
 * Apply Persian translation patches to wallet-fa.ts.
 * Run: npx tsx scripts/apply-fa-i18n.mjs
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { walletFaPatches } from "./fa-wallet-patches.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const walletEnPath = join(root, "ui/src/i18n/dictionaries/wallet-en.ts");
const walletFaPath = join(root, "ui/src/i18n/dictionaries/wallet-fa.ts");

const { walletEn } = await import(walletEnPath);
const { walletFa } = await import(walletFaPath);

function escapeTs(s) {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function emitValue(key, value) {
  const escaped = escapeTs(value);
  if (value.length > 72 || value.includes("\n")) {
    return `  ${key}:\n    "${escaped}",`;
  }
  return `  ${key}: "${escaped}",`;
}

const mergedWallet = { ...walletEn };
for (const key of Object.keys(walletEn)) {
  if (walletFaPatches[key]) {
    mergedWallet[key] = walletFaPatches[key];
  } else if (walletFa[key] !== undefined) {
    mergedWallet[key] = walletFa[key];
  }
}

const walletLines = ["/** Wallet UI strings (Persian/Farsi). */", "export const walletFa = {"];
for (const key of Object.keys(walletEn)) {
  walletLines.push(emitValue(key, mergedWallet[key]));
}
walletLines.push("};", "");
writeFileSync(walletFaPath, walletLines.join("\n") + "\n");

console.log(`Updated wallet-fa.ts (${Object.keys(walletFaPatches).length} wallet patches)`);
