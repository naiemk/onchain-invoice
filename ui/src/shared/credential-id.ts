/** Normalize WebAuthn credential id strings to raw bytes for comparison. */
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
  if (ab.length !== bb.length) return false;
  for (let i = 0; i < ab.length; i++) {
    if (ab[i] !== bb[i]) return false;
  }
  return true;
}

function hexToBytes(hex: string): Uint8Array {
  const h = hex.startsWith("0x") ? hex.slice(2) : hex;
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
