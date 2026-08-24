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
  rpcUrl: string | null;
  recoveryTimelockSeconds: number;
  entryPointAddress: string;
  bundlerFeeUsdc: string;
  bundlerFeeUsd: string;
  bundlerBeneficiary: string | null;
  feeTokenAddress: string | null;
  feeTokenSymbol: string;
  feeTokenDecimals: number;
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
