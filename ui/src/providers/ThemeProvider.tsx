import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  applyTheme,
  getStoredTheme,
  preferredTheme,
  setTheme,
  toggleTheme,
  type Theme,
} from "../shared/theme.js";

interface ThemeContextValue {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => Theme;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function syncDomTheme(theme: Theme) {
  applyTheme(theme);
  document.documentElement.classList.toggle("dark", theme === "dark");
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(() => {
    const initial = getStoredTheme() ?? preferredTheme();
    syncDomTheme(initial);
    return initial;
  });

  useEffect(() => {
    syncDomTheme(theme);
  }, [theme]);

  const setThemeValue = useCallback((next: Theme) => {
    setTheme(next);
    setThemeState(next);
  }, []);

  const toggle = useCallback(() => {
    const next = toggleTheme();
    syncDomTheme(next);
    setThemeState(next);
    return next;
  }, []);

  const value = useMemo(
    () => ({ theme, setTheme: setThemeValue, toggleTheme: toggle }),
    [theme, setThemeValue, toggle]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
}

export function currentUiTheme(): Theme {
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}
