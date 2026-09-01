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
  /** Super Wallet member session (entity key holder, not simple-mode owner). */
  role?: WalletSessionRole;
  entityId?: string;
  keyId?: string;
  keyType?: number;
  eoa?: string;
  /** Simple-wallet YubiKey backup credential (non-discoverable). */
  securityKeyCredentialId?: string;
}

const LEGACY_SESSION_KEY = "tc-wallet-session";
const REGISTRY_KEY = "tc-wallet-registry";
const ACTIVE_KEY = "tc-wallet-active";

export const WALLET_SESSION_EVENT = "tc-wallet-session";

function notifyWalletSessionChange(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(WALLET_SESSION_EVENT));
}

function normalizeAddress(address: string): string {
  return address.toLowerCase();
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
  return readRegistryRaw();
}

/** Registry entries matching the current deployment (testnet vs mainnet). */
export function listWalletRegistryForDeployment(
  isTestnetChain: (chainId: string) => boolean,
  deploymentIsTestnet: boolean
): WalletSession[] {
  return listWalletRegistry().filter((w) => isTestnetChain(w.chainId) === deploymentIsTestnet);
}

export function upsertWalletSession(session: WalletSession): void {
  migrateWalletSessionStorage();
  const addr = normalizeAddress(session.address);
  const next: WalletSession = { ...session, address: addr, lastOpenedAt: new Date().toISOString() };
  const registry = readRegistryRaw().filter((w) => normalizeAddress(w.address) !== addr);
  registry.unshift(next);
  writeRegistry(registry);
  localStorage.setItem(ACTIVE_KEY, addr);
  localStorage.setItem(LEGACY_SESSION_KEY, JSON.stringify(next));
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
  const active = localStorage.getItem(ACTIVE_KEY);
  if (!active) return null;
  const registry = readRegistryRaw();
  return registry.find((w) => normalizeAddress(w.address) === normalizeAddress(active)) ?? null;
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

/** Persist session as active + registry entry (create / unlock). */
export function saveWalletSession(session: WalletSession): void {
  upsertWalletSession({ ...session, role: session.role ?? "owner" });
}

export function shortAddress(address: string): string {
  if (address.length < 12) return address;
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}
