import type { Locale } from "../locales.js";
import type { Messages } from "./en.js";
import { en } from "./en.js";

export type Overlay = Record<string, unknown>;
export type Lang = Exclude<Locale, "en">;
export type ByLang = Partial<Record<Lang, string>>;

export function assemble(sections: Record<string, Record<string, ByLang>>): Partial<Record<Lang, Overlay>> {
  const out: Partial<Record<Lang, Overlay>> = {};
  for (const [section, keys] of Object.entries(sections)) {
    for (const [key, byLang] of Object.entries(keys)) {
      for (const [lang, text] of Object.entries(byLang) as [Lang, string][]) {
        if (!text) continue;
        out[lang] ??= {};
        const root = out[lang] as Overlay;
        if (section === "_") {
          root[key] = text;
          continue;
        }
        const prev = (root[section] as Overlay | undefined) ?? {};
        root[section] = { ...prev, [key]: text };
      }
    }
  }
  return out;
}

export function mergeFillMaps(...maps: Array<Partial<Record<Locale, Overlay>>>): Partial<Record<Locale, Overlay>> {
  const out: Partial<Record<Locale, Overlay>> = {};
  for (const map of maps) {
    for (const [locale, overlay] of Object.entries(map) as [Locale, Overlay][]) {
      out[locale] = deepMergeOverlay(out[locale] ?? {}, overlay);
    }
  }
  return out;
}

function deepMergeOverlay(a: Overlay, b: Overlay): Overlay {
  const out: Overlay = { ...a };
  for (const [key, value] of Object.entries(b)) {
    if (isPlainObject(value) && isPlainObject(out[key])) {
      out[key] = deepMergeOverlay(out[key] as Overlay, value);
    } else {
      out[key] = value;
    }
  }
  return out;
}

function isPlainObject(value: unknown): value is Overlay {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

const ENGLISH_FUNCTION_WORDS = [
  " the ",
  " your ",
  " this ",
  " with ",
  " from ",
  " that ",
  " they ",
  " you ",
  " not ",
  " and ",
  " for ",
  " before ",
  " after ",
  " their ",
  " cannot ",
];

/** True when a locale still has English prose (including stale copy that drifted from `en`). */
export function isUntranslatedEnglish(current: unknown): boolean {
  if (typeof current !== "string" || current.length < 20) return false;
  if (!/^[\x20-\x7E–—…‘’“”€£¥]+$/.test(current)) return false;
  const padded = ` ${current.toLowerCase()} `;
  let hits = 0;
  for (const word of ENGLISH_FUNCTION_WORDS) {
    if (padded.includes(word)) hits += 1;
    if (hits >= 2) return true;
  }
  return false;
}

/** Apply overlay strings. `force` overwrites even when the locale already has a translation. */
export function mergeOverlay<T>(base: T, overlay: unknown, enRef: unknown, force: boolean): T {
  if (!isPlainObject(overlay) || !isPlainObject(base as object)) return base;
  const out: Overlay = { ...(base as Overlay) };
  const english = isPlainObject(enRef) ? enRef : {};
  for (const [key, value] of Object.entries(overlay)) {
    if (isPlainObject(value) && isPlainObject(out[key])) {
      out[key] = mergeOverlay(out[key], value, english[key], force);
    } else if (typeof value === "string") {
      const current = out[key];
      if (
        force ||
        current === undefined ||
        current === english[key] ||
        isUntranslatedEnglish(current)
      ) {
        out[key] = value;
      }
    }
  }
  return out as T;
}

export function applyLocaleOverlays(
  locale: Locale,
  messages: Messages,
  fill: Partial<Record<Locale, Overlay>> | undefined,
  force: Partial<Record<Locale, Overlay>> | undefined
): Messages {
  if (locale === "en") return messages;
  let next = messages;
  if (fill?.[locale]) next = mergeOverlay(next, fill[locale], en, false);
  if (force?.[locale]) next = mergeOverlay(next, force[locale], en, true);
  return next;
}
