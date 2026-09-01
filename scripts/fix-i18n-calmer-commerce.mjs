#!/usr/bin/env node
/** Fix misplaced integration keys and add remaining Calmer Commerce i18n keys. */
import fs from "fs";
import path from "path";

const dictDir = path.join(process.cwd(), "ui/src/i18n/dictionaries");
const files = fs
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

const BAD_BLOCK = `
    breadcrumb: "INTEGRATIONS",
    connect: "Connect",
    manage: "Manage",
    statusConnected: "Connected",`;

for (const file of files) {
  let src = fs.readFileSync(path.join(dictDir, file), "utf8");
  const before = src;

  if (src.includes(BAD_BLOCK.trim())) {
    src = src.replace(BAD_BLOCK, "");
    if (!src.includes('integrations: {\n    breadcrumb: "INTEGRATIONS"')) {
      src = src.replace(/(integrations:\s*\{\s*\n\s*eyebrow:[^\n]+\n)/, `$1    breadcrumb: "INTEGRATIONS",\n`);
      src = src.replace(
        /(integrations:[\s\S]*?ctaLede:[^\n]+\n)/,
        `$1    connect: "Connect",\n    manage: "Manage",\n    statusConnected: "Connected",\n`
      );
    }
  }

  if (!src.includes('getPaid: {\n    breadcrumb: "GET PAID"')) {
    src = src.replace(/\n  getPaid: \{\n/, `\n  getPaid: {\n    breadcrumb: "GET PAID",\n`);
  }
  if (!src.includes('home: {\n    eyebrow:')) {
    src = src.replace(/\n  home: \{\n/, `\n  home: {\n    eyebrow: "A calmer way to run money",\n`);
  }
  if (!src.includes('securityPage: {\n    breadcrumb:')) {
    src = src.replace(/\n  securityPage: \{\n/, `\n  securityPage: {\n    breadcrumb: "SECURITY",\n`);
  }

  if (src !== before) {
    fs.writeFileSync(path.join(dictDir, file), src);
    console.log("fixed", file);
  }
}

console.log("done");
