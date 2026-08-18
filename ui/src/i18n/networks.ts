import { t } from "./t.js";

const NETWORK_KEYS: Record<string, { label: "networks.sepolia" | "networks.nile" | "networks.solDevnet" | "networks.tron" | "networks.base" | "networks.bnb" | "networks.ethereum" | "networks.arbitrum" | "networks.solana"; short: "networks.sepoliaShort" | "networks.nileShort" | "networks.solDevnetShort" | "networks.tronShort" | "networks.baseShort" | "networks.bnbShort" | "networks.ethereumShort" | "networks.arbitrumShort" | "networks.solanaShort" }> = {
  "11155111": { label: "networks.sepolia", short: "networks.sepoliaShort" },
  nile: { label: "networks.nile", short: "networks.nileShort" },
  shasta: { label: "networks.nile", short: "networks.nileShort" },
  devnet: { label: "networks.solDevnet", short: "networks.solDevnetShort" },
  tron: { label: "networks.tron", short: "networks.tronShort" },
  "8453": { label: "networks.base", short: "networks.baseShort" },
  "56": { label: "networks.bnb", short: "networks.bnbShort" },
  "1": { label: "networks.ethereum", short: "networks.ethereumShort" },
  "42161": { label: "networks.arbitrum", short: "networks.arbitrumShort" },
  "mainnet-beta": { label: "networks.solana", short: "networks.solanaShort" },
};

export function localizedNetworkLabel(chainId: string): string {
  const keys = NETWORK_KEYS[chainId];
  return keys ? t(keys.label) : t("networks.unknown", { chainId });
}

export function localizedNetworkShort(chainId: string): string {
  const keys = NETWORK_KEYS[chainId];
  return keys ? t(keys.short) : localizedNetworkLabel(chainId);
}
