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
