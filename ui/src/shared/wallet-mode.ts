const STORAGE_KEY = "tc.walletMode";

export type WalletMode = "simple" | "advanced";

export function loadWalletMode(): WalletMode {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === "advanced" || v === "simple") return v;
  } catch {
    /* ignore */
  }
  return "simple";
}

export function saveWalletMode(mode: WalletMode): void {
  try {
    localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    /* ignore */
  }
}

export function isAdvancedMode(): boolean {
  return loadWalletMode() === "advanced";
}
