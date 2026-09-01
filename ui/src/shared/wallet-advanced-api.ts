import type {
  WalletEntityKeyRecord,
  WalletEntityRecord,
  WalletKeyEnrollmentRequestRecord,
  WalletProposalRecord,
  WalletProposalSigRecord,
} from "../../../commerce/shared/wallet.js";
import { apiUrl } from "./site.js";

export interface AdvancedPolicy {
  wallet: string;
  advanced: boolean;
  /** False when the on-chain clone predates Super Wallet (no `advanced()`). */
  supportsAdvanced?: boolean;
  threshold: number;
  entityCount: number;
  vetoCount: number;
  vetoBitmap: string;
}

export function emptyAdvancedPolicy(walletAddress: string, supportsAdvanced: boolean): AdvancedPolicy {
  return {
    wallet: walletAddress,
    advanced: false,
    supportsAdvanced,
    threshold: 1,
    entityCount: 0,
    vetoCount: 0,
    vetoBitmap: "0",
  };
}

export async function fetchAdvancedPolicy(walletAddress: string): Promise<AdvancedPolicy> {
  const res = await fetch(apiUrl(`/api/wallet/${walletAddress}/advanced-policy`));
  if (!res.ok) throw new Error(`advanced_policy_${res.status}`);
  const pol = (await res.json()) as AdvancedPolicy;
  return { ...pol, supportsAdvanced: pol.supportsAdvanced !== false };
}

/** Read on-chain policy; a deployed wallet that fails the read is an old implementation. */
export async function resolveAdvancedPolicy(walletAddress: string, deployed: boolean): Promise<AdvancedPolicy> {
  try {
    return await fetchAdvancedPolicy(walletAddress);
  } catch (error) {
    const msg = error instanceof Error ? error.message : "";
    if (msg === "advanced_policy_503") return emptyAdvancedPolicy(walletAddress, true);
    return emptyAdvancedPolicy(walletAddress, !deployed);
  }
}

/** Poll until advanced() flips true after enableAdvanced (RPC lag). */
export async function waitForAdvancedPolicy(
  walletAddress: string,
  timeoutMs = 45_000
): Promise<AdvancedPolicy> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const pol = await resolveAdvancedPolicy(walletAddress, true);
    if (pol.advanced) return pol;
    await new Promise((r) => setTimeout(r, 2000));
  }
  const last = await resolveAdvancedPolicy(walletAddress, true);
  if (last.advanced) return last;
  throw new Error("advanced_policy_timeout");
}

export async function listWalletEntities(walletAddress: string): Promise<{
  entities: WalletEntityRecord[];
  keys: WalletEntityKeyRecord[];
}> {
  const res = await fetch(apiUrl(`/api/wallet/${walletAddress}/entities`));
  if (!res.ok) throw new Error(`entities_${res.status}`);
  return (await res.json()) as { entities: WalletEntityRecord[]; keys: WalletEntityKeyRecord[] };
}

export async function registerWalletEntity(input: {
  walletAddress: string;
  entityId: string;
  label?: string;
}): Promise<WalletEntityRecord> {
  const res = await fetch(apiUrl(`/api/wallet/${input.walletAddress}/entities`), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ entityId: input.entityId, label: input.label ?? null }),
  });
  if (!res.ok) throw new Error(`register_entity_${res.status}`);
  const data = (await res.json()) as { entity: WalletEntityRecord };
  return data.entity;
}

export async function registerWalletEntityKey(input: {
  walletAddress: string;
  entityId: string;
  keyId: string;
  keyType: number;
  qx?: string | null;
  qy?: string | null;
  eoa?: string | null;
  credentialId?: string | null;
}): Promise<WalletEntityKeyRecord> {
  const res = await fetch(
    apiUrl(`/api/wallet/${input.walletAddress}/entities/${input.entityId}/keys`),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    }
  );
  if (!res.ok) throw new Error(`register_key_${res.status}`);
  const data = (await res.json()) as { key: WalletEntityKeyRecord };
  return data.key;
}

export async function createKeyEnrollmentRequest(input: {
  walletAddress: string;
  entityId: string;
  keyType: number;
  qx?: string | null;
  qy?: string | null;
  eoa?: string | null;
  credentialId?: string | null;
  label?: string | null;
}): Promise<WalletKeyEnrollmentRequestRecord> {
  const res = await fetch(apiUrl(`/api/wallet/${input.walletAddress}/key-enrollment-requests`), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(`enrollment_request_${res.status}`);
  const data = (await res.json()) as { request: WalletKeyEnrollmentRequestRecord };
  return data.request;
}

export async function listKeyEnrollmentRequests(
  walletAddress: string,
  status?: "pending" | "approved" | "rejected" | "expired"
): Promise<WalletKeyEnrollmentRequestRecord[]> {
  const q = status ? `?status=${encodeURIComponent(status)}` : "";
  const res = await fetch(apiUrl(`/api/wallet/${walletAddress}/key-enrollment-requests${q}`));
  if (!res.ok) throw new Error(`enrollment_list_${res.status}`);
  const data = (await res.json()) as { requests: WalletKeyEnrollmentRequestRecord[] };
  return data.requests;
}

export async function getKeyEnrollmentRequest(
  walletAddress: string,
  requestId: string
): Promise<WalletKeyEnrollmentRequestRecord> {
  const res = await fetch(apiUrl(`/api/wallet/${walletAddress}/key-enrollment-requests/${requestId}`));
  if (!res.ok) throw new Error(`enrollment_get_${res.status}`);
  const data = (await res.json()) as { request: WalletKeyEnrollmentRequestRecord };
  return data.request;
}

export async function approveKeyEnrollmentRequest(
  walletAddress: string,
  requestId: string
): Promise<WalletKeyEnrollmentRequestRecord> {
  const res = await fetch(
    apiUrl(`/api/wallet/${walletAddress}/key-enrollment-requests/${requestId}/approve`),
    { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }
  );
  if (!res.ok) throw new Error(`enrollment_approve_${res.status}`);
  const data = (await res.json()) as { request: WalletKeyEnrollmentRequestRecord };
  return data.request;
}

export async function rejectKeyEnrollmentRequest(
  walletAddress: string,
  requestId: string
): Promise<WalletKeyEnrollmentRequestRecord> {
  const res = await fetch(
    apiUrl(`/api/wallet/${walletAddress}/key-enrollment-requests/${requestId}/reject`),
    { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }
  );
  if (!res.ok) throw new Error(`enrollment_reject_${res.status}`);
  const data = (await res.json()) as { request: WalletKeyEnrollmentRequestRecord };
  return data.request;
}

export async function listProposals(walletAddress: string): Promise<WalletProposalRecord[]> {
  const res = await fetch(apiUrl(`/api/wallet/${walletAddress}/proposals`));
  if (!res.ok) throw new Error(`proposals_${res.status}`);
  const data = (await res.json()) as { proposals: WalletProposalRecord[] };
  return data.proposals;
}

export async function createProposal(input: {
  walletAddress: string;
  chainId: string;
  target: string;
  value: string;
  data: string;
}): Promise<WalletProposalRecord> {
  const res = await fetch(apiUrl(`/api/wallet/${input.walletAddress}/proposals`), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(`create_proposal_${res.status}`);
  const data = (await res.json()) as { proposal: WalletProposalRecord };
  return data.proposal;
}

export async function getProposal(
  walletAddress: string,
  proposalId: string
): Promise<{ proposal: WalletProposalRecord; signatures: WalletProposalSigRecord[] }> {
  const res = await fetch(apiUrl(`/api/wallet/${walletAddress}/proposals/${proposalId}`));
  if (!res.ok) throw new Error(`proposal_${res.status}`);
  return (await res.json()) as { proposal: WalletProposalRecord; signatures: WalletProposalSigRecord[] };
}

export async function prepareProposal(
  walletAddress: string,
  proposalId: string
): Promise<{ proposal: WalletProposalRecord; userOpHash: string }> {
  const res = await fetch(apiUrl(`/api/wallet/${walletAddress}/proposals/${proposalId}/prepare`), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  if (!res.ok) throw new Error(`prepare_proposal_${res.status}`);
  return (await res.json()) as { proposal: WalletProposalRecord; userOpHash: string };
}

export async function signProposal(input: {
  walletAddress: string;
  proposalId: string;
  entityId: string;
  keyId: string;
  keyType: number;
  signature: string;
}): Promise<WalletProposalSigRecord> {
  const res = await fetch(
    apiUrl(`/api/wallet/${input.walletAddress}/proposals/${input.proposalId}/sign`),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    }
  );
  if (!res.ok) throw new Error(`sign_proposal_${res.status}`);
  const data = (await res.json()) as { signature: WalletProposalSigRecord };
  return data.signature;
}

export async function executeProposal(
  walletAddress: string,
  proposalId: string,
  signature?: string
): Promise<{ userOpHash: string }> {
  const res = await fetch(
    apiUrl(`/api/wallet/${walletAddress}/proposals/${proposalId}/execute`),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(signature ? { signature } : {}),
    }
  );
  if (!res.ok) throw new Error(`execute_proposal_${res.status}`);
  const data = (await res.json()) as { userOpHash: string };
  return data;
}
