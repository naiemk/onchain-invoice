import {
  DEFAULT_LOCALE,
  isLocale,
  isRtlLocale,
  LOCALE_BCP47,
  type Locale,
} from "./locales.js";

export const LOCALE_STORAGE_KEY = "tc-locale";

/** Explicit aliases (language tags → product locale). */
const ALIASES: Record<string, Locale> = {
  en: "en",
  "en-us": "en",
  "en-gb": "en",
  zh: "zh-Hans",
  "zh-cn": "zh-Hans",
  "zh-sg": "zh-Hans",
  "zh-hans": "zh-Hans",
  "zh-tw": "zh-Hant",
  "zh-hk": "zh-Hant",
  "zh-mo": "zh-Hant",
  "zh-hant": "zh-Hant",
  es: "es",
  "es-es": "es",
  "es-mx": "es",
  "es-419": "es",
  ar: "ar",
  "ar-sa": "ar",
  "ar-eg": "ar",
  hi: "hi",
  "hi-in": "hi",
  pt: "pt-BR",
  "pt-br": "pt-BR",
  "pt-pt": "pt-BR",
  bn: "bn",
  "bn-bd": "bn",
  "bn-in": "bn",
  ru: "ru",
  "ru-ru": "ru",
  ja: "ja",
  "ja-jp": "ja",
  de: "de",
  "de-de": "de",
  fr: "fr",
  "fr-fr": "fr",
  id: "id",
  "id-id": "id",
  in: "id",
  ko: "ko",
  "ko-kr": "ko",
  tr: "tr",
  "tr-tr": "tr",
  it: "it",
  "it-it": "it",
  vi: "vi",
  "vi-vn": "vi",
  th: "th",
  "th-th": "th",
  pl: "pl",
  "pl-pl": "pl",
  nl: "nl",
  "nl-nl": "nl",
  uk: "uk",
  "uk-ua": "uk",
  fa: "fa",
  "fa-ir": "fa",
  ms: "ms",
  "ms-my": "ms",
  he: "he",
  "he-il": "he",
  iw: "he",
  ur: "ur",
  "ur-pk": "ur",
};

function normalizeTag(tag: string): string {
  return tag.trim().replace(/_/g, "-").toLowerCase();
}

/**
 * Map a BCP-47 language tag (or list) to a supported product locale.
 * Prefers exact aliases, then language subtag, then `en`.
 */
export function matchLocale(input: string | readonly string[] | null | undefined): Locale {
  const tags = Array.isArray(input) ? input : input ? [input] : [];
  for (const raw of tags) {
    const tag = normalizeTag(raw);
    if (!tag) continue;
    const exact = ALIASES[tag];
    if (exact) return exact;
    const language = tag.split("-")[0] ?? "";
    const byLang = ALIASES[language];
    if (byLang) return byLang;
    if (isLocale(raw.trim())) return raw.trim() as Locale;
  }
  return DEFAULT_LOCALE;
}

export function getStoredLocale(): Locale | null {
  try {
    const value = localStorage.getItem(LOCALE_STORAGE_KEY);
    if (value && isLocale(value)) return value;
  } catch {
    /* ignore */
  }
  return null;
}

export function preferredLocale(
  stored: string | null | undefined = getStoredLocale(),
  languages: readonly string[] | undefined = typeof navigator !== "undefined" ? navigator.languages : undefined
): Locale {
  if (stored && isLocale(stored)) return stored;
  return matchLocale(languages);
}

/** Prefer `lang` / `locale` query on shareable or resume pay links. */
export function localeFromSearch(search: string | URLSearchParams | null | undefined): Locale | null {
  if (search == null || search === "") return null;
  const params =
    typeof search === "string"
      ? new URLSearchParams(search.startsWith("?") ? search.slice(1) : search)
      : search;
  const raw = (params.get("lang") ?? params.get("locale") ?? "").trim();
  if (!raw) return null;
  return matchLocale(raw);
}

/** Page locale: forced link lang → stored preference → browser. */
export function resolvePageLocale(
  search: string | URLSearchParams | null | undefined =
    typeof location !== "undefined" ? location.search : undefined
): Locale {
  return localeFromSearch(search) ?? preferredLocale();
}

export function applyDocumentLocale(locale: Locale): void {
  if (typeof document === "undefined") return;
  document.documentElement.lang = LOCALE_BCP47[locale];
  document.documentElement.dir = isRtlLocale(locale) ? "rtl" : "ltr";
}

export function setStoredLocale(locale: Locale): void {
  try {
    localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  } catch {
    /* ignore */
  }
}

export function bcp47(locale: Locale): string {
  return LOCALE_BCP47[locale];
}
