/** ISO-3166 alpha-2 country combobox helpers. Names via Intl.DisplayNames. */

import { escapeHtml } from "../../shared/dom.js";
import { getLocale } from "../../i18n/t.js";

/** Common onramp markets first; remaining ISO codes follow alphabetically by display name. */
const PRIORITY = [
  "se",
  "us",
  "gb",
  "de",
  "fr",
  "nl",
  "es",
  "it",
  "pt",
  "ie",
  "at",
  "be",
  "fi",
  "dk",
  "no",
  "pl",
  "cz",
  "ch",
  "ca",
  "au",
  "nz",
  "jp",
  "kr",
  "sg",
  "hk",
  "ae",
  "br",
  "mx",
  "in",
];

const ALL_CODES = (() => {
  // A-Z A-Z — generate full ISO-3166-1 alpha-2 set that Intl recognizes.
  const codes: string[] = [];
  for (let a = 65; a <= 90; a++) {
    for (let b = 65; b <= 90; b++) {
      codes.push(String.fromCharCode(a, b).toLowerCase());
    }
  }
  return codes;
})();

export type CountryOption = { code: string; name: string };

export function listCountries(locale = getLocale()): CountryOption[] {
  let display: Intl.DisplayNames | null = null;
  try {
    display = new Intl.DisplayNames([locale, "en"], { type: "region" });
  } catch {
    try {
      display = new Intl.DisplayNames(["en"], { type: "region" });
    } catch {
      display = null;
    }
  }
  const named: CountryOption[] = [];
  for (const code of ALL_CODES) {
    const name = display?.of(code.toUpperCase());
    if (!name || name === code.toUpperCase()) continue;
    named.push({ code, name });
  }
  named.sort((a, b) => a.name.localeCompare(b.name, locale));
  const prioritySet = new Set(PRIORITY);
  const head = PRIORITY.map((code) => named.find((n) => n.code === code)).filter(
    (n): n is CountryOption => Boolean(n)
  );
  const rest = named.filter((n) => !prioritySet.has(n.code));
  return [...head, ...rest];
}

export function countryDatalistHtml(id: string, locale = getLocale()): string {
  const options = listCountries(locale)
    .map(
      (c) =>
        `<option value="${escapeHtml(c.code)}" label="${escapeHtml(`${c.name} (${c.code.toUpperCase()})`)}">${escapeHtml(c.name)}</option>`
    )
    .join("");
  return `<datalist id="${escapeHtml(id)}">${options}</datalist>`;
}
