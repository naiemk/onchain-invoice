/**
 * Shared types for the local deploy operator console.
 * No private keys — seed + public addresses only.
 */
export type EvChainConfig = {
  kind: "evm";
  chainId: number;
  rpcUrl: string;
  explorer?: string;
  enabled?: boolean;
  sweeper?: string;
  forwarderImplementation?: string;
  deployedAt?: string;
  deployTx?: string;
};

export type SolanaChainConfig = {
  kind: "solana";
  chainId: string;
  rpcUrl: string;
  enabled?: boolean;
  feeBps?: number;
  authority?: string;
  feeRecipient?: string;
  programId?: string;
  configPda?: string;
  deployedAt?: string;
  initializeTx?: string;
};

export type IdentityChainResult = {
  identityStore?: string;
  walletImplementation?: string;
  factory?: string;
  deployer?: string;
  restoreDelaySet?: boolean;
  ownershipTransferred?: boolean;
  deployedAt?: string;
};

/** Identity wallet stack (IdentityStore + IdentityWallet impl + IdentityWalletFactory). Addresses only. */
export type IdentityConfig = {
  /** Production: reco 2-of-3 Super Wallet. */
  recoveryOperator: string;
  /** Production: timelocked multisig. Empty = keep deployer as owner (not mainnet-safe). */
  storeOwner: string;
  /** Seconds; assurance doc requires 259200 (3 days). */
  restoreDelay: number;
  /** Keyed by chain key in `chains` (base, sepolia). */
  chains: Record<string, IdentityChainResult>;
};

export type OperatorConfig = {
  seed: string;
  feeBps: number;
  feeRecipient: string;
  owner: string;
  create2Factory: string;
  chains: Record<string, EvChainConfig>;
  solana?: SolanaChainConfig;
  identity?: IdentityConfig;
};

export type LogEvent = {
  ts: string;
  stream: "stdout" | "stderr" | "info" | "error" | "success" | "warn";
  line: string;
};
