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

const newKeys = [
  "superWalletPolicyTitle",
  "superWalletThreshold",
  "superWalletApplyPolicy",
  "superWalletAddPasskey",
  "superWalletAddYubiKey",
  "superWalletConnectWallet",
  "superWalletConnectWalletHint",
  "superWalletEnrollPasskey",
  "superWalletEnrollYubiKey",
  "superWalletKeyPasskey",
  "superWalletKeyYubiKey",
  "superWalletKeyEoa",
  "superWalletNoSigningKey",
];

const block = newKeys.map((k) => `  ${k}: ${extractKey(enText, k)},`).join("\n");

for (const file of fs.readdirSync(dir).filter((f) => f.startsWith("wallet-") && f !== "wallet-en.ts")) {
  const p = path.join(dir, file);
  let text = fs.readFileSync(p, "utf8");
  if (text.includes("superWalletPolicyTitle:")) {
    console.log("skip", file);
    continue;
  }
  text = text.replace(/\n\};\s*$/, `\n${block}\n};\n`);
  fs.writeFileSync(p, text);
  console.log("patched", file);
}
