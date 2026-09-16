import type { LoginMethodFlags } from "./identity-store.js";

/*
 * Identity recovery when the commerce SQLite DB is gone but this domain still
 * holds the user's WebAuthn credential (same rpId):
 *
 * Sign-in is email → passkey on this origin. Wallets are derived from
 * (identityId, salt index) via IdentityWalletFactory, so restoring the identity
 * brings every wallet back. There is no per-wallet recover/relink path.
 *
 * Not built yet. Do not re-add "relink this device" or "recover existing wallet"
 * on the home screen until this reconstructs identity_methods + wallet_accounts
 * from the passkey + on-chain store/factory.
 */

export type IdentityMethodKind = "webauthn" | "yubikey" | "eoa";

export interface IdentityRecord {
  identityId: string;
  email: string;
  googleSub: string | null;
  createdAt: string;
}

export interface IdentityMethodRecord {
  id: string;
  identityId: string;
  kind: IdentityMethodKind;
  credentialId: string | null;
  qx: string | null;
  qy: string | null;
  eoa: string | null;
  createdAt: string;
}

export interface IdentityEmailLookupResponse {
  exists: boolean;
  /** Present when `exists` is true so pairing can start without an identity cookie. */
  identityId?: string;
  options?: LoginMethodFlags;
  restoreEnabled?: boolean;
}

export interface IdentityMeResponse {
  email: string;
  identityId: string;
  methods: { webauthn: number; yubikey: number; eoa: number };
  /** Authenticated method rows (credential id + pubkey). This device signs with the row matching session.credentialId. */
  keys?: IdentityMethodRecord[];
  identityExists: boolean;
  options: LoginMethodFlags;
  restoreEnabled?: boolean;
}

export interface IdentityRecoverWallet {
  address: string;
  salt: string;
  label: string | null;
}

export interface IdentityRecoverProveResponse {
  email: string;
  identityId: string;
  restoreEnabled: boolean;
  methods: { webauthn: number; yubikey: number; eoa: number };
  wallets: IdentityRecoverWallet[];
  provingMethod: {
    kind: IdentityMethodKind;
    credentialId: string | null;
    qx: string | null;
    qy: string | null;
    eoa: string | null;
  };
}

export const IDENTITY_COOKIE_NAME = "tc_identity";
export const IDENTITY_RECOVER_COOKIE_NAME = "tc_identity_recover";
export const GOOGLE_OAUTH_COOKIE_NAME = "tc_google_oauth";
