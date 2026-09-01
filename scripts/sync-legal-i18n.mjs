import fs from "fs";
import path from "path";

const dir = "ui/src/i18n/dictionaries";
const locales = fs
  .readdirSync(dir)
  .filter(
    (f) =>
      /^[a-z]/.test(f) &&
      f.endsWith(".ts") &&
      f !== "en.ts" &&
      f !== "index.ts" &&
      !f.startsWith("wallet-") &&
      !f.startsWith("create-") &&
      !f.startsWith("onramp-") &&
      !f.startsWith("pay-")
  );

const footerBlock = `  footer: {
    settlementLine: "Settlement bound to your merchant wallet",
    legal: "Legal",
    terms: "Terms",
    privacy: "Privacy",
    cookies: "Cookies",
    risks: "Risks",
    securityChecks: "Security checks",
  },

  legal: {
    breadcrumb: "Legal",
    hubTitle: "Legal documents",
    hubLede: "Terms, privacy, and security information for Trustless Commerce.",
    hubLink: "← All legal documents",
    lastUpdated: "Last updated",
    englishNotice: "These documents are provided in English and apply regardless of your selected UI language.",
  },`;

for (const file of locales) {
  const p = path.join(dir, file);
  let text = fs.readFileSync(p, "utf8");
  if (!text.includes("developers:")) {
    text = text.replace(
      /(    security: [^\n]+,\n)(    openWorkspace:)/,
      `$1    developers: "Developers",\n$2`
    );
    fs.writeFileSync(p, text);
    console.log("patched nav.developers", file);
  }
  if (!text.includes("footer.legal") && !text.includes('legal: "Legal"')) {
    text = text.replace(
      /  footer: \{\n    settlementLine: "Settlement bound to your merchant wallet",\n  \},\n\} satisfies Messages;/,
      `${footerBlock}\n} satisfies Messages;`
    );
    fs.writeFileSync(p, text);
    console.log("patched footer+legal", file);
  } else if (!text.includes("hubTitle:")) {
    text = text.replace(
      /  footer: \{\n    settlementLine: "Settlement bound to your merchant wallet",\n    legal: "Legal",[\s\S]*?securityChecks: "Security checks",\n  \},\n\} satisfies Messages;/,
      `${footerBlock}\n} satisfies Messages;`
    );
    if (!text.includes("hubTitle:")) {
      text = text.replace(/\n\} satisfies Messages;/, `\n\n${footerBlock}\n} satisfies Messages;`);
    }
    fs.writeFileSync(p, text);
    console.log("patched legal block", file);
  } else {
    console.log("skip footer", file);
  }
}
