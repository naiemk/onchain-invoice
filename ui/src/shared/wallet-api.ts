import type { WalletBalanceResponse } from "../../../commerce/shared/wallet.js";
import type { WalletPublicConfig, WalletAccountRecord } from "../../../commerce/shared/wallet.js";
import type { PackedUserOperationJson, WalletUserOpRecord } from "../../../commerce/shared/userop.js";
import { apiUrl } from "./site.js";

let walletConfigCache: { at: number; value: WalletPublicConfig } | null = null;

export async function fetchWalletConfig(): Promise<WalletPublicConfig> {
  const now = Date.now();
  if (walletConfigCache && now - walletConfigCache.at < 30_000) {
    return walletConfigCache.value;
  }
  const res = await fetch(apiUrl("/api/public/wallet-config"));
  if (!res.ok) throw new Error("wallet config unavailable");
  const value = (await res.json()) as WalletPublicConfig;
  walletConfigCache = { at: now, value };
  return value;
}

export async function fetchWalletBalance(wallet: string): Promise<WalletBalanceResponse> {
  const q = new URLSearchParams({ wallet });
  const res = await fetch(apiUrl(`/api/wallet/balance?${q}`));
  if (!res.ok) throw new Error("failed to load balance");
  return res.json() as Promise<WalletBalanceResponse>;
}

export async function registerWalletAccount(input: {
  address: string;
  salt: string;
  ownerQx: string;
  ownerQy: string;
  credentialId: string;
  webauthnAttestation?: unknown;
}): Promise<WalletAccountRecord> {
  const res = await fetch(apiUrl("/api/wallet/accounts"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
    throw new Error(body.message ?? body.error ?? "failed to register account");
  }
  const body = (await res.json()) as { account: WalletAccountRecord };
  return body.account;
}

export async function getWalletAccount(address: string): Promise<WalletAccountRecord | null> {
  const res = await fetch(apiUrl(`/api/wallet/accounts/${address}`));
  if (res.status === 404) return null;
  if (!res.ok) throw new Error("failed to load account");
  const body = (await res.json()) as { account: WalletAccountRecord };
  return body.account;
}

export async function fetchWalletAccountByCredentialId(credentialId: string): Promise<{
  account: WalletAccountRecord;
  device: { label: string; ownerQx: string; ownerQy: string; credentialId: string | null } | null;
} | null> {
  const q = new URLSearchParams({ credentialId });
  const res = await fetch(apiUrl(`/api/wallet/accounts?${q}`));
  if (res.status === 404) return null;
  if (!res.ok) throw new Error("failed to look up account");
  return res.json() as Promise<{
    account: WalletAccountRecord;
    device: { label: string; ownerQx: string; ownerQy: string; credentialId: string | null } | null;
  }>;
}

export async function listDevices(wallet: string, chainId: string): Promise<import("../../../commerce/shared/wallet.js").WalletDeviceRecord[]> {
  const q = new URLSearchParams({ wallet, chainId });
  const res = await fetch(apiUrl(`/api/wallet/devices?${q}`));
  if (!res.ok) throw new Error("failed to load devices");
  const body = (await res.json()) as { devices: import("../../../commerce/shared/wallet.js").WalletDeviceRecord[] };
  return body.devices;
}

export async function registerDevice(input: {
  walletAddress: string;
  chainId: string;
  ownerQx: string;
  ownerQy: string;
  label: string;
  credentialId: string | null;
}): Promise<import("../../../commerce/shared/wallet.js").WalletDeviceRecord> {
  const res = await fetch(apiUrl("/api/wallet/devices"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error("failed to register device");
  const body = (await res.json()) as { device: import("../../../commerce/shared/wallet.js").WalletDeviceRecord };
  return body.device;
}

export async function deleteDevice(
  wallet: string,
  chainId: string,
  ownerQx: string,
  ownerQy: string
): Promise<void> {
  const path = `/api/wallet/devices/${wallet}/${ownerQx.slice(2)}/${ownerQy.slice(2)}?chainId=${encodeURIComponent(chainId)}`;
  const res = await fetch(apiUrl(path), { method: "DELETE" });
  if (!res.ok) throw new Error("failed to delete device");
}

export async function createPairing(walletAddress: string, chainId: string) {
  const res = await fetch(apiUrl("/api/wallet/pairing"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "create", walletAddress, chainId }),
  });
  if (!res.ok) throw new Error("pairing create failed");
  return (await res.json()) as { pairing: { nonce: string; walletAddress: string; chainId: string; expiresAt: string } };
}

export async function submitPairing(input: {
  nonce: string;
  newOwnerQx: string;
  newOwnerQy: string;
  deviceLabel: string;
}) {
  const res = await fetch(apiUrl("/api/wallet/pairing"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "submit", ...input }),
  });
  if (!res.ok) throw new Error("pairing submit failed");
  return (await res.json()) as { pairing: { status: string } };
}

export async function pollPairing(nonce: string) {
  const res = await fetch(apiUrl("/api/wallet/pairing"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "poll", nonce }),
  });
  if (!res.ok) throw new Error("pairing poll failed");
  return (await res.json()) as {
    pairing: {
      status: string;
      newOwnerQx: string | null;
      newOwnerQy: string | null;
      deviceLabel: string | null;
    };
  };
}

export function pairingQrPayload(input: {
  walletAddress: string;
  chainId: string;
  nonce: string;
  rpId: string;
}): string {
  return JSON.stringify(input);
}

export function pairingDeepLink(payload: string): string {
  const encoded = btoa(payload).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `${location.origin}/wallet/pair?payload=${encoded}`;
}

export function parsePairingQr(raw: string): {
  walletAddress: string;
  chainId: string;
  nonce: string;
  rpId: string;
} {
  return JSON.parse(raw) as {
    walletAddress: string;
    chainId: string;
    nonce: string;
    rpId: string;
  };
}

export function parsePairingFromUrl(): string | null {
  const encoded = new URLSearchParams(location.search).get("payload");
  if (!encoded) return null;
  const padded = encoded.replace(/-/g, "+").replace(/_/g, "/");
  const pad = padded.length % 4 === 0 ? padded : padded + "=".repeat(4 - (padded.length % 4));
  try {
    return atob(pad);
  } catch {
    return null;
  }
}

export async function submitUserOp(input: {
  chainId: string;
  walletAddress: string;
  userOp: PackedUserOperationJson;
  userOpHash: string;
}): Promise<WalletUserOpRecord> {
  const res = await fetch(apiUrl("/api/wallet/userops"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
    throw new Error(body.message ?? body.error ?? "userOp submit failed");
  }
  const body = (await res.json()) as { userOp: WalletUserOpRecord };
  return body.userOp;
}

export async function pollUserOpStatus(userOpHash: string): Promise<WalletUserOpRecord> {
  const res = await fetch(apiUrl(`/api/wallet/userops/${userOpHash}`));
  if (!res.ok) throw new Error("userOp status unavailable");
  const body = (await res.json()) as { userOp: WalletUserOpRecord };
  return body.userOp;
}

export async function waitForUserOp(userOpHash: string, timeoutMs = 120_000): Promise<WalletUserOpRecord> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const record = await pollUserOpStatus(userOpHash);
    if (record.status === "included" || record.status === "failed" || record.status === "rejected") {
      return record;
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error("Timed out waiting for userOp");
}

/** Resolve primary chain RPC from multi-chain config. */
export function primaryChain(config: WalletPublicConfig) {
  const chain = config.chains?.find((c) => c.chainId === config.chainId) ?? config.chains?.[0];
  return {
    rpcUrl: chain?.rpcUrl ?? config.rpcUrl,
    feeTokenAddress: chain?.feeTokenAddress ?? config.feeTokenAddress,
    feeTokenSymbol: chain?.feeTokenSymbol ?? config.feeTokenSymbol,
    feeTokenDecimals: chain?.feeTokenDecimals ?? config.feeTokenDecimals,
  };
}
