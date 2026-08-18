import type { Locale } from "./locales.js";
import { dictionaries } from "./dictionaries/index.js";
import { en, type Messages } from "./dictionaries/en.js";
import { applyDocumentLocale, preferredLocale, setStoredLocale } from "./detect.js";

export type MessageVars = Record<string, string | number>;

type NestedKeyOf<T> = T extends string
  ? never
  : {
      [K in keyof T & string]: T[K] extends string ? K : `${K}.${NestedKeyOf<T[K]>}`;
    }[keyof T & string];

export type MessageKey = NestedKeyOf<Messages>;

let currentLocale: Locale = preferredLocale();

export function getLocale(): Locale {
  return currentLocale;
}

/** Apply locale for this session without persisting (used on first load). */
export function applyLocale(locale: Locale): void {
  currentLocale = locale;
  applyDocumentLocale(locale);
}

/** Persist a user-selected locale and apply it. */
export function setLocale(locale: Locale): void {
  applyLocale(locale);
  setStoredLocale(locale);
}

export function interpolate(template: string, vars?: MessageVars): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = vars[name];
    return value === undefined ? match : String(value);
  });
}

function lookup(messages: Messages, key: string): string | undefined {
  const parts = key.split(".");
  let node: unknown = messages;
  for (const part of parts) {
    if (node === null || typeof node !== "object" || !(part in node)) return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === "string" ? node : undefined;
}

export function tFor(locale: Locale, key: MessageKey, vars?: MessageVars): string {
  const fromLocale = lookup(dictionaries[locale] ?? en, key);
  const fromEn = lookup(en, key);
  return interpolate(fromLocale ?? fromEn ?? key, vars);
}

export function t(key: MessageKey, vars?: MessageVars): string {
  return tFor(currentLocale, key, vars);
}
