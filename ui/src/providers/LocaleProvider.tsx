import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import type { Locale } from "../i18n/locales.js";
import { applyLocale, getLocale, setLocale, t, tFor, type MessageKey, type MessageVars } from "../i18n/t.js";
import { resolvePageLocale } from "../i18n/detect.js";

interface LocaleContextValue {
  locale: Locale;
  setLocaleAndApply: (locale: Locale) => void;
  t: (key: MessageKey, vars?: MessageVars) => string;
}

const LocaleContext = createContext<LocaleContextValue | null>(null);

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(() => {
    applyLocale(resolvePageLocale());
    return getLocale();
  });

  const setLocaleAndApply = useCallback((next: Locale) => {
    setLocale(next);
    setLocaleState(next);
  }, []);

  const translate = useCallback(
    (key: MessageKey, vars?: MessageVars) => tFor(locale, key, vars),
    [locale]
  );

  const value = useMemo(
    () => ({ locale, setLocaleAndApply, t: translate }),
    [locale, setLocaleAndApply, translate]
  );

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale() {
  const ctx = useContext(LocaleContext);
  if (!ctx) throw new Error("useLocale must be used within LocaleProvider");
  return ctx;
}

/** Re-export for non-React modules */
export { t };
