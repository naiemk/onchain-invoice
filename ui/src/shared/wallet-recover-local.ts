import { apiUrl } from "./site.js";
import { t } from "../i18n/t.js";
import { assertPasskeyChallenge } from "./webauthn.js";
import type { WalletAccountRecord } from "../../../commerce/shared/wallet.js";

export type WalletRecoverInfo = {
  wallet: string;
  chainId: string;
  inDb: boolean;
  deployed: boolean;
  ownersOnChain: { qx: string; qy: string }[];
  balanceUsd: string;
  hasFunds: boolean;
  account: {
    address: string;
    ownerQx: string;
    ownerQy: string;
    deployedChains: string[];
  } | null;
};

async function readError(res: Response): Promise<string> {
  const body = (await res.json().catch(() => ({}))) as {
    error?: string;
    message?: string;
    reason?: string;
  };
  if (body.error === "passkey_owner_mismatch") {
    return t("wallet.localRecoveryPasskeyMismatch");
  }
  return body.message ?? body.error ?? `request failed (${res.status})`;
}

export async function fetchRecoverInfo(
  walletAddress: string,
  chainId: string
): Promise<WalletRecoverInfo> {
  const q = new URLSearchParams({ chainId });
  const res = await fetch(apiUrl(`/api/wallet/accounts/${walletAddress}/recover-info?${q}`));
  if (!res.ok) throw new Error(await readError(res));
  return res.json() as Promise<WalletRecoverInfo>;
}

export async function createRecordChallenge(
  walletAddress?: string
): Promise<{ challengeId: string; challenge: string; expiresAt: string }> {
  const res = await fetch(apiUrl("/api/wallet/recovery/challenges"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ purpose: "record", walletAddress }),
  });
  if (!res.ok) throw new Error(await readError(res));
  return res.json() as Promise<{ challengeId: string; challenge: string; expiresAt: string }>;
}

export async function recoverWalletFromChain(input: {
  walletAddress: string;
  chainId: string;
  ownerQx?: string;
  ownerQy?: string;
  credentialId?: string;
  label?: string;
}): Promise<{ account: WalletAccountRecord; recovered: boolean; credentialId: string }> {
  const { challengeId, challenge } = await createRecordChallenge(input.walletAddress);
  const { credentialId, assertion } = await assertPasskeyChallenge({
    challengeBase64Url: challenge,
    credentialId: input.credentialId,
  });
  const body: Record<string, unknown> = {
    walletAddress: input.walletAddress,
    chainId: input.chainId,
    credentialId,
    challengeId,
    assertion,
    label: input.label,
  };
  if (input.ownerQx?.trim() && input.ownerQy?.trim()) {
    body.ownerQx = input.ownerQx;
    body.ownerQy = input.ownerQy;
  }
  const res = await fetch(apiUrl("/api/wallet/accounts/recover"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await readError(res));
  const payload = (await res.json()) as { account: WalletAccountRecord; recovered: boolean };
  return { ...payload, credentialId };
}

export function pickRecoveryOwnerCoords(input: {
  accountOwner?: { ownerQx?: string; ownerQy?: string } | null;
  registryEntry?: { qx?: string; qy?: string } | null;
  ownersOnChain?: { qx: string; qy: string }[];
}): { ownerQx?: string; ownerQy?: string; canRecoverFromChain: boolean } {
  const ownerQx =
    input.accountOwner?.ownerQx?.trim() ||
    input.registryEntry?.qx?.trim() ||
    input.ownersOnChain?.[0]?.qx?.trim();
  const ownerQy =
    input.accountOwner?.ownerQy?.trim() ||
    input.registryEntry?.qy?.trim() ||
    input.ownersOnChain?.[0]?.qy?.trim();
  const canRecoverFromChain = Boolean(
    (ownerQx && ownerQy) || (input.ownersOnChain?.length ?? 0) > 0
  );
  return {
    ownerQx: ownerQx || undefined,
    ownerQy: ownerQy || undefined,
    canRecoverFromChain,
  };
}

export function canOfferPasskeyRelink(
  info: WalletRecoverInfo | null,
  registryEntry?: { qx?: string; qy?: string } | null
): boolean {
  if (!info) return false;
  const { canRecoverFromChain } = pickRecoveryOwnerCoords({
    accountOwner: info.account,
    registryEntry,
    ownersOnChain: info.ownersOnChain,
  });
  return canRecoverFromChain || info.deployed || info.inDb;
}

export function buildSupportRequestText(input: {
  walletAddress: string;
  chainId: string;
  chainLabel?: string;
  problem: string;
}): string {
  const chain = input.chainLabel ? `${input.chainLabel} (${input.chainId})` : input.chainId;
  return [
    `Wallet address: ${input.walletAddress}`,
    `Chain: ${chain}`,
    `Problem: ${input.problem}`,
    "Request: Restore owner coordinates from persist log and redeploy if needed.",
  ].join("\n");
}
