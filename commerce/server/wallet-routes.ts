import { Contract, JsonRpcProvider, getAddress, isAddress } from "ethers";
import type { AppConfig, WalletConfig } from "./config.js";
import type { WalletDeviceRecord, WalletBalanceResponse } from "../shared/wallet.js";
import type { PackedUserOperationJson } from "../shared/userop.js";
import {
  ENTRYPOINT_ABI,
  ERC20_ABI,
  formatUsdFromUsdc,
  userOpToTuple,
  type BundlerFeeConfig,
} from "../shared/userop.js";
import { validateUserOpFee } from "../shared/userop-fee.js";
import { deriveWalletSalt, predictWalletAddress } from "../shared/wallet-address.js";
import {
  buildOnramperWidgetSession,
  listOnramperEvmWalletAssets,
  resolveEvmStableTokenAddress,
  resolveProductAssetFromOnramperCryptoId,
} from "../shared/onramper.js";
import { confirmOnramperOfframpTransaction } from "../shared/onramper-confirm.js";
import type { CommerceDb } from "./db.js";
import { registerWalletAdvancedRoutes } from "./wallet-advanced-routes.js";

const PAIRING_TTL_MS = 5 * 60 * 1000;

export function registerWalletRoutes(
  db: CommerceDb,
  appConfig: AppConfig,
  handlers: {
    sendJson: (res: import("node:http").ServerResponse, code: number, body: unknown) => void;
    readJson: (req: import("node:http").IncomingMessage) => Promise<Record<string, unknown>>;
    sweeperApiKey: string;
    requireApiKey: (
      req: import("node:http").IncomingMessage,
      key: string,
      label: string
    ) => void;
  }
) {
  const walletConfig = appConfig.wallet;
  const handleAdvanced = registerWalletAdvancedRoutes(db, appConfig, handlers);
  return async function handleWalletRoute(
    req: import("node:http").IncomingMessage,
    res: import("node:http").ServerResponse,
    url: URL,
    ip: string
  ): Promise<boolean> {
    if (await handleAdvanced(req, res, url)) {
      return true;
    }
    if (req.method === "POST" && url.pathname === "/api/wallet/onramp-session") {
      await createWalletOnrampSession(req, res, db, appConfig, handlers);
      return true;
    }
    if (req.method === "POST" && url.pathname === "/api/wallet/offramp-session") {
      await createWalletOfframpSession(req, res, db, appConfig, handlers);
      return true;
    }
    if (req.method === "POST" && url.pathname === "/api/wallet/offramp/confirm") {
      await confirmWalletOfframp(req, res, db, appConfig, handlers);
      return true;
    }

    if (req.method === "GET" && url.pathname === "/api/wallet/balance") {
      const wallet = url.searchParams.get("wallet")?.trim();
      if (!wallet) {
        handlers.sendJson(res, 400, { error: "wallet required" });
        return true;
      }
      try {
        const balance = await fetchWalletBalance(getAddress(wallet), walletConfig, db);
        handlers.sendJson(res, 200, balance);
      } catch (error) {
        handlers.sendJson(res, 400, {
          error: "balance_failed",
          message: error instanceof Error ? error.message : String(error),
        });
      }
      return true;
    }

    const accountMatch = url.pathname.match(/^\/api\/wallet\/accounts\/(0x[0-9a-fA-F]{40})$/);
    if (req.method === "GET" && accountMatch) {
      const account = db.getWalletAccount(accountMatch[1]);
      if (!account) {
        handlers.sendJson(res, 404, { error: "account_not_found" });
        return true;
      }
      handlers.sendJson(res, 200, { account });
      return true;
    }

    if (req.method === "GET" && url.pathname === "/api/wallet/accounts") {
      const credentialId = url.searchParams.get("credentialId")?.trim();
      if (!credentialId) {
        handlers.sendJson(res, 400, { error: "credentialId required" });
        return true;
      }
      const account = db.getWalletAccountByCredentialId(credentialId);
      if (!account) {
        handlers.sendJson(res, 404, { error: "account_not_found" });
        return true;
      }
      const device = db.getWalletDeviceByCredentialId(credentialId, account.address);
      handlers.sendJson(res, 200, {
        account,
        device: device
          ? {
              label: device.label,
              ownerQx: device.ownerQx,
              ownerQy: device.ownerQy,
              credentialId: device.credentialId,
            }
          : null,
      });
      return true;
    }

    if (req.method === "POST" && url.pathname === "/api/wallet/accounts") {
      const body = await handlers.readJson(req);
      const ownerQx = normalizeHex32(str(body.ownerQx));
      const ownerQy = normalizeHex32(str(body.ownerQy));
      const salt = normalizeHex32(str(body.salt));
      if (!ownerQx || !ownerQy) {
        handlers.sendJson(res, 400, { error: "ownerQx, ownerQy required" });
        return true;
      }
      const derivedSalt = salt ?? deriveWalletSalt(ownerQx, ownerQy);
      if (!walletConfig.factoryAddress || !walletConfig.implementationAddress) {
        handlers.sendJson(res, 503, { error: "wallet_factory_not_configured" });
        return true;
      }
      const predicted = predictWalletAddress(
        walletConfig.factoryAddress,
        walletConfig.implementationAddress,
        derivedSalt
      );
      const address = str(body.address)?.toLowerCase() ?? predicted.toLowerCase();
      if (address !== predicted.toLowerCase()) {
        handlers.sendJson(res, 400, { error: "address_mismatch", expected: predicted });
        return true;
      }
      const attestation =
        body.webauthnAttestation != null ? JSON.stringify(body.webauthnAttestation) : null;
      const account = db.upsertWalletAccount({
        address,
        salt: derivedSalt,
        ownerQx,
        ownerQy,
        credentialId: str(body.credentialId) || null,
        webauthnAttestation: attestation,
      });
      handlers.sendJson(res, 201, { account });
      return true;
    }

    if (req.method === "GET" && url.pathname === "/api/wallet/deployer/accounts") {
      try {
        handlers.requireApiKey(req, handlers.sweeperApiKey, "SWEEPER_API_KEY");
      } catch {
        handlers.sendJson(res, 401, { error: "unauthorized" });
        return true;
      }
      const chainId = url.searchParams.get("chainId")?.trim() ?? walletConfig.chainId;
      const accounts = db.listUndeployedWalletAccounts(chainId);
      handlers.sendJson(res, 200, { accounts, chainId });
      return true;
    }

    const deployedMatch = url.pathname.match(/^\/api\/wallet\/accounts\/(0x[0-9a-fA-F]{40})\/deployed$/);
    if (req.method === "PATCH" && deployedMatch) {
      try {
        handlers.requireApiKey(req, handlers.sweeperApiKey, "SWEEPER_API_KEY");
      } catch {
        handlers.sendJson(res, 401, { error: "unauthorized" });
        return true;
      }
      const body = await handlers.readJson(req);
      const chainId = str(body.chainId) ?? walletConfig.chainId;
      const account = db.markWalletDeployed(deployedMatch[1], chainId);
      if (!account) {
        handlers.sendJson(res, 404, { error: "account_not_found" });
        return true;
      }
      handlers.sendJson(res, 200, { account });
      return true;
    }

    if (req.method === "GET" && url.pathname === "/api/wallet/devices") {
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
      if (body.action === "consume") {
        const nonce = str(body.nonce);
        if (!nonce) {
          handlers.sendJson(res, 400, { error: "nonce required" });
          return true;
        }
        const pairing = db.consumeWalletPairing(nonce);
        if (!pairing) {
          handlers.sendJson(res, 404, { error: "pairing_not_found" });
          return true;
        }
        handlers.sendJson(res, 200, { pairing });
        return true;
      }
      if (body.action === "reject") {
        const nonce = str(body.nonce);
        if (!nonce) {
          handlers.sendJson(res, 400, { error: "nonce required" });
          return true;
        }
        const pairing = db.rejectWalletPairing(nonce);
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
      const existing = db.getWalletUserOpByHash(userOpHash);
      if (existing && existing.status !== "rejected" && existing.status !== "failed") {
        handlers.sendJson(res, 409, { error: "duplicate_user_op_hash", status: existing.status });
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
        const walletAddress = getAddress(userOp.sender);
        const record =
          existing != null
            ? db.requeueWalletUserOp({ userOpHash, userOp, walletAddress, chainId })
            : db.createWalletUserOp({ walletAddress, chainId, userOpHash, userOp });
        if (!record) {
          handlers.sendJson(res, 409, { error: "duplicate_user_op_hash" });
          return true;
        }
        handlers.sendJson(res, existing ? 200 : 201, { userOp: record });
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

async function fetchWalletBalance(
  wallet: string,
  config: WalletConfig,
  db: CommerceDb
): Promise<WalletBalanceResponse> {
  const chains = config.chains.length ? config.chains : [];
  const account = db.getWalletAccount(wallet);
  const results = await Promise.all(
    chains.map(async (chain) => {
      let balance = 0n;
      let deployed = account?.deployedChains.includes(chain.chainId) ?? false;
      if (chain.rpcUrl && chain.feeTokenAddress) {
        try {
          const provider = new JsonRpcProvider(chain.rpcUrl);
          const code = await provider.getCode(wallet);
          if (code !== "0x") deployed = true;
          const token = new Contract(chain.feeTokenAddress, ERC20_ABI, provider);
          balance = BigInt(await token.balanceOf(wallet));
        } catch {
          /* ignore RPC errors per chain */
        }
      }
      return {
        chainId: chain.chainId,
        networkLabel: chain.networkLabel,
        balance: balance.toString(),
        balanceUsd: formatUsdFromUsdc(balance, chain.feeTokenDecimals),
        deployed,
        feeTokenSymbol: chain.feeTokenSymbol,
      };
    })
  );
  const totalUsdc = results.reduce((sum, c) => sum + BigInt(c.balance), 0n);
  return {
    wallet,
    totalUsdc: totalUsdc.toString(),
    totalUsd: formatUsdFromUsdc(totalUsdc, config.feeTokenDecimals),
    chains: results,
  };
}

type JsonHandlers = {
  sendJson: (res: import("node:http").ServerResponse, code: number, body: unknown) => void;
  readJson: (req: import("node:http").IncomingMessage) => Promise<Record<string, unknown>>;
};

async function createWalletOnrampSession(
  req: import("node:http").IncomingMessage,
  res: import("node:http").ServerResponse,
  db: CommerceDb,
  appConfig: AppConfig,
  handlers: JsonHandlers
): Promise<void> {
  const onramper = appConfig.onramper;
  if (!onramper.enabled) {
    handlers.sendJson(res, 503, { error: "Card and bank payments are not enabled on this instance" });
    return;
  }

  const body = await handlers.readJson(req);
  const walletAddress = resolveRegisteredWallet(body, db);
  if (!walletAddress) {
    handlers.sendJson(res, 400, { error: "walletAddress required (registered wallet)" });
    return;
  }

  const assets = listOnramperEvmWalletAssets(appConfig.wallet.chains.map((c) => c.chainId));
  if (!assets.length) {
    handlers.sendJson(res, 400, { error: "No Onramper-supported EVM stables configured for this wallet" });
    return;
  }

  const fiat = String(body.fiat ?? body.currency ?? "USD").trim().toUpperCase();
  if (!onramper.fiats.includes(fiat)) {
    handlers.sendJson(res, 400, { error: `Unsupported fiat currency: ${fiat}` });
    return;
  }
  const themeRaw = String(body.theme ?? "").trim().toLowerCase();
  const theme = themeRaw === "dark" ? "dark" : "light";
  const amountRaw = body.amount != null ? String(body.amount).trim() : "";
  const defaultAmount = amountRaw || (fiat === "USD" ? "50" : "50");

  if (onramper.demo || !onramper.apiKey || !onramper.signingKey) {
    const demo = new URLSearchParams({
      walletAddress,
      fiat,
      price: defaultAmount,
      token: assets.map((a) => a.token).join(","),
      chainId: assets.map((a) => a.chainId).join(","),
      mode: "buy",
    });
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    handlers.sendJson(res, 200, {
      widgetUrl: `/api/public/onramp-demo?${demo.toString()}`,
      expiresAt,
      fiat,
      demo: true,
      assets,
    });
    return;
  }

  const successRedirectUrl = new URL("/wallet/receive", appConfig.baseUrl).toString();
  const session = buildOnramperWidgetSession({
    apiKey: onramper.apiKey,
    signingKeyPem: onramper.signingKey,
    widgetOrigin: onramper.widgetOrigin,
    mode: "buy",
    partnerContext: `wallet:${walletAddress.toLowerCase()}`,
    walletAddress,
    assets,
    fiat,
    defaultAmount,
    lockFiat: false,
    theme,
    successRedirectUrl,
    failureRedirectUrl: successRedirectUrl,
  });

  handlers.sendJson(res, 200, {
    widgetUrl: session.widgetUrl,
    expiresAt: session.expiresAt,
    fiat,
    assets,
  });
}

async function createWalletOfframpSession(
  req: import("node:http").IncomingMessage,
  res: import("node:http").ServerResponse,
  db: CommerceDb,
  appConfig: AppConfig,
  handlers: JsonHandlers
): Promise<void> {
  const onramper = appConfig.onramper;
  if (!onramper.enabled) {
    handlers.sendJson(res, 503, { error: "Card and bank payments are not enabled on this instance" });
    return;
  }

  const body = await handlers.readJson(req);
  const walletAddress = resolveRegisteredWallet(body, db);
  if (!walletAddress) {
    handlers.sendJson(res, 400, { error: "walletAddress required (registered wallet)" });
    return;
  }

  const assets = listOnramperEvmWalletAssets(appConfig.wallet.chains.map((c) => c.chainId));
  if (!assets.length) {
    handlers.sendJson(res, 400, { error: "No Onramper-supported EVM stables configured for this wallet" });
    return;
  }

  const fiat = String(body.fiat ?? body.currency ?? "USD").trim().toUpperCase();
  if (!onramper.fiats.includes(fiat)) {
    handlers.sendJson(res, 400, { error: `Unsupported fiat currency: ${fiat}` });
    return;
  }
  const themeRaw = String(body.theme ?? "").trim().toLowerCase();
  const theme = themeRaw === "dark" ? "dark" : "light";

  let maxAvailableCrypto: string | undefined;
  if (body.maxAvailableCrypto != null && String(body.maxAvailableCrypto).trim() !== "") {
    maxAvailableCrypto = String(body.maxAvailableCrypto).trim();
  }

  if (onramper.demo || !onramper.apiKey || !onramper.signingKey) {
    const demo = new URLSearchParams({
      walletAddress,
      fiat,
      token: assets.map((a) => a.token).join(","),
      chainId: assets.map((a) => a.chainId).join(","),
      mode: "sell",
    });
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    handlers.sendJson(res, 200, {
      widgetUrl: `/api/public/onramp-demo?${demo.toString()}`,
      expiresAt,
      fiat,
      demo: true,
      assets,
    });
    return;
  }

  const cashoutUrl = new URL("/wallet/offramp/cashout", appConfig.baseUrl).toString();
  const successRedirectUrl = new URL("/wallet", appConfig.baseUrl).toString();
  const session = buildOnramperWidgetSession({
    apiKey: onramper.apiKey,
    signingKeyPem: onramper.signingKey,
    widgetOrigin: onramper.widgetOrigin,
    mode: "sell",
    partnerContext: `wallet:${walletAddress.toLowerCase()}`,
    walletAddress,
    assets,
    fiat,
    lockFiat: false,
    theme,
    offrampCashoutRedirectUrl: cashoutUrl,
    maxAvailableCrypto,
    successRedirectUrl,
    failureRedirectUrl: successRedirectUrl,
  });

  handlers.sendJson(res, 200, {
    widgetUrl: session.widgetUrl,
    expiresAt: session.expiresAt,
    fiat,
    assets,
  });
}

async function confirmWalletOfframp(
  req: import("node:http").IncomingMessage,
  res: import("node:http").ServerResponse,
  db: CommerceDb,
  appConfig: AppConfig,
  handlers: JsonHandlers
): Promise<void> {
  const onramper = appConfig.onramper;
  if (!onramper.enabled || !onramper.apiKey) {
    handlers.sendJson(res, 503, { error: "Onramper is not configured" });
    return;
  }

  const body = await handlers.readJson(req);
  const walletAddress = resolveRegisteredWallet(body, db);
  if (!walletAddress) {
    handlers.sendJson(res, 400, { error: "walletAddress required (registered wallet)" });
    return;
  }

  const transactionId = String(body.transactionId ?? "").trim();
  const transactionHash = String(body.transactionHash ?? "").trim();
  const targetAddress = String(body.targetAddress ?? "").trim();
  if (!transactionId || !transactionHash || !isAddress(targetAddress)) {
    handlers.sendJson(res, 400, {
      error: "transactionId, transactionHash, and targetAddress are required",
    });
    return;
  }

  // Optional: validate sourceCurrency maps to a known asset (client already sent the tokens).
  const sourceCurrency = String(body.sourceCurrency ?? "").trim();
  if (sourceCurrency) {
    const mapped = resolveProductAssetFromOnramperCryptoId(sourceCurrency);
    if (!mapped) {
      handlers.sendJson(res, 400, { error: `Unsupported sourceCurrency: ${sourceCurrency}` });
      return;
    }
    const tokenAddr = resolveEvmStableTokenAddress(mapped.chainId, mapped.token, {
      symbol: appConfig.wallet.feeTokenSymbol,
      address: appConfig.wallet.feeTokenAddress,
    });
    if (!tokenAddr) {
      handlers.sendJson(res, 400, { error: `No token address for ${mapped.token} on ${mapped.chainId}` });
      return;
    }
  }

  try {
    const result = await confirmOnramperOfframpTransaction({
      apiKey: onramper.apiKey,
      widgetOrigin: onramper.widgetOrigin,
      transactionId,
      transactionHash,
      sourceAddress: walletAddress,
      targetAddress: getAddress(targetAddress),
    });
    handlers.sendJson(res, 200, { ok: true, ...result });
  } catch (error) {
    const status =
      error && typeof error === "object" && "statusCode" in error
        ? Number((error as { statusCode: number }).statusCode)
        : 502;
    handlers.sendJson(res, status, {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function resolveRegisteredWallet(
  body: Record<string, unknown>,
  db: CommerceDb
): string | null {
  const raw = String(body.walletAddress ?? body.wallet ?? "").trim();
  if (!raw || !isAddress(raw)) return null;
  const address = getAddress(raw);
  const account = db.getWalletAccount(address);
  if (!account) return null;
  return address;
}
