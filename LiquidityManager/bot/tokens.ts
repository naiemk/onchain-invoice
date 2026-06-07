import { utils as tronUtils } from "tronweb";
import { getAddress } from "ethers";
import { NATIVE_TOKEN, type ChainType, type TokenBand } from "../shared/types.js";
import { TRON_NATIVE_FLOOR } from "./fastswap.js";

/** Normalize an on-chain token address to the band-key form (`0x…` body, or `NATIVE_TOKEN`). */
export function normalizeTokenKey(value: string | undefined): string {
  if (!value || value.toLowerCase() === NATIVE_TOKEN) return NATIVE_TOKEN;
  if (value.startsWith("T") && tronUtils.address.isAddress(value)) {
    const hex = tronUtils.address.toHex(value).replace(/^0x/i, "");
    const body = hex.length === 42 && hex.startsWith("41") ? hex.slice(2) : hex;
    return getAddress(`0x${body.padStart(40, "0")}`).toLowerCase();
  }
  try {
    return getAddress(value).toLowerCase();
  } catch {
    return value.toLowerCase();
  }
}

/** Token address passed to FastSwap receiver view/write calls (native sentinel per chain). */
export function receiverTokenArg(tokenKey: string, chainType: ChainType): string {
  if (tokenKey === NATIVE_TOKEN) return chainType === "tron" ? TRON_NATIVE_FLOOR : NATIVE_TOKEN;
  return tokenKey;
}

export function bandTokenKey(token: Pick<TokenBand, "address">): string {
  return token.address ? token.address.toLowerCase() : NATIVE_TOKEN;
}
