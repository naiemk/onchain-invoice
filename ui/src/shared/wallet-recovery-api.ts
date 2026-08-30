import { apiUrl } from "./site.js";

export type RecoveryRequestPublic = {
  id: string;
  walletAddress: string;
  email: string;
  newQx: string;
  newQy: string;
  credentialId: string;
  deviceLabel: string | null;
  status: string;
  emailVerifiedAt: string | null;
  guardianAddress: string | null;
  guardianActedAt: string | null;
  jobId: string | null;
  chainId: string;
  createdAt: string;
  updatedAt: string;
};

async function readError(res: Response): Promise<string> {
  const body = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
  return body.message ?? body.error ?? `request failed (${res.status})`;
}

export async function fetchWalletEmail(wallet: string): Promise<{
  email: string | null;
  verified: boolean;
  hasEmail: boolean;
}> {
  const q = new URLSearchParams({ wallet });
  const res = await fetch(apiUrl(`/api/wallet/email?${q}`));
  if (!res.ok) throw new Error(await readError(res));
  return res.json() as Promise<{ email: string | null; verified: boolean; hasEmail: boolean }>;
}

export async function fetchWalletRecovery(wallet: string): Promise<{
  request: RecoveryRequestPublic | null;
  pendingOwner: {
    qx: string;
    qy: string;
    executableAt: string;
    requestId: string;
    active: boolean;
  } | null;
  email: { email: string; verified: boolean } | null;
}> {
  const q = new URLSearchParams({ wallet });
  const res = await fetch(apiUrl(`/api/wallet/recovery?${q}`));
  if (!res.ok) throw new Error(await readError(res));
  return res.json() as Promise<{
    request: RecoveryRequestPublic | null;
    pendingOwner: {
      qx: string;
      qy: string;
      executableAt: string;
      requestId: string;
      active: boolean;
    } | null;
    email: { email: string; verified: boolean } | null;
  }>;
}

export async function createRecoveryChallenge(
  purpose: "attach" | "recover" | "cancel",
  walletAddress?: string
): Promise<{ challengeId: string; challenge: string; expiresAt: string }> {
  const res = await fetch(apiUrl("/api/wallet/recovery/challenges"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ purpose, walletAddress }),
  });
  if (!res.ok) throw new Error(await readError(res));
  return res.json() as Promise<{ challengeId: string; challenge: string; expiresAt: string }>;
}

export async function attachWalletEmail(input: {
  walletAddress: string;
  email: string;
  challengeId: string;
  ownerQx: string;
  ownerQy: string;
  assertion: unknown;
  captchaToken?: string | null;
}): Promise<{ email: string; verified: boolean; otpSent: boolean }> {
  const res = await fetch(apiUrl("/api/wallet/email"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(await readError(res));
  return res.json() as Promise<{ email: string; verified: boolean; otpSent: boolean }>;
}

export async function verifyWalletEmailOtp(input: {
  walletAddress: string;
  email: string;
  code: string;
  captchaToken?: string | null;
}): Promise<{ email: string; verified: boolean }> {
  const res = await fetch(apiUrl("/api/wallet/email/verify"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(await readError(res));
  return res.json() as Promise<{ email: string; verified: boolean }>;
}

export async function createRecoveryRequest(input: {
  walletAddress?: string;
  email?: string;
  challengeId: string;
  ownerQx: string;
  ownerQy: string;
  credentialId: string;
  label?: string;
  assertion: unknown;
  captchaToken?: string | null;
  chainId?: string;
}): Promise<{ request: RecoveryRequestPublic; otpSent: boolean }> {
  const res = await fetch(apiUrl("/api/wallet/recovery/requests"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(await readError(res));
  return res.json() as Promise<{ request: RecoveryRequestPublic; otpSent: boolean }>;
}

export async function verifyRecoveryEmailOtp(input: {
  requestId: string;
  code: string;
  captchaToken?: string | null;
}): Promise<{ request: RecoveryRequestPublic }> {
  const res = await fetch(apiUrl(`/api/wallet/recovery/requests/${input.requestId}/verify-email`), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code: input.code, captchaToken: input.captchaToken }),
  });
  if (!res.ok) throw new Error(await readError(res));
  return res.json() as Promise<{ request: RecoveryRequestPublic }>;
}

export async function cancelRecoveryRequest(input: {
  requestId: string;
  challengeId: string;
  ownerQx: string;
  ownerQy: string;
  credentialId: string;
  assertion: unknown;
  captchaToken?: string | null;
}): Promise<{ request: RecoveryRequestPublic }> {
  const res = await fetch(apiUrl(`/api/wallet/recovery/requests/${input.requestId}/cancel`), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(await readError(res));
  return res.json() as Promise<{ request: RecoveryRequestPublic }>;
}

const GUARDIAN_SESSION_KEY = "tc.guardianSession";

export function loadGuardianSession(): string | null {
  return sessionStorage.getItem(GUARDIAN_SESSION_KEY);
}

export function saveGuardianSession(token: string): void {
  sessionStorage.setItem(GUARDIAN_SESSION_KEY, token);
}

export function clearGuardianSession(): void {
  sessionStorage.removeItem(GUARDIAN_SESSION_KEY);
}

function guardianHeaders(): HeadersInit {
  const token = loadGuardianSession();
  return token
    ? { authorization: `Bearer ${token}`, "x-guardian-session": token }
    : {};
}

export async function fetchGuardianNonce(address: string): Promise<{
  nonce: string;
  issuedAt: string;
  message: string;
  guardian: string;
}> {
  const q = new URLSearchParams({ address });
  const res = await fetch(apiUrl(`/api/guardian/nonce?${q}`));
  if (!res.ok) throw new Error(await readError(res));
  return res.json() as Promise<{
    nonce: string;
    issuedAt: string;
    message: string;
    guardian: string;
  }>;
}

export async function guardianLogin(input: {
  address: string;
  signature: string;
  message: string;
  nonce: string;
}): Promise<{ token: string; address: string }> {
  const res = await fetch(apiUrl("/api/guardian/login"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(await readError(res));
  return res.json() as Promise<{ token: string; address: string }>;
}

export async function fetchGuardianMe(): Promise<{ address: string; guardian: string }> {
  const res = await fetch(apiUrl("/api/guardian/me"), { headers: guardianHeaders() });
  if (!res.ok) throw new Error(await readError(res));
  return res.json() as Promise<{ address: string; guardian: string }>;
}

export async function listGuardianRecoveryRequests(
  status?: string
): Promise<{ requests: RecoveryRequestPublic[] }> {
  const q = status ? `?status=${encodeURIComponent(status)}` : "";
  const res = await fetch(apiUrl(`/api/guardian/recovery-requests${q}`), {
    headers: guardianHeaders(),
  });
  if (!res.ok) throw new Error(await readError(res));
  return res.json() as Promise<{ requests: RecoveryRequestPublic[] }>;
}

export async function approveGuardianRequest(
  id: string
): Promise<{ request: RecoveryRequestPublic; job: unknown }> {
  const res = await fetch(apiUrl(`/api/guardian/recovery-requests/${id}/approve`), {
    method: "POST",
    headers: { ...guardianHeaders(), "content-type": "application/json" },
    body: "{}",
  });
  if (!res.ok) throw new Error(await readError(res));
  return res.json() as Promise<{ request: RecoveryRequestPublic; job: unknown }>;
}

export async function rejectGuardianRequest(id: string): Promise<{ request: RecoveryRequestPublic }> {
  const res = await fetch(apiUrl(`/api/guardian/recovery-requests/${id}/reject`), {
    method: "POST",
    headers: { ...guardianHeaders(), "content-type": "application/json" },
    body: "{}",
  });
  if (!res.ok) throw new Error(await readError(res));
  return res.json() as Promise<{ request: RecoveryRequestPublic }>;
}
