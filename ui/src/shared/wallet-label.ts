const INFERRED_DEVICE_LABELS = new Set([
  "mac",
  "iphone",
  "ipad",
  "android",
  "windows",
  "chromebook",
  "linux",
  "device",
  "my device",
  "passkey",
  "recovered passkey",
]);

export const DEFAULT_WALLET_LABEL = "Wallet";

/** True when the stored name is a device UA guess (e.g. Mac), not a wallet name. */
export function isInferredDeviceLabel(label: string | null | undefined): boolean {
  const normalized = label?.trim().toLowerCase();
  return Boolean(normalized && INFERRED_DEVICE_LABELS.has(normalized));
}

export function defaultWalletLabel(index: number): string {
  if (index <= 0) return DEFAULT_WALLET_LABEL;
  return `${DEFAULT_WALLET_LABEL} ${index + 1}`;
}

export function resolveWalletLabel(input: {
  saved?: string | null;
  server?: string | null;
  index?: number;
  fallback?: string;
}): string {
  const saved = input.saved?.trim();
  if (saved && !isInferredDeviceLabel(saved)) return saved;
  const server = input.server?.trim();
  if (server && !isInferredDeviceLabel(server)) return server;
  return defaultWalletLabel(input.index ?? 0);
}
