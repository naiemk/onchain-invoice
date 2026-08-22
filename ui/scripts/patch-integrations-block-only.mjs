#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const data = JSON.parse(readFileSync(join(__dirname, "integrations-i18n-data.json"), "utf8"));

const FILE_MAP = {
  es: "es.ts", "zh-Hans": "zh-Hans.ts", "zh-Hant": "zh-Hant.ts", ar: "ar.ts", hi: "hi.ts",
  "pt-BR": "pt-BR.ts", bn: "bn.ts", ru: "ru.ts", ja: "ja.ts", de: "de.ts", fr: "fr.ts",
  id: "id.ts", ko: "ko.ts", tr: "tr.ts", it: "it.ts", vi: "vi.ts", th: "th.ts", pl: "pl.ts",
  nl: "nl.ts", uk: "uk.ts", fa: "fa.ts", ms: "ms.ts", he: "he.ts", ur: "ur.ts",
};

function escape(str) {
  return str.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function buildIntegrationsBlock(t) {
  const platforms = ["woocommerce", "shopify", "kajabi", "teachable", "bigcommerce", "lemonsqueezy", "gumroad"];
  const platformLines = platforms
    .map(
      (id) => `      ${id}: {
        name: "${escape(t[`integrations.platforms.${id}.name`])}",
        description:
          "${escape(t[`integrations.platforms.${id}.description`])}",
      }`
    )
    .join(",\n");

  return `
  integrations: {
    eyebrow: "${escape(t["integrations.eyebrow"])}",
    title: "${escape(t["integrations.title"])}",
    lede:
      "${escape(t["integrations.lede"])}",
    contractEyebrow: "${escape(t["integrations.contractEyebrow"])}",
    contractTitle: "${escape(t["integrations.contractTitle"])}",
    contractBody:
      "${escape(t["integrations.contractBody"])}",
    contractLink: "${escape(t["integrations.contractLink"])}",
    sdkLink: "${escape(t["integrations.sdkLink"])}",
    wave1: "${escape(t["integrations.wave1"])}",
    wave2: "${escape(t["integrations.wave2"])}",
    wave3: "${escape(t["integrations.wave3"])}",
    statusAvailable: "${escape(t["integrations.statusAvailable"])}",
    statusPreview: "${escape(t["integrations.statusPreview"])}",
    docs: "${escape(t["integrations.docs"])}",
    aiSkill: "${escape(t["integrations.aiSkill"])}",
    ctaTitle: "${escape(t["integrations.ctaTitle"])}",
    ctaLede: "${escape(t["integrations.ctaLede"])}",
    platforms: {
${platformLines},
    },
  },`;
}

for (const [locale, filename] of Object.entries(FILE_MAP)) {
  const path = join(__dirname, "../src/i18n/dictionaries", filename);
  let src = readFileSync(path, "utf8");
  if (src.includes("\n  integrations: {\n")) {
    console.log(`Skip ${locale}`);
    continue;
  }
  const t = data[locale];
  src = src.replace(/\n\} satisfies Messages;\s*$/, `\n${buildIntegrationsBlock(t)}\n} satisfies Messages;\n`);
  writeFileSync(path, src);
  console.log(`Added integrations block: ${locale}`);
}
