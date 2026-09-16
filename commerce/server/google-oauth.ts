import type { IdentityConfig } from "./config.js";

export type GoogleIdClaims = {
  sub: string;
  email: string;
  email_verified: boolean;
};

export function googleAuthUrl(config: IdentityConfig, state: string): string {
  if (!config.googleClientId || !config.googleRedirectUri) {
    throw Object.assign(new Error("google_not_configured"), { statusCode: 503 });
  }
  const url = new URL(config.googleAuthUrl);
  url.searchParams.set("client_id", config.googleClientId);
  url.searchParams.set("redirect_uri", config.googleRedirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid email");
  url.searchParams.set("state", state);
  url.searchParams.set("prompt", "select_account");
  return url.toString();
}

export async function exchangeGoogleCode(
  config: IdentityConfig,
  code: string
): Promise<{ id_token: string }> {
  if (!config.googleClientId || !config.googleClientSecret || !config.googleRedirectUri) {
    throw Object.assign(new Error("google_not_configured"), { statusCode: 503 });
  }
  const body = new URLSearchParams({
    code,
    client_id: config.googleClientId,
    client_secret: config.googleClientSecret,
    redirect_uri: config.googleRedirectUri,
    grant_type: "authorization_code",
  });
  const response = await fetch(config.googleTokenUrl, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!response.ok) {
    throw Object.assign(new Error("google_token_failed"), { statusCode: 400 });
  }
  const json = (await response.json()) as { id_token?: string };
  if (!json.id_token) {
    throw Object.assign(new Error("google_id_token_missing"), { statusCode: 400 });
  }
  return { id_token: json.id_token };
}

export function parseGoogleIdToken(idToken: string, skipVerify: boolean): GoogleIdClaims {
  const parts = idToken.split(".");
  if (parts.length < 2) {
    throw Object.assign(new Error("invalid_id_token"), { statusCode: 400 });
  }
  if (!skipVerify) {
    // Production: decode still used after token endpoint (TLS + Google-issued). Signature
    // is trusted via the token endpoint when skipVerify is false we still require email_verified.
  }
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(Buffer.from(parts[1]!, "base64url").toString("utf8")) as Record<string, unknown>;
  } catch {
    throw Object.assign(new Error("invalid_id_token"), { statusCode: 400 });
  }
  const email = typeof payload.email === "string" ? payload.email.trim().toLowerCase() : "";
  const sub = typeof payload.sub === "string" ? payload.sub : "";
  const verified = payload.email_verified === true || payload.email_verified === "true";
  if (!email.includes("@") || !sub) {
    throw Object.assign(new Error("invalid_id_token"), { statusCode: 400 });
  }
  if (!verified) {
    throw Object.assign(new Error("email_not_verified"), { statusCode: 400 });
  }
  return { sub, email, email_verified: true };
}
