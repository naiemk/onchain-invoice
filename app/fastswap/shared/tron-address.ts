import { utils as tronUtils } from "tronweb";
import { getAddress } from "ethers";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

/**
 * TRON base58 (`T...`) and TVM hex (`41` + 20 bytes) addresses both wrap the same
 * 20-byte body that EVM ABI encoding expects in an `address` slot. These helpers
 * convert between the TRON representations and the 20-byte `0x` hex body so a single
 * encoded SwapIntent stays consistent across source derivation, sweep, and relay.
 */

export function isTronBase58Address(value: string): boolean {
  return typeof value === "string" && value.startsWith("T") && tronUtils.address.isAddress(value);
}

/** Convert a TRON address (`T...` base58 or `41...`/`0x41...` hex) to a 20-byte `0x` hex body. */
export function tronAddressToEvmHex(value: string): string {
  const hex = tronUtils.address.toHex(value);
  const normalized = hex.replace(/^0x/i, "");
  // TVM hex addresses are prefixed with the network byte `41`; the ABI address slot is the 20-byte body.
  const body = normalized.length === 42 && normalized.startsWith("41") ? normalized.slice(2) : normalized;
  return getAddress(`0x${body.padStart(40, "0")}`);
}

/** Convert a 20-byte `0x` hex body to a TRON base58 (`T...`) address. */
export function evmHexToTronBase58(value: string): string {
  const body = value.replace(/^0x/i, "").padStart(40, "0");
  return tronUtils.address.fromHex(`41${body}`);
}

export function isZeroEvmAddress(value: string | undefined): boolean {
  return !value || value.toLowerCase() === ZERO_ADDRESS;
}

export { ZERO_ADDRESS };
