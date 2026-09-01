/** Shared WebAuthn credential id normalization (browser + server). */
export function credentialIdToBytes(credentialId: string): Uint8Array {
  const trimmed = credentialId.trim();
  if (!trimmed) return new Uint8Array(0);
  if (trimmed.startsWith("0x")) return hexToBytes(trimmed);
  try {
    return base64ToBytes(trimmed);
  } catch {
    const pad = "=".repeat((4 - (trimmed.length % 4)) % 4);
    const b64 = (trimmed + pad).replace(/-/g, "+").replace(/_/g, "/");
    return base64ToBytes(b64);
  }
}

export function credentialIdsMatch(a?: string | null, b?: string | null): boolean {
  if (!a?.trim() || !b?.trim()) return false;
  if (a.trim() === b.trim()) return true;
  const ab = credentialIdToBytes(a);
  const bb = credentialIdToBytes(b);
  if (ab.length !== bb.length || ab.length === 0) return false;
  for (let i = 0; i < ab.length; i++) {
    if (ab[i] !== bb[i]) return false;
  }
  return true;
}

/** Distinct string forms that may appear in storage for the same raw id. */
export function credentialIdLookupVariants(credentialId: string): string[] {
  const bytes = credentialIdToBytes(credentialId);
  if (bytes.length === 0) return [credentialId.trim()];
  const std = bytesToBase64(bytes);
  const url = std.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const hex = "0x" + [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  return [...new Set([credentialId.trim(), std, url, hex])];
}

function hexToBytes(hex: string): Uint8Array {
  const h = hex.startsWith("0x") ? hex.slice(2) : hex;
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = Buffer.from(b64, "base64");
  return new Uint8Array(bin);
}

function bytesToBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}
