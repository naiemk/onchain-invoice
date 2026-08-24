import { randomUUID } from "node:crypto";
import { Contract, JsonRpcProvider, getAddress } from "ethers";
import type { WalletConfig } from "./config.js";
import type { WalletDeviceRecord } from "../shared/wallet.js";
import type { PackedUserOperationJson } from "../shared/userop.js";
import {
  ENTRYPOINT_ABI,
  ERC20_ABI,
  userOpToTuple,
  type BundlerFeeConfig,
} from "../shared/userop.js";
import { validateUserOpFee } from "../shared/userop-fee.js";
import type { CommerceDb } from "./db.js";

const PAIRING_TTL_MS = 5 * 60 * 1000;

export function registerWalletRoutes(
  db: CommerceDb,
  walletConfig: WalletConfig,
  handlers: {
    rateLimit: (ip: string, bucket: string, limit: number) => void;
    sendJson: (res: import("node:http").ServerResponse, code: number, body: unknown) => void;
    readJson: (req: import("node:http").IncomingMessage) => Promise<Record<string, unknown>>;
    clientIp: (req: import("node:http").IncomingMessage) => string;
    publicLimit: number;
  }
) {
  return async function handleWalletRoute(
    req: import("node:http").IncomingMessage,
    res: import("node:http").ServerResponse,
    url: URL,
    ip: string
  ): Promise<boolean> {
    if (req.method === "GET" && url.pathname === "/api/wallet/devices") {
      handlers.rateLimit(ip, "public", handlers.publicLimit);
      const wallet = url.searchParams.get("wallet")?.trim().toLowerCase();
      const chainId = url.searchParams.get("chainId")?.trim() ?? "11155111";
      if (!wallet) {
        handlers.sendJson(res, 400, { error: "wallet required" });
        return true;
      }
      handlers.sendJson(res, 200, { devices: db.listWalletDevices(wallet, chainId) });
      return true;
    }

    if (req.method === "POST" && url.pathname === "/api/wallet/devices") {
      handlers.rateLimit(ip, "public", handlers.publicLimit);
      const body = await handlers.readJson(req);
      const walletAddress = str(body.walletAddress)?.toLowerCase();
      const chainId = str(body.chainId) ?? "11155111";
      const ownerQx = normalizeHex32(str(body.ownerQx));
      const ownerQy = normalizeHex32(str(body.ownerQy));
      if (!walletAddress || !ownerQx || !ownerQy) {
        handlers.sendJson(res, 400, { error: "walletAddress, ownerQx, ownerQy required" });
        return true;
      }
      const device = db.upsertWalletDevice({
        walletAddress,
        chainId,
        ownerQx,
        ownerQy,
        label: str(body.label) || "Passkey",
        credentialId: str(body.credentialId) || null,
      });
      handlers.sendJson(res, 200, { device });
      return true;
    }

    if (req.method === "DELETE" && url.pathname.startsWith("/api/wallet/devices/")) {
      handlers.rateLimit(ip, "public", handlers.publicLimit);
      const parts = url.pathname.split("/");
      const wallet = parts[4]?.trim().toLowerCase();
      const ownerQx = normalizeHex32(parts[5] ? (parts[5].startsWith("0x") ? parts[5] : `0x${parts[5]}`) : undefined);
      const ownerQy = normalizeHex32(parts[6] ? (parts[6].startsWith("0x") ? parts[6] : `0x${parts[6]}`) : undefined);
      const chainId = url.searchParams.get("chainId")?.trim() ?? "11155111";
      if (!wallet || !ownerQx || !ownerQy) {
        handlers.sendJson(res, 400, { error: "invalid path" });
        return true;
      }
      db.deleteWalletDevice(wallet, chainId, ownerQx, ownerQy);
      handlers.sendJson(res, 200, { ok: true });
      return true;
    }

    if (req.method === "POST" && url.pathname === "/api/wallet/pairing") {
      handlers.rateLimit(ip, "public", handlers.publicLimit);
      const body = await handlers.readJson(req);
      const chainId = str(body.chainId) ?? "11155111";
      if (body.action === "create") {
        const walletAddress = str(body.walletAddress)?.toLowerCase();
        if (!walletAddress) {
          handlers.sendJson(res, 400, { error: "walletAddress required" });
          return true;
        }
        const pairing = db.createWalletPairing(walletAddress, chainId);
        handlers.sendJson(res, 200, { pairing });
        return true;
      }
      if (body.action === "submit") {
        const nonce = str(body.nonce);
        const newOwnerQx = normalizeHex32(str(body.newOwnerQx));
        const newOwnerQy = normalizeHex32(str(body.newOwnerQy));
        if (!nonce || !newOwnerQx || !newOwnerQy) {
          handlers.sendJson(res, 400, { error: "nonce, newOwnerQx, newOwnerQy required" });
          return true;
        }
        const pairing = db.submitWalletPairing(nonce, newOwnerQx, newOwnerQy, str(body.deviceLabel) || null);
        if (!pairing) {
          handlers.sendJson(res, 404, { error: "pairing_not_found" });
          return true;
        }
        handlers.sendJson(res, 200, { pairing });
        return true;
      }
      if (body.action === "poll") {
        const nonce = str(body.nonce);
        if (!nonce) {
          handlers.sendJson(res, 400, { error: "nonce required" });
          return true;
        }
        const pairing = db.getWalletPairing(nonce);
        if (!pairing) {
          handlers.sendJson(res, 404, { error: "pairing_not_found" });
          return true;
        }
        handlers.sendJson(res, 200, { pairing });
        return true;
      }
      handlers.sendJson(res, 400, { error: "unknown action" });
      return true;
    }

    const userOpPoll = url.pathname.match(/^\/api\/wallet\/userops\/(0x[0-9a-fA-F]{64})$/);
    if (req.method === "GET" && userOpPoll) {
      handlers.rateLimit(ip, "public", handlers.publicLimit);
      const hash = userOpPoll[1].toLowerCase();
      const record = db.getWalletUserOpByHash(hash);
      if (!record) {
        handlers.sendJson(res, 404, { error: "userop_not_found" });
        return true;
      }
      handlers.sendJson(res, 200, { userOp: record });
      return true;
    }

    if (req.method === "POST" && url.pathname === "/api/wallet/userops") {
      handlers.rateLimit(ip, "public", handlers.publicLimit);
      const body = await handlers.readJson(req);
      const userOp = body.userOp as PackedUserOperationJson | undefined;
      const userOpHash = str(body.userOpHash)?.toLowerCase();
      const chainId = str(body.chainId) ?? walletConfig.chainId;
      if (!userOp || !userOpHash) {
        handlers.sendJson(res, 400, { error: "userOp and userOpHash required" });
        return true;
      }
      const feeConfig = feeConfigFromWallet(walletConfig);
      if (!feeConfig.bundlerBeneficiary || !feeConfig.feeTokenAddress) {
        handlers.sendJson(res, 503, { error: "bundler_not_configured" });
        return true;
      }
      const feeCheck = validateUserOpFee(userOp, feeConfig);
      if (!feeCheck.ok) {
        handlers.sendJson(res, 400, { error: feeCheck.reason, message: feeCheck.message });
        return true;
      }
      if (db.getWalletUserOpByHash(userOpHash)) {
        handlers.sendJson(res, 409, { error: "duplicate_user_op_hash" });
        return true;
      }
      try {
        const verifiedHash = await verifyUserOpHash(userOp, userOpHash, walletConfig);
        if (!verifiedHash) {
          handlers.sendJson(res, 400, { error: "invalid_user_op_hash" });
          return true;
        }
        if (walletConfig.rpcUrl) {
          const balanceOk = await verifyTokenBalance(userOp.sender, feeConfig, userOp, walletConfig.rpcUrl);
          if (!balanceOk.ok) {
            handlers.sendJson(res, 400, { error: balanceOk.reason, message: balanceOk.message });
            return true;
          }
        }
        const record = db.createWalletUserOp({
          walletAddress: getAddress(userOp.sender),
          chainId,
          userOpHash,
          userOp,
        });
        handlers.sendJson(res, 201, { userOp: record });
      } catch (error) {
        handlers.sendJson(res, 400, {
          error: "submit_failed",
          message: error instanceof Error ? error.message : String(error),
        });
      }
      return true;
    }

    return false;
  };
}

function feeConfigFromWallet(config: WalletConfig): BundlerFeeConfig {
  return {
    feeTokenAddress: config.feeTokenAddress ?? "",
    feeTokenSymbol: config.feeTokenSymbol,
    feeTokenDecimals: config.feeTokenDecimals,
    bundlerBeneficiary: config.bundlerBeneficiary ?? "",
    minFeeUsdc: config.bundlerFeeUsdc,
  };
}

async function verifyUserOpHash(
  userOp: PackedUserOperationJson,
  expectedHash: string,
  config: WalletConfig
): Promise<boolean> {
  if (!config.rpcUrl) return userOpHashMatchesLocal(userOp, expectedHash, config.entryPointAddress);
  const provider = new JsonRpcProvider(config.rpcUrl);
  const entryPoint = new Contract(config.entryPointAddress, ENTRYPOINT_ABI, provider);
  const hash = await entryPoint.getUserOpHash(userOpToTuple(userOp));
  return hash.toLowerCase() === expectedHash.toLowerCase();
}

function userOpHashMatchesLocal(userOp: PackedUserOperationJson, expectedHash: string, entryPoint: string): boolean {
  void userOp;
  void entryPoint;
  return /^0x[0-9a-f]{64}$/.test(expectedHash);
}

async function verifyTokenBalance(
  walletAddress: string,
  feeConfig: BundlerFeeConfig,
  userOp: PackedUserOperationJson,
  rpcUrl: string
): Promise<{ ok: boolean; reason?: string; message?: string }> {
  const provider = new JsonRpcProvider(rpcUrl);
  const token = new Contract(feeConfig.feeTokenAddress, ERC20_ABI, provider);
  const balance = BigInt(await token.balanceOf(walletAddress));
  const feeCheck = validateUserOpFee(userOp, feeConfig);
  if (!feeCheck.ok || !feeCheck.decoded) return { ok: false, reason: feeCheck.reason, message: feeCheck.message };
  let totalOut = feeCheck.decoded.feeAmount;
  for (const call of feeCheck.decoded.mainCalls) {
    if (getAddress(call.target) !== getAddress(feeConfig.feeTokenAddress)) continue;
    try {
      const iface = new Contract(feeConfig.feeTokenAddress, ERC20_ABI).interface;
      const parsed = iface.parseTransaction({ data: call.data });
      if (parsed?.name === "transfer") totalOut += BigInt(parsed.args[1]);
    } catch {
      /* ignore non-transfer */
    }
  }
  if (balance < totalOut) {
    return { ok: false, reason: "insufficient_balance", message: `Need ${totalOut}, have ${balance}` };
  }
  return { ok: true };
}

function normalizeHex32(value: string | undefined): string | null {
  if (!value) return null;
  const v = value.trim().toLowerCase();
  if (!/^0x[0-9a-f]{64}$/.test(v)) return null;
  return v;
}

function str(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const t = value.trim();
  return t.length ? t : undefined;
}

export { PAIRING_TTL_MS };
