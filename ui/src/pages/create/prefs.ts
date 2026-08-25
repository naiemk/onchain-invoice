/** Remembered create-invoice form preferences (localStorage). */

const PREFS_KEY = "tc-create-prefs";

export type CreatePrefs = {
  walletEvm?: string;
  walletTron?: string;
  walletSolana?: string;
  displayFiat?: string;
  quoteCountry?: string;
  quotePaymentMethod?: string;
  quoteProvider?: string;
  quoteSlippagePct?: string;
  paymentMode?: string;
};

function read(): CreatePrefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as CreatePrefs;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function write(next: CreatePrefs): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(next));
  } catch {
    /* ignore quota / private mode */
  }
}

export function loadCreatePrefs(): CreatePrefs {
  return read();
}

export function patchCreatePrefs(patch: Partial<CreatePrefs>): void {
  write({ ...read(), ...patch });
}

/** Prefer remembered value when it still appears in `options`; else `fallback` (often ""). */
export function pickRemembered(options: string[], remembered: string | undefined, fallback = ""): string {
  if (remembered && options.includes(remembered)) return remembered;
  return fallback;
}
