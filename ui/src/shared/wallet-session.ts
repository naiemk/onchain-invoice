import { credentialIdsMatch } from "./credential-id.js";
import { isInferredDeviceLabel, defaultWalletLabel } from "./wallet-label.js";

export type WalletSessionRole = "owner" | "member";

export interface WalletSession {
  address: string;
  chainId: string;
  salt: string;
  qx: string;
  qy: string;
  credentialId: string;
  rawId: string;
  label: string;
  lastOpenedAt?: string;
  /** Hosted identity (IdentityStore) this wallet belongs to. */
  identityId?: string;
  /** Super Wallet member session (entity key holder, not simple-mode owner). */
  role?: WalletSessionRole;
  entityId?: string;
  keyId?: string;
  keyType?: number;
  eoa?: string;
  /** YubiKey backup credential id (also remembered across lock for recovery). */
  securityKeyCredentialId?: string;
}

const LEGACY_SESSION_KEY = "tc-wallet-session";
const REGISTRY_KEY = "tc-wallet-registry";
const ACTIVE_KEY = "tc-wallet-active";
const SECURITY_KEY_IDS_KEY = "tc-wallet-security-key-ids";
const IDENTITY_ONLY_KEY = "tc-wallet-identity-only-v1";

export const WALLET_SESSION_EVENT = "tc-wallet-session";

function notifyWalletSessionChange(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(WALLET_SESSION_EVENT));
}

function normalizeAddress(address: string): string {
  return address.toLowerCase();
}

function normalizeHex(value: string | undefined | null): string {
  return (value ?? "").toLowerCase();
}

/** Compare session payloads, ignoring lastOpenedAt (heal/persist no-ops). */
export function walletSessionsEquivalent(a: WalletSession, b: WalletSession): boolean {
  return (
    normalizeAddress(a.address) === normalizeAddress(b.address) &&
    a.chainId === b.chainId &&
    normalizeHex(a.salt) === normalizeHex(b.salt) &&
    normalizeHex(a.qx) === normalizeHex(b.qx) &&
    normalizeHex(a.qy) === normalizeHex(b.qy) &&
    a.credentialId === b.credentialId &&
    a.rawId === b.rawId &&
    a.label === b.label &&
    (a.role ?? "owner") === (b.role ?? "owner") &&
    normalizeHex(a.entityId) === normalizeHex(b.entityId) &&
    normalizeHex(a.keyId) === normalizeHex(b.keyId) &&
    (a.keyType ?? 0) === (b.keyType ?? 0) &&
    normalizeHex(a.eoa) === normalizeHex(b.eoa) &&
    (a.securityKeyCredentialId ?? "") === (b.securityKeyCredentialId ?? "") &&
    normalizeHex(a.identityId) === normalizeHex(b.identityId)
  );
}

export function isActiveWalletAddress(address: string): boolean {
  if (typeof localStorage === "undefined") return false;
  migrateWalletSessionStorage();
  const active = localStorage.getItem(ACTIVE_KEY);
  return Boolean(active && normalizeAddress(active) === normalizeAddress(address));
}

function readRegistryRaw(): WalletSession[] {
  try {
    const raw = localStorage.getItem(REGISTRY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as WalletSession[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeRegistry(entries: WalletSession[]): void {
  localStorage.setItem(REGISTRY_KEY, JSON.stringify(entries));
  for (const row of entries) rememberSecurityKeyCredential(row.securityKeyCredentialId);
}

/** Keep YubiKey credential ids after lock so recovery can pin WebAuthn allowCredentials. */
export function rememberSecurityKeyCredential(credentialId?: string | null): void {
  const id = credentialId?.trim();
  if (!id || typeof localStorage === "undefined") return;
  const ids = listRememberedSecurityKeyIds();
  if (ids.some((existing) => credentialIdsMatch(existing, id))) return;
  localStorage.setItem(SECURITY_KEY_IDS_KEY, JSON.stringify([...ids, id]));
}

export function listRememberedSecurityKeyIds(): string[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(SECURITY_KEY_IDS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.map((value) => String(value).trim()).filter(Boolean);
  } catch {
    return [];
  }
}

const LABEL_MIGRATE_KEY = "tc-wallet-label-v2";

function migrateInferredWalletLabels(): void {
  if (typeof localStorage === "undefined") return;
  if (localStorage.getItem(LABEL_MIGRATE_KEY) === "1") return;
  const registry = readRegistryRaw();
  const next = registry.map((w, i) =>
    isInferredDeviceLabel(w.label) ? { ...w, label: defaultWalletLabel(i) } : w
  );
  if (next.some((w, i) => w.label !== registry[i]?.label)) {
    writeRegistry(next);
    const active = localStorage.getItem(ACTIVE_KEY);
    if (active) {
      const cur = next.find((w) => normalizeAddress(w.address) === normalizeAddress(active));
      if (cur) localStorage.setItem(LEGACY_SESSION_KEY, JSON.stringify(cur));
    }
  }
  localStorage.setItem(LABEL_MIGRATE_KEY, "1");
}

/** Drop pre-identity sessions. First run of this build clears the messed-up registry. */
function dropLegacyWalletSessions(): void {
  if (typeof localStorage === "undefined") return;
  if (localStorage.getItem(IDENTITY_ONLY_KEY) !== "1") {
    localStorage.removeItem(ACTIVE_KEY);
    localStorage.removeItem(LEGACY_SESSION_KEY);
    localStorage.removeItem(REGISTRY_KEY);
    localStorage.setItem(IDENTITY_ONLY_KEY, "1");
    notifyWalletSessionChange();
    return;
  }
  const registry = readRegistryRaw();
  const identityOnly = registry.filter((w) => Boolean(w.identityId));
  if (identityOnly.length !== registry.length) writeRegistry(identityOnly);
  const active = localStorage.getItem(ACTIVE_KEY);
  if (active && !identityOnly.some((w) => normalizeAddress(w.address) === normalizeAddress(active))) {
    localStorage.removeItem(ACTIVE_KEY);
    localStorage.removeItem(LEGACY_SESSION_KEY);
  }
}

/** One-time migrate legacy single session into registry + active. */
export function migrateWalletSessionStorage(): void {
  try {
    const legacy = localStorage.getItem(LEGACY_SESSION_KEY);
    if (!legacy) return;
    const session = JSON.parse(legacy) as WalletSession;
    if (!session?.address) {
      localStorage.removeItem(LEGACY_SESSION_KEY);
      return;
    }
    const registry = readRegistryRaw();
    const addr = normalizeAddress(session.address);
    if (!registry.some((w) => normalizeAddress(w.address) === addr)) {
      registry.push({ ...session, address: addr });
      writeRegistry(registry);
    }
    if (!localStorage.getItem(ACTIVE_KEY)) {
      localStorage.setItem(ACTIVE_KEY, addr);
    }
    localStorage.removeItem(LEGACY_SESSION_KEY);
  } catch {
    localStorage.removeItem(LEGACY_SESSION_KEY);
  }
}

export function listWalletRegistry(): WalletSession[] {
  migrateWalletSessionStorage();
  migrateInferredWalletLabels();
  dropLegacyWalletSessions();
  const rows = readRegistryRaw();
  for (const row of rows) rememberSecurityKeyCredential(row.securityKeyCredentialId);
  return rows;
}

/** Registry entries matching the current deployment (testnet vs mainnet). */
export function listWalletRegistryForDeployment(
  isTestnetChain: (chainId: string) => boolean,
  deploymentIsTestnet: boolean
): WalletSession[] {
  return listWalletRegistry().filter((w) => isTestnetChain(w.chainId) === deploymentIsTestnet);
}

/** Add or refresh a wallet in the local list without making it the active session. */
export function addWalletToRegistry(session: WalletSession): void {
  migrateWalletSessionStorage();
  const addr = normalizeAddress(session.address);
  const next: WalletSession = { ...session, address: addr, lastOpenedAt: new Date().toISOString() };
  const registry = readRegistryRaw().filter((w) => normalizeAddress(w.address) !== addr);
  registry.unshift(next);
  writeRegistry(registry);
  notifyWalletSessionChange();
}

export function upsertWalletSession(session: WalletSession): void {
  migrateWalletSessionStorage();
  const addr = normalizeAddress(session.address);
  const registry = readRegistryRaw();
  const existing = registry.find((w) => normalizeAddress(w.address) === addr);
  const next: WalletSession = {
    ...session,
    address: addr,
    lastOpenedAt: existing?.lastOpenedAt ?? new Date().toISOString(),
  };
  const active = localStorage.getItem(ACTIVE_KEY);
  // Already the open wallet with the same payload — skip write/notify so heal cannot loop.
  if (active && normalizeAddress(active) === addr && existing && walletSessionsEquivalent(existing, next)) {
    return;
  }
  const updated: WalletSession = { ...next, lastOpenedAt: new Date().toISOString() };
  writeRegistry([updated, ...registry.filter((w) => normalizeAddress(w.address) !== addr)]);
  localStorage.setItem(ACTIVE_KEY, addr);
  localStorage.setItem(LEGACY_SESSION_KEY, JSON.stringify(updated));
  notifyWalletSessionChange();
}

export function saveMemberWalletSession(input: {
  address: string;
  chainId: string;
  entityId: string;
  keyId: string;
  keyType: number;
  qx: string;
  qy: string;
  credentialId: string;
  rawId: string;
  label: string;
  eoa?: string;
}): void {
  upsertWalletSession({
    address: input.address,
    chainId: input.chainId,
    salt: "0x" + "00".repeat(32),
    qx: input.qx,
    qy: input.qy,
    credentialId: input.credentialId,
    rawId: input.rawId,
    label: input.label,
    role: "member",
    entityId: input.entityId,
    keyId: input.keyId,
    keyType: input.keyType,
    eoa: input.eoa,
  });
}

export function setActiveWallet(address: string): boolean {
  migrateWalletSessionStorage();
  const addr = normalizeAddress(address);
  const found = readRegistryRaw().find((w) => normalizeAddress(w.address) === addr);
  if (!found) return false;
  localStorage.setItem(ACTIVE_KEY, addr);
  localStorage.setItem(LEGACY_SESSION_KEY, JSON.stringify(found));
  notifyWalletSessionChange();
  return true;
}

export function loadWalletSession(): WalletSession | null {
  migrateWalletSessionStorage();
  migrateInferredWalletLabels();
  dropLegacyWalletSessions();
  const active = localStorage.getItem(ACTIVE_KEY);
  if (!active) return null;
  const registry = readRegistryRaw();
  const found = registry.find((w) => normalizeAddress(w.address) === normalizeAddress(active)) ?? null;
  return found?.identityId ? found : null;
}

/** Clear active wallet only; keep registry so picker can reopen. */
export function clearActiveWallet(): void {
  migrateWalletSessionStorage();
  localStorage.removeItem(ACTIVE_KEY);
  localStorage.removeItem(LEGACY_SESSION_KEY);
  notifyWalletSessionChange();
}

/** Clear active and remove one wallet from the registry. */
export function removeFromRegistry(address: string): void {
  migrateWalletSessionStorage();
  const addr = normalizeAddress(address);
  const registry = readRegistryRaw().filter((w) => normalizeAddress(w.address) !== addr);
  writeRegistry(registry);
  const active = localStorage.getItem(ACTIVE_KEY);
  if (active && normalizeAddress(active) === addr) {
    clearActiveWallet();
  }
}

/** Sign out of active wallet (alias used by UI). */
export function clearWalletSession(): void {
  clearActiveWallet();
}

/** Clear registry + active wallet (identity logout). */
export function clearAllWalletLocalState(): void {
  if (typeof localStorage === "undefined") return;
  localStorage.removeItem(ACTIVE_KEY);
  localStorage.removeItem(LEGACY_SESSION_KEY);
  localStorage.removeItem(REGISTRY_KEY);
  notifyWalletSessionChange();
}

/** Persist session as active + registry entry (create / unlock). */
export function saveWalletSession(session: WalletSession): void {
  if (!session.identityId) return;
  upsertWalletSession({ ...session, role: session.role ?? "owner" });
}

/**
 * Update the open wallet in place. No-op if the user locked or switched away,
 * so in-flight heals cannot restore a previous session.
 */
export function saveWalletSessionIfActive(session: WalletSession): boolean {
  if (!isActiveWalletAddress(session.address)) return false;
  saveWalletSession(session);
  return true;
}

export function shortAddress(address: string): string {
  if (address.length < 12) return address;
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}
