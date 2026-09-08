const PASSKEY_NAME_MAX = 64;

/** Best-effort device label for WebAuthn user.name (Chrome/iCloud passkey picker). */
export function inferDeviceLabel(): string {
  if (typeof navigator === "undefined") return "Device";
  const ua = navigator.userAgent;
  if (/iPhone/i.test(ua)) return "iPhone";
  if (/iPad/i.test(ua)) return "iPad";
  if (/Android/i.test(ua)) return "Android";
  if (/Mac OS X|Macintosh/i.test(ua)) return "Mac";
  if (/Windows/i.test(ua)) return "Windows";
  if (/CrOS/i.test(ua)) return "Chromebook";
  if (/Linux/i.test(ua)) return "Linux";
  return "Device";
}

function clipPasskeyName(name: string): string {
  if (name.length <= PASSKEY_NAME_MAX) return name;
  return `${name.slice(0, PASSKEY_NAME_MAX - 1)}…`;
}

/** Passkey picker label: wallet name + this device (or a caller-supplied device name). */
export function formatPasskeyName(input: {
  walletLabel?: string | null;
  deviceLabel?: string | null;
}): string {
  const wallet = input.walletLabel?.trim() ?? "";
  const device = input.deviceLabel?.trim() || inferDeviceLabel();
  if (wallet && device && !wallet.toLowerCase().includes(device.toLowerCase())) {
    return clipPasskeyName(`${wallet} · ${device}`);
  }
  return clipPasskeyName(wallet || device || "Wallet");
}
