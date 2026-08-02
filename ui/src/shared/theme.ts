const STORAGE_KEY = "tc-theme";

export type Theme = "light" | "dark";

export function getStoredTheme(): Theme | null {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    if (value === "light" || value === "dark") return value;
  } catch {
    /* ignore */
  }
  return null;
}

export function preferredTheme(): Theme {
  const stored = getStoredTheme();
  if (stored) return stored;
  if (typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches) {
    return "dark";
  }
  return "light";
}

export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) {
    meta.setAttribute("content", theme === "dark" ? "#0b1220" : "#0a2540");
  }
}

export function setTheme(theme: Theme): void {
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    /* ignore */
  }
  applyTheme(theme);
}

export function toggleTheme(): Theme {
  const next: Theme = (document.documentElement.dataset.theme === "dark" ? "light" : "dark");
  setTheme(next);
  return next;
}

export function initThemeToggle(button: HTMLButtonElement | null): void {
  if (!button) return;
  const syncLabel = () => {
    const dark = document.documentElement.dataset.theme === "dark";
    button.setAttribute("aria-pressed", dark ? "true" : "false");
    button.setAttribute("aria-label", dark ? "Switch to light theme" : "Switch to dark theme");
    button.title = dark ? "Light theme" : "Dark theme";
    button.textContent = dark ? "Light" : "Dark";
  };
  syncLabel();
  button.addEventListener("click", () => {
    toggleTheme();
    syncLabel();
  });
}
