export interface WalletDeviceRecord {
  walletAddress: string;
  chainId: string;
  ownerQx: string;
  ownerQy: string;
  label: string;
  credentialId: string | null;
  createdAt: string;
  lastUsedAt: string | null;
}

export interface WalletAccountRecord {
  address: string;
  salt: string;
  ownerQx: string;
  ownerQy: string;
  credentialId: string | null;
  webauthnAttestation: string | null;
  deployedChains: string[];
  createdAt: string;
  updatedAt: string;
}

export interface WalletChainConfig {
  chainId: string;
  factoryAddress: string;
  rpcUrl: string | null;
  feeTokenAddress: string | null;
  feeTokenSymbol: string;
  feeTokenDecimals: number;
  networkLabel?: string;
  /** Extra stables (e.g. USDT) available for on/off-ramp beyond the fee token. */
  stableTokens?: WalletStableToken[];
}

export interface WalletStableToken {
  symbol: string;
  address: string;
  decimals: number;
}

export interface WalletBalanceChain {
  chainId: string;
  networkLabel: string;
  balance: string;
  balanceUsd: string;
  deployed: boolean;
  feeTokenSymbol: string;
}

export interface WalletBalanceResponse {
  wallet: string;
  totalUsdc: string;
  totalUsd: string;
  chains: WalletBalanceChain[];
}

export interface WalletPairingRecord {
  nonce: string;
  walletAddress: string;
  chainId: string;
  newOwnerQx: string | null;
  newOwnerQy: string | null;
  deviceLabel: string | null;
  status: "pending" | "approved" | "consumed" | "expired";
  expiresAt: string;
  createdAt: string;
}

export interface WalletPublicConfig {
  chainId: string;
  factoryAddress: string | null;
  recoveryAddress: string | null;
  implementationAddress: string | null;
  rpcUrl: string | null;
  recoveryTimelockSeconds: number;
  entryPointAddress: string;
  bundlerFeeUsdc: string;
  bundlerFeeUsd: string;
  bundlerBeneficiary: string | null;
  feeTokenAddress: string | null;
  feeTokenSymbol: string;
  feeTokenDecimals: number;
  chains: WalletChainConfig[];
}

export type { PackedUserOperationJson, WalletUserOpRecord, UserOpStatus } from "./userop.js";

export interface BundlerRecord {
  address: string;
  label: string;
  chains: string[];
  enabled: boolean;
  createdAt: string;
  lastSeenAt: string | null;
}

/** HMAC partner / wallet client (server-to-server). */
export interface WalletClientRecord {
  id: string;
  label: string;
  rpId: string;
  origins: string[] | null;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface WalletIdentityRecord {
  clientId: string;
  email: string;
  walletAddress: string;
  contactJson: string | null;
  createdAt: string;
  updatedAt: string;
}

export type WalletChallengePurpose = "create" | "recover" | "cancel";

export interface WalletChallengeRecord {
  id: string;
  clientId: string;
  purpose: WalletChallengePurpose;
  challenge: string;
  email: string | null;
  walletAddress: string | null;
  consumed: boolean;
  expiresAt: string;
  createdAt: string;
}

export type WalletRecoveryJobKind = "initiate" | "cancel" | "execute";
export type WalletRecoveryJobStatus =
  | "pending"
  | "claimed"
  | "submitted"
  | "included"
  | "failed"
  | "rejected";

export interface WalletRecoveryJobRecord {
  id: string;
  walletAddress: string;
  chainId: string;
  kind: WalletRecoveryJobKind;
  newQx: string | null;
  newQy: string | null;
  cancelSignature: string | null;
  status: WalletRecoveryJobStatus;
  claimedBy: string | null;
  claimedUntil: string | null;
  version: number;
  txHash: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}
