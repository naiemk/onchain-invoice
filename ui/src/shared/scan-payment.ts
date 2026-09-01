import { getAddress, isAddress } from "ethers";

export type ParsedPaymentQr = {
  recipient: string;
  amount?: string;
};

/** Parse a scanned QR / pasted payment URI into recipient and optional amount. */
export function parsePaymentQr(text: string, tokenDecimals = 6): ParsedPaymentQr | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  if (isAddress(trimmed)) {
    return { recipient: getAddress(trimmed) };
  }

  if (trimmed.startsWith("0x") && isAddress(trimmed.split(/[?#]/)[0] ?? "")) {
    const addr = trimmed.split(/[?#]/)[0]!;
    return { recipient: getAddress(addr) };
  }

  let uri: URL;
  try {
    uri = new URL(trimmed);
  } catch {
    return null;
  }

  const scheme = uri.protocol.replace(":", "").toLowerCase();
  if (scheme !== "ethereum" && scheme !== "eip155") return null;

  let recipient: string | null = null;
  const path = uri.pathname.replace(/^\//, "");
  const pathParts = path.split("/").filter(Boolean);
  const isTransfer = pathParts.includes("transfer");

  const transferTarget = uri.searchParams.get("address");
  if (isTransfer && transferTarget && isAddress(transferTarget)) {
    recipient = getAddress(transferTarget);
  }

  const pathAddr = pathParts[0]?.split("@")[0];
  if (!recipient && pathAddr && isAddress(pathAddr) && !isTransfer) {
    recipient = getAddress(pathAddr);
  }

  if (!recipient && transferTarget && isAddress(transferTarget)) {
    recipient = getAddress(transferTarget);
  }

  const hostPart = uri.pathname ? uri.pathname.slice(1).split("/")[0] : uri.hostname;
  if (!recipient && hostPart) {
    const hostAddr = hostPart.split("@")[0];
    if (hostAddr && isAddress(hostAddr)) recipient = getAddress(hostAddr);
  }

  if (!recipient) {
    const opaque = uri.href.replace(/^ethereum:/i, "").split("?")[0]?.split("@")[0];
    if (opaque && isAddress(opaque)) recipient = getAddress(opaque);
  }

  if (!recipient) return null;

  let amount: string | undefined;
  const uint256 = uri.searchParams.get("uint256") ?? uri.searchParams.get("value");
  if (uint256 && /^\d+$/.test(uint256)) {
    const atoms = BigInt(uint256);
    const whole = atoms / 10n ** BigInt(tokenDecimals);
    const frac = atoms % 10n ** BigInt(tokenDecimals);
    const fracStr = frac.toString().padStart(tokenDecimals, "0").replace(/0+$/, "");
    amount = fracStr ? `${whole}.${fracStr}` : whole.toString();
  } else {
    const plain = uri.searchParams.get("amount");
    if (plain && /^\d+(\.\d+)?$/.test(plain)) amount = plain;
  }

  return { recipient, amount };
}
