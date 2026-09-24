import type {
  IdentityEmailLookupResponse,
  IdentityMeResponse,
  IdentityMethodKind,
  IdentityRecoverProveResponse,
} from "../../../commerce/shared/identity.js";
import type { WalletAccountRecord } from "../../../commerce/shared/wallet.js";
import { apiUrl } from "./site.js";
import { t } from "../i18n/t.js";

async function identityFetch(path: string, init?: RequestInit): Promise<Response> {
  return fetch(apiUrl(path), {
    credentials: "include",
    ...init,
    headers: {
      ...(init?.body ? { "content-type": "application/json" } : {}),
      ...(init?.headers ?? {}),
    },
  });
}

async function readError(res: Response): Promise<string> {
  const body = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
  return body.message ?? body.error ?? `request failed (${res.status})`;
}

const IDENTITY_ID_RE = /^0x[0-9a-fA-F]{64}$/;

export function parseIdentityIdParam(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed && IDENTITY_ID_RE.test(trimmed) ? trimmed : undefined;
}

export async function lookupIdentityEmail(email: string): Promise<IdentityEmailLookupResponse> {
  const res = await identityFetch("/api/identity/email/lookup", {
    method: "POST",
    body: JSON.stringify({ email }),
  });
  if (res.status === 404) throw new Error(t("wallet.identityUnavailable"));
  if (!res.ok) throw new Error(await readError(res));
  return res.json() as Promise<IdentityEmailLookupResponse>;
}

export async function startIdentityEmail(email: string, captchaToken?: string | null): Promise<void> {
  const res = await identityFetch("/api/identity/email/start", {
    method: "POST",
    body: JSON.stringify({ email, captchaToken: captchaToken ?? undefined }),
  });
  if (res.status === 404) throw new Error(t("wallet.identityUnavailable"));
  if (!res.ok) throw new Error(await readError(res));
}

export async function fetchIdentityDevOtp(): Promise<{ to: string | null; code: string | null } | null> {
  const res = await identityFetch("/api/identity/email/dev-otp");
  if (!res.ok) return null;
  return res.json() as Promise<{ to: string | null; code: string | null }>;
}

export async function verifyIdentityEmail(email: string, code: string): Promise<IdentityMeResponse> {
  const res = await identityFetch("/api/identity/email/verify", {
    method: "POST",
    body: JSON.stringify({ email, code }),
  });
  if (!res.ok) throw new Error(await readError(res));
  return res.json() as Promise<IdentityMeResponse>;
}

export function googleIdentityStartUrl(): string {
  return apiUrl("/api/identity/google/start");
}

export async function fetchIdentityMe(): Promise<IdentityMeResponse | null> {
  const res = await identityFetch("/api/identity/me");
  if (res.status === 401) return null;
  if (!res.ok) throw new Error(await readError(res));
  return res.json() as Promise<IdentityMeResponse>;
}

export async function logoutIdentity(): Promise<void> {
  try {
    await identityFetch("/api/identity/logout", {
      method: "POST",
      body: JSON.stringify({}),
    });
  } catch {
    /* still clear local state */
  }
}

export async function registerIdentityPasskey(input: {
  qx: string;
  qy: string;
  credentialId: string;
  webauthnAttestation?: unknown;
}): Promise<{ identityId: string; wallets: WalletAccountRecord[] }> {
  const res = await identityFetch("/api/identity/passkey/register", {
    method: "POST",
    body: JSON.stringify(input),
  });
  if (res.status === 409) throw new Error(t("wallet.identityPasskeyExists"));
  if (!res.ok) throw new Error(await readError(res));
  return res.json() as Promise<{ identityId: string; wallets: WalletAccountRecord[] }>;
}

export async function loginIdentityPasskey(
  credentialId: string,
  coords?: { qx?: string; qy?: string }
): Promise<{
  identityId: string;
  email?: string;
  wallets: WalletAccountRecord[];
  method: { kind: IdentityMethodKind; credentialId: string | null; qx: string | null; qy: string | null };
}> {
  const res = await identityFetch("/api/identity/passkey/login", {
    method: "POST",
    body: JSON.stringify({
      credentialId,
      ...(coords?.qx ? { qx: coords.qx } : {}),
      ...(coords?.qy ? { qy: coords.qy } : {}),
    }),
  });
  if (!res.ok) throw new Error(await readError(res));
  return res.json() as Promise<{
    identityId: string;
    email?: string;
    wallets: WalletAccountRecord[];
    method: { kind: IdentityMethodKind; credentialId: string | null; qx: string | null; qy: string | null };
  }>;
}

export async function fetchIdentityWallets(): Promise<WalletAccountRecord[]> {
  const res = await identityFetch("/api/identity/wallets");
  if (!res.ok) throw new Error(await readError(res));
  const body = (await res.json()) as { wallets: WalletAccountRecord[] };
  return body.wallets;
}

export async function createIdentityWallet(
  credentialId?: string,
  label?: string
): Promise<WalletAccountRecord> {
  const res = await identityFetch("/api/identity/wallets", {
    method: "POST",
    body: JSON.stringify({
      ...(credentialId ? { credentialId } : {}),
      ...(label ? { label } : {}),
    }),
  });
  if (res.status === 401) throw new Error(t("wallet.createNeedSignIn"));
  if (res.status === 400) {
    const err = await readError(res);
    if (err === "passkey_required") throw new Error(t("wallet.createNeedPasskey"));
    throw new Error(err);
  }
  if (!res.ok) throw new Error(await readError(res));
  const body = (await res.json()) as { account: WalletAccountRecord };
  return body.account;
}

export async function renameIdentityWallet(
  address: string,
  label: string,
  credentialId?: string
): Promise<void> {
  const res = await identityFetch("/api/identity/wallets", {
    method: "PATCH",
    body: JSON.stringify({ address, label, ...(credentialId ? { credentialId } : {}) }),
  });
  if (!res.ok) throw new Error(await readError(res));
}

export async function addIdentityMethod(input: {
  kind: IdentityMethodKind;
  qx?: string;
  qy?: string;
  eoa?: string;
  credentialId?: string;
  provingCredentialId?: string;
  authorization?: string;
  pay?: "recorded" | "pending";
}): Promise<void> {
  const res = await identityFetch("/api/identity/methods", {
    method: "POST",
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(await readError(res));
}

export async function deleteIdentityMethod(input: {
  methodId?: string;
  qx?: string;
  qy?: string;
  credentialId?: string | null;
  authorization?: string;
}): Promise<void> {
  const res = await identityFetch("/api/identity/methods", {
    method: "DELETE",
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
    const code = body.error?.trim();
    if (code === "last_method" || code === "remove_need_funds" || code === "method_not_found" || code === "invalid_signature") {
      throw new Error(code);
    }
    throw new Error(body.message ?? code ?? `request failed (${res.status})`);
  }
}

export async function fetchIdentityPairReady(input: {
  credentialId: string;
  qx?: string;
  qy?: string;
}): Promise<boolean> {
  const payload = {
    credentialId: input.credentialId,
    ...(input.qx ? { qx: input.qx } : {}),
    ...(input.qy ? { qy: input.qy } : {}),
  };
  const res = await identityFetch("/api/identity/pair/ready", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  if (res.status === 404 || res.status === 405) {
    const q = new URLSearchParams();
    if (input.qx) q.set("qx", input.qx);
    if (input.qy) q.set("qy", input.qy);
    if (input.credentialId) q.set("credentialId", input.credentialId);
    const fallback = await identityFetch(`/api/identity/pair/ready?${q}`);
    if (fallback.status === 404) return false;
    if (!fallback.ok) throw new Error(await readError(fallback));
    const fallbackBody = (await fallback.json()) as { ready?: boolean };
    return Boolean(fallbackBody.ready);
  }
  if (!res.ok) throw new Error(await readError(res));
  const body = (await res.json()) as { ready?: boolean };
  return Boolean(body.ready);
}

export async function fetchIdentityRecoverChallenge(): Promise<string> {
  const res = await identityFetch("/api/identity/recover/challenge");
  if (!res.ok) throw new Error(await readError(res));
  const body = (await res.json()) as { challenge: string };
  return body.challenge;
}

export async function fetchRecoverSecurityKeyIds(): Promise<string[]> {
  const res = await identityFetch("/api/identity/recover/security-keys");
  if (!res.ok) return [];
  const body = (await res.json()) as { credentialIds?: unknown };
  if (!Array.isArray(body.credentialIds)) return [];
  return body.credentialIds.map((value) => String(value).trim()).filter(Boolean);
}

export async function proveIdentityRecover(input: {
  kind: "yubikey" | "eoa";
  credentialId?: string;
  eoa?: string;
  signature?: string;
  challenge?: string;
}): Promise<IdentityRecoverProveResponse> {
  const res = await identityFetch("/api/identity/recover/prove", {
    method: "POST",
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(await readError(res));
  return res.json() as Promise<IdentityRecoverProveResponse>;
}

export async function fetchIdentityRecoverSession(): Promise<IdentityRecoverProveResponse | null> {
  const res = await identityFetch("/api/identity/recover/session");
  if (res.status === 401) return null;
  if (!res.ok) throw new Error(await readError(res));
  return res.json() as Promise<IdentityRecoverProveResponse>;
}

export async function recoverAddIdentityMethod(input: {
  pay: "relayer" | "recorded";
  qx: string;
  qy: string;
  credentialId: string;
  kind?: IdentityMethodKind;
  authorization?: string;
  captchaToken?: string | null;
}): Promise<void> {
  const res = await identityFetch("/api/identity/recover/add-method", {
    method: "POST",
    body: JSON.stringify({
      pay: input.pay,
      qx: input.qx,
      qy: input.qy,
      credentialId: input.credentialId,
      kind: input.kind ?? "webauthn",
      authorization: input.authorization,
      captchaToken: input.captchaToken ?? undefined,
    }),
  });
  if (!res.ok) throw new Error(await readError(res));
}

export async function joinIdentitySuperWallet(address: string): Promise<WalletAccountRecord> {
  const res = await identityFetch("/api/identity/wallets/join", {
    method: "POST",
    body: JSON.stringify({ address }),
  });
  if (!res.ok) throw new Error(await readError(res));
  const body = (await res.json()) as { account: WalletAccountRecord };
  return body.account;
}

export type IdentityOperatorRestore = {
  id: string;
  walletAddress: string;
  email: string;
  newQx: string;
  newQy: string;
  status: string;
  identityId: string | null;
  operatorPayload: string | null;
};

export async function fetchOperatorRestores(): Promise<{
  operator: string | null;
  threshold: number;
  requests: IdentityOperatorRestore[];
}> {
  const res = await identityFetch("/api/identity/operator/restores");
  if (!res.ok) throw new Error(await readError(res));
  return res.json() as Promise<{
    operator: string | null;
    threshold: number;
    requests: IdentityOperatorRestore[];
  }>;
}

export async function signOperatorRestore(input: {
  requestId: string;
  signature: string;
  userOpHash?: string;
  userOp?: unknown;
}): Promise<{ payload: { userOpHash?: string; userOp?: unknown; blobs?: Record<string, string> } }> {
  const res = await identityFetch(`/api/identity/operator/restores/${input.requestId}/sign`, {
    method: "POST",
    body: JSON.stringify({
      signature: input.signature,
      userOpHash: input.userOpHash,
      userOp: input.userOp,
    }),
  });
  if (!res.ok) throw new Error(await readError(res));
  return res.json() as Promise<{
    payload: { userOpHash?: string; userOp?: unknown; blobs?: Record<string, string> };
  }>;
}

export async function markOperatorRestoreInitiated(requestId: string): Promise<void> {
  const res = await identityFetch(`/api/identity/operator/restores/${requestId}/initiated`, {
    method: "POST",
    body: JSON.stringify({}),
  });
  if (!res.ok) throw new Error(await readError(res));
}

export type { IdentityPairPayload } from "../../../commerce/shared/identity-pair.js";
export {
  encodeIdentityPairLink,
  encodeIdentityPairPayload,
  parseIdentityPairPayload,
} from "../../../commerce/shared/identity-pair.js";
