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
  turnstileSiteKey?: string | null;
  chains: WalletChainConfig[];
  /** ABI fragments for advanced entity M-of-N policy (Super Wallet). */
  advancedWalletAbi?: string[];
}

export interface WalletEntityRecord {
  walletAddress: string;
  entityId: string;
  label: string | null;
  createdAt: string;
}

export interface WalletEntityKeyRecord {
  walletAddress: string;
  entityId: string;
  keyId: string;
  keyType: number;
  qx: string | null;
  qy: string | null;
  eoa: string | null;
  credentialId: string | null;
  createdAt: string;
}

export type WalletProposalStatus = "draft" | "signing" | "ready" | "executed" | "cancelled";

export interface WalletProposalRecord {
  id: string;
  walletAddress: string;
  chainId: string;
  target: string;
  value: string;
  data: string;
  nonce: string | null;
  status: WalletProposalStatus;
  createdAt: string;
  updatedAt: string;
}

export interface WalletProposalSigRecord {
  proposalId: string;
  entityId: string;
  keyId: string;
  keyType: number;
  signature: string;
  createdAt: string;
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

/** Hosted wallet email binding (backend only, not on-chain). */
export interface WalletEmailRecord {
  walletAddress: string;
  email: string;
  verifiedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export type WalletEmailOtpPurpose = "attach" | "recover";

export type WalletRecoveryRequestStatus =
  | "awaiting_email"
  | "awaiting_guardian"
  | "queued"
  | "on_chain"
  | "completed"
  | "cancelled"
  | "rejected"
  | "archived";

export interface WalletRecoveryRequestRecord {
  id: string;
  walletAddress: string;
  email: string;
  newQx: string;
  newQy: string;
  credentialId: string;
  deviceLabel: string | null;
  status: WalletRecoveryRequestStatus;
  emailVerifiedAt: string | null;
  captchaOkAt: string | null;
  guardianAddress: string | null;
  guardianActedAt: string | null;
  jobId: string | null;
  chainId: string;
  createdAt: string;
  updatedAt: string;
}

export type HostedRecoveryChallengePurpose = "attach" | "recover" | "cancel";

export interface HostedRecoveryChallengeRecord {
  id: string;
  purpose: HostedRecoveryChallengePurpose;
  challenge: string;
  walletAddress: string | null;
  consumed: boolean;
  expiresAt: string;
  createdAt: string;
}
