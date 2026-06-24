import { getAddress, Wallet } from "ethers";

/** Resolve an EVM owner address from config/env or the deployer wallet. */
export function resolveEvmOwnerAddress(ownerOrKey: string | undefined, walletAddress: string): string {
  const value = ownerOrKey?.trim();
  if (!value) return getAddress(walletAddress);
  if (/^0x[0-9a-fA-F]{40}$/.test(value)) return getAddress(value);
  if (/^0x[0-9a-fA-F]{64}$/.test(value)) return getAddress(new Wallet(value).address);
  return getAddress(value);
}
