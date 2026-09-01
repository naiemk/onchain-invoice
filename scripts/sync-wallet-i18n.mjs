import fs from "fs";
import path from "path";

const dir = "ui/src/i18n/dictionaries";
const enText = fs.readFileSync(path.join(dir, "wallet-en.ts"), "utf8");

function extractKey(text, key) {
  const re = new RegExp(`^\\s+${key}:\\s*([\\s\\S]*?)(?:,\\n)(?=\\s+\\w+:|\\s*\\};)`, "m");
  const m = text.match(re);
  if (!m) throw new Error(`missing ${key}`);
  return m[1].trim();
}

/** Keys to copy from wallet-en.ts when absent in other locales (English fallback). */
const keysToSync = [
  "superWalletTab",
  "superWalletConvertCta",
  "superWalletFeaturesTitle",
  "superWalletFeatureMultisig",
  "superWalletFeatureMixedKeys",
  "superWalletFeatureProposals",
  "superWalletFeatureIrreversible",
  "superWalletEmailWhyTitle",
  "superWalletEmailWhy",
  "superWalletTeamJoinTitle",
  "superWalletTeamJoinIntro",
  "superWalletTeamJoinStep1",
  "superWalletTeamJoinStep2",
  "superWalletTeamJoinStep3",
  "superWalletHomeBanner",
  "superWalletHomeCta",
];

for (const file of fs.readdirSync(dir).filter((f) => f.startsWith("wallet-") && f !== "wallet-en.ts")) {
  const p = path.join(dir, file);
  let text = fs.readFileSync(p, "utf8");
  const missing = keysToSync.filter((k) => !text.includes(`${k}:`));
  if (missing.length === 0) {
    console.log("skip", file);
    continue;
  }
  const insert = missing.map((k) => `  ${k}: ${extractKey(enText, k)},`).join("\n");
  if (text.includes("superWalletLede:")) {
    text = text.replace(
      /(^\s+superWalletLede:[\s\S]*?,)(\n)/m,
      `$1\n${insert}$2`
    );
  } else {
    text = text.replace(/\n\};\s*$/, `\n${insert}\n};\n`);
  }
  // Refresh updated English strings where keys already existed with old copy.
  for (const k of ["superWalletAdminEmail", "superWalletUpgradeCta"]) {
    if (text.includes(`${k}:`)) {
      const val = extractKey(enText, k);
      text = text.replace(new RegExp(`^\\s+${k}:\\s*[\\s\\S]*?,`, "m"), `  ${k}: ${val},`);
    }
  }
  fs.writeFileSync(p, text);
  console.log("patched", file, missing.join(", "));
}
