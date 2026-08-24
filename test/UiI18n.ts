import { expect } from "chai";
import { localeFromSearch, matchLocale, preferredLocale, resolvePageLocale } from "../ui/src/i18n/detect.js";
import { dictionaries } from "../ui/src/i18n/dictionaries/index.js";
import { en } from "../ui/src/i18n/dictionaries/en.js";
import { LOCALES, RTL_LOCALES, isLocale } from "../ui/src/i18n/locales.js";
import { interpolate, tFor } from "../ui/src/i18n/t.js";

function leafKeys(value: unknown, prefix = ""): string[] {
  if (typeof value === "string") return [prefix];
  if (!value || typeof value !== "object") return [];
  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
    leafKeys(child, prefix ? `${prefix}.${key}` : key)
  );
}

describe("UI i18n", function () {
  it("maps BCP-47 aliases to product locales", function () {
    expect(matchLocale("zh-CN")).to.equal("zh-Hans");
    expect(matchLocale("zh-TW")).to.equal("zh-Hant");
    expect(matchLocale("zh-HK")).to.equal("zh-Hant");
    expect(matchLocale("zh")).to.equal("zh-Hans");
    expect(matchLocale("pt")).to.equal("pt-BR");
    expect(matchLocale("pt-PT")).to.equal("pt-BR");
    expect(matchLocale("ar-SA")).to.equal("ar");
    expect(matchLocale("en-US")).to.equal("en");
    expect(matchLocale("fa-IR")).to.equal("fa");
    expect(matchLocale("he-IL")).to.equal("he");
    expect(matchLocale("ur-PK")).to.equal("ur");
    expect(matchLocale(["fr-CA", "es"])).to.equal("fr");
    expect(matchLocale("xx-YY")).to.equal("en");
  });

  it("prefers a stored locale over navigator languages", function () {
    expect(preferredLocale("ja", ["es-MX", "en-US"])).to.equal("ja");
    expect(preferredLocale(null, ["ar-EG"])).to.equal("ar");
    expect(preferredLocale("not-a-locale", ["de-DE"])).to.equal("de");
  });

  it("prefers URL lang over stored locale on pay links", function () {
    expect(localeFromSearch("?lang=fa")).to.equal("fa");
    expect(localeFromSearch("lang=pt-BR")).to.equal("pt-BR");
    expect(localeFromSearch("?locale=zh-TW")).to.equal("zh-Hant");
    expect(localeFromSearch("")).to.equal(null);
    expect(resolvePageLocale("?lang=de")).to.equal("de");
  });

  it("keeps RTL locales aligned with html dir", function () {
    expect([...RTL_LOCALES].sort()).to.deep.equal(["ar", "fa", "he", "ur"]);
  });

  it("interpolates placeholders without dropping unmatched tokens", function () {
    expect(interpolate("Pay ${price} with crypto", { price: "10.00" })).to.equal("Pay $10.00 with crypto");
    expect(interpolate("Chain {chainId}", { chainId: "8453" })).to.equal("Chain 8453");
    expect(interpolate("Hello {name}", {})).to.equal("Hello {name}");
  });

  it("falls back to English for tFor", function () {
    expect(tFor("en", "nav.product")).to.equal("Product");
    expect(tFor("en", "create.payWithCrypto", { price: "12.00" })).to.equal("Pay $12.00 with crypto");
  });

  it("ships every locale with the English key set", function () {
    const expected = leafKeys(en).sort();
    expect(expected.length).to.be.greaterThan(200);
    for (const locale of LOCALES) {
      expect(isLocale(locale)).to.equal(true);
      const keys = leafKeys(dictionaries[locale]).sort();
      expect(keys, locale).to.deep.equal(expected);
    }
  });

  it("preserves interpolation placeholders in every locale", function () {
    const placeholder = /\{(\w+)\}/g;
    const names = (value: string) => [...value.matchAll(placeholder)].map((m) => m[1]).sort();
    for (const key of leafKeys(en)) {
      const english = tFor("en", key as Parameters<typeof tFor>[1]);
      const expected = names(english);
      if (expected.length === 0) continue;
      for (const locale of LOCALES) {
        if (locale === "en") continue;
        expect(names(tFor(locale, key as Parameters<typeof tFor>[1])), `${locale} ${key}`).to.deep.equal(expected);
      }
    }
  });
});
