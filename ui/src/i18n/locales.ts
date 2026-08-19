export const LOCALES = [
  "en",
  "zh-Hans",
  "zh-Hant",
  "es",
  "ar",
  "hi",
  "pt-BR",
  "bn",
  "ru",
  "ja",
  "de",
  "fr",
  "id",
  "ko",
  "tr",
  "it",
  "vi",
  "th",
  "pl",
  "nl",
  "uk",
  "fa",
  "ms",
  "he",
  "ur",
] as const;

export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "en";

export const RTL_LOCALES = new Set<Locale>(["ar", "fa", "he", "ur"]);

/** Native endonym shown in the language switcher (not translated). */
export const LOCALE_NATIVE_NAMES: Record<Locale, string> = {
  en: "English",
  "zh-Hans": "简体中文",
  "zh-Hant": "繁體中文",
  es: "Español",
  ar: "العربية",
  hi: "हिन्दी",
  "pt-BR": "Português (Brasil)",
  bn: "বাংলা",
  ru: "Русский",
  ja: "日本語",
  de: "Deutsch",
  fr: "Français",
  id: "Bahasa Indonesia",
  ko: "한국어",
  tr: "Türkçe",
  it: "Italiano",
  vi: "Tiếng Việt",
  th: "ไทย",
  pl: "Polski",
  nl: "Nederlands",
  uk: "Українська",
  fa: "فارسی",
  ms: "Bahasa Melayu",
  he: "עברית",
  ur: "اردو",
};

/** BCP-47 tag for `html lang` and `Intl`. */
export const LOCALE_BCP47: Record<Locale, string> = {
  en: "en",
  "zh-Hans": "zh-Hans",
  "zh-Hant": "zh-Hant",
  es: "es",
  ar: "ar",
  hi: "hi",
  "pt-BR": "pt-BR",
  bn: "bn",
  ru: "ru",
  ja: "ja",
  de: "de",
  fr: "fr",
  id: "id",
  ko: "ko",
  tr: "tr",
  it: "it",
  vi: "vi",
  th: "th",
  pl: "pl",
  nl: "nl",
  uk: "uk",
  fa: "fa",
  ms: "ms",
  he: "he",
  ur: "ur",
};

export function isLocale(value: string): value is Locale {
  return (LOCALES as readonly string[]).includes(value);
}

export function isRtlLocale(locale: Locale): boolean {
  return RTL_LOCALES.has(locale);
}
