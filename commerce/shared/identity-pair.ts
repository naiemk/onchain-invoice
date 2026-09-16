export type IdentityPairPayload = {
  v: 2;
  identityId: string;
  qx: string;
  qy: string;
  credentialId: string;
};

function utf8ToBase64Url(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let bin = "";
  for (const byte of bytes) bin += String.fromCharCode(byte);
  const b64 = btoa(bin);
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlToUtf8(token: string): string {
  const pad = token.replace(/-/g, "+").replace(/_/g, "/");
  const padded = pad + "=".repeat((4 - (pad.length % 4)) % 4);
  const bin = atob(padded);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

function asPairPayload(value: unknown): IdentityPairPayload | null {
  if (!value || typeof value !== "object") return null;
  const parsed = value as Partial<IdentityPairPayload>;
  if (
    parsed.v === 2 &&
    typeof parsed.identityId === "string" &&
    typeof parsed.qx === "string" &&
    typeof parsed.qy === "string" &&
    typeof parsed.credentialId === "string"
  ) {
    return parsed as IdentityPairPayload;
  }
  return null;
}

export function encodeIdentityPairPayload(payload: IdentityPairPayload): string {
  return JSON.stringify(payload);
}

export function encodeIdentityPairToken(payload: IdentityPairPayload): string {
  return utf8ToBase64Url(encodeIdentityPairPayload(payload));
}

export function encodeIdentityPairLink(origin: string, payload: IdentityPairPayload): string {
  const base = origin.replace(/\/$/, "");
  return `${base}/wallet/security?pair=${encodeIdentityPairToken(payload)}`;
}

export function parseIdentityPairPayload(raw: string): IdentityPairPayload | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    const fromJson = asPairPayload(JSON.parse(trimmed));
    if (fromJson) return fromJson;
  } catch {
    /* not raw JSON */
  }
  try {
    const looksLikeUrl =
      trimmed.includes("://") || trimmed.startsWith("/") || /[?&]pair=/i.test(trimmed);
    if (looksLikeUrl) {
      const url = new URL(trimmed, "https://pair.invalid");
      const pair = url.searchParams.get("pair");
      if (pair) {
        const fromToken = asPairPayload(JSON.parse(base64UrlToUtf8(pair)));
        if (fromToken) return fromToken;
      }
    }
  } catch {
    /* not a pairing URL */
  }
  try {
    return asPairPayload(JSON.parse(base64UrlToUtf8(trimmed)));
  } catch {
    return null;
  }
}
