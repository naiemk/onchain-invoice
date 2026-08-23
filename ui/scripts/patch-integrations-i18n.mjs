#!/usr/bin/env node
/**
 * Patches locale dictionary files with integrations i18n keys from integrations-i18n-data.json
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const data = JSON.parse(readFileSync(join(__dirname, "integrations-i18n-data.json"), "utf8"));

const FILE_MAP = {
  es: "es.ts",
  "zh-Hans": "zh-Hans.ts",
  "zh-Hant": "zh-Hant.ts",
  ar: "ar.ts",
  hi: "hi.ts",
  "pt-BR": "pt-BR.ts",
  bn: "bn.ts",
  ru: "ru.ts",
  ja: "ja.ts",
  de: "de.ts",
  fr: "fr.ts",
  id: "id.ts",
  ko: "ko.ts",
  tr: "tr.ts",
  it: "it.ts",
  vi: "vi.ts",
  th: "th.ts",
  pl: "pl.ts",
  nl: "nl.ts",
  uk: "uk.ts",
  fa: "fa.ts",
  ms: "ms.ts",
  he: "he.ts",
  ur: "ur.ts",
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
  const t = data[locale];
  if (!t) {
    console.error(`Missing translations for ${locale}`);
    process.exit(1);
  }

  const path = join(__dirname, "../src/i18n/dictionaries", filename);
  let src = readFileSync(path, "utf8");

  if (src.includes("integrations: {\n")) {
    console.log(`Skip ${locale} (already patched)`);
    continue;
  }

  // nav.integrations after product line
  src = src.replace(
    /(nav:\s*\{[^}]*?product:\s*"[^"]*",)\n(\s*create:)/s,
    `$1\n    integrations: "${escape(t["nav.integrations"])}",\n$2`
  );

  // meta integrations before adminTitle
  src = src.replace(
    /(merchantDescription:\s*"[^"]*",)\n(\s*adminTitle:)/s,
    `$1\n    integrationsTitle: "${escape(t["meta.integrationsTitle"])}",\n    integrationsDescription:\n      "${escape(t["meta.integrationsDescription"])}",\n$2`
  );

  // home integrations before whyEyebrow
  src = src.replace(
    /(agentsDocs:\s*"[^"]*",)\n(\s*whyEyebrow:)/s,
    `$1\n    integrationsEyebrow: "${escape(t["home.integrationsEyebrow"])}",\n    integrationsTitle: "${escape(t["home.integrationsTitle"])}",\n    integrationsLede:\n      "${escape(t["home.integrationsLede"])}",\n    integrationsCta: "${escape(t["home.integrationsCta"])}",\n$2`
  );

  // integrations block before final closing
  src = src.replace(/\n\} satisfies Messages;\s*$/, `\n${buildIntegrationsBlock(t)}\n} satisfies Messages;\n`);

  writeFileSync(path, src);
  console.log(`Patched ${locale}`);
}

console.log("Done.");
