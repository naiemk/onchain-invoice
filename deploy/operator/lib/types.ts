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

export type OperatorConfig = {
  seed: string;
  feeBps: number;
  feeRecipient: string;
  owner: string;
  create2Factory: string;
  chains: Record<string, EvChainConfig>;
  solana?: SolanaChainConfig;
};

export type LogEvent = {
  ts: string;
  stream: "stdout" | "stderr" | "info" | "error" | "success";
  line: string;
};
