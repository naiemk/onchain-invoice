import { randomBytes } from "node:crypto";
import { Contract, JsonRpcProvider, getAddress, isAddress, solidityPackedKeccak256 } from "ethers";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { AppConfig, WalletConfig } from "./config.js";
import type { CommerceDb } from "./db.js";
import { generateHmacSecret, requireWalletClient } from "./client-auth.js";
import { requireApiKey } from "./auth.js";
import {
  challengeToBase64Url,
  verifyWebAuthnAssertion,
  type WebAuthnAssertionJson,
} from "../shared/webauthn-verify.js";
import { deriveWalletSalt, predictWalletAddress } from "../shared/wallet-address.js";
import type { WalletChallengePurpose } from "../shared/wallet.js";
import type { PackedUserOperationJson } from "../shared/userop.js";
import {
  ENTRYPOINT_ABI,
  ERC20_ABI,
  buildPackedUserOperation,
  buildSendBatchCalls,
  encodeExecuteCallData,
  userOpToTuple,
  type BundlerFeeConfig,
} from "../shared/userop.js";
import { validateUserOpFee } from "../shared/userop-fee.js";

type JsonHandlers = {
  sendJson: (res: ServerResponse, code: number, body: unknown) => void;
  readRawBody: (req: IncomingMessage) => Promise<Buffer>;
  sweeperApiKey: string;
  requireApiKey: typeof requireApiKey;
};

export function registerWalletClientRoutes(
  db: CommerceDb,
  appConfig: AppConfig,
  handlers: JsonHandlers
) {
  return async function handleWalletClientRoute(
    req: IncomingMessage,
    res: ServerResponse,
    url: URL
  ): Promise<boolean> {
    // --- Admin wallet-clients ---
    if (req.method === "POST" && url.pathname === "/api/admin/wallet-clients") {
      try {
        handlers.requireApiKey(req, appConfig.adminApiKey, "ADMIN_API_KEY");
      } catch (e) {
        handlers.sendJson(res, statusOf(e), { error: messageOf(e) });
        return true;
      }
      const body = await readBodyJson(req, handlers);
      const label = str(body.label) || "Wallet client";
      const rpId = str(body.rpId)?.toLowerCase();
      if (!rpId) {
        handlers.sendJson(res, 400, { error: "rpId required" });
        return true;
      }
      const origins = Array.isArray(body.origins)
        ? body.origins.map(String).filter(Boolean)
        : null;
      const hmacSecret = generateHmacSecret();
      const created = db.createWalletClient({
        label,
        rpId,
        origins,
        hmacSecret,
        enabled: body.enabled !== false,
      });
      handlers.sendJson(res, 201, {
        client: {
          id: created.id,
          label: created.label,
          rpId: created.rpId,
          origins: created.origins,
          enabled: created.enabled,
          createdAt: created.createdAt,
          updatedAt: created.updatedAt,
        },
        hmacSecret: created.hmacSecret,
      });
      return true;
    }

    if (req.method === "GET" && url.pathname === "/api/admin/wallet-clients") {
      try {
        handlers.requireApiKey(req, appConfig.adminApiKey, "ADMIN_API_KEY");
      } catch (e) {
        handlers.sendJson(res, statusOf(e), { error: messageOf(e) });
        return true;
      }
      handlers.sendJson(res, 200, { clients: db.listWalletClients() });
      return true;
    }

    const rotateMatch = url.pathname.match(/^\/api\/admin\/wallet-clients\/([^/]+)\/rotate$/);
    if (req.method === "POST" && rotateMatch) {
      try {
        handlers.requireApiKey(req, appConfig.adminApiKey, "ADMIN_API_KEY");
      } catch (e) {
        handlers.sendJson(res, statusOf(e), { error: messageOf(e) });
        return true;
      }
      const hmacSecret = generateHmacSecret();
      const rotated = db.rotateWalletClientSecret(decodeURIComponent(rotateMatch[1]!), hmacSecret);
      if (!rotated) {
        handlers.sendJson(res, 404, { error: "client_not_found" });
        return true;
      }
      handlers.sendJson(res, 200, {
        client: {
          id: rotated.id,
          label: rotated.label,
          rpId: rotated.rpId,
          origins: rotated.origins,
          enabled: rotated.enabled,
          createdAt: rotated.createdAt,
          updatedAt: rotated.updatedAt,
        },
        hmacSecret: rotated.hmacSecret,
      });
      return true;
    }

    const patchClientMatch = url.pathname.match(/^\/api\/admin\/wallet-clients\/([^/]+)$/);
    if (req.method === "PATCH" && patchClientMatch) {
      try {
        handlers.requireApiKey(req, appConfig.adminApiKey, "ADMIN_API_KEY");
      } catch (e) {
        handlers.sendJson(res, statusOf(e), { error: messageOf(e) });
        return true;
      }
      const body = await readBodyJson(req, handlers);
      const patch: {
        enabled?: boolean;
        label?: string;
        rpId?: string;
        origins?: string[] | null;
      } = {};
      if (typeof body.enabled === "boolean") patch.enabled = body.enabled;
      if (typeof body.label === "string") patch.label = body.label;
      if (typeof body.rpId === "string") patch.rpId = body.rpId;
      if (body.origins === null) patch.origins = null;
      else if (Array.isArray(body.origins)) patch.origins = body.origins.map(String);
      const updated = db.updateWalletClient(decodeURIComponent(patchClientMatch[1]!), patch);
      if (!updated) {
        handlers.sendJson(res, 404, { error: "client_not_found" });
        return true;
      }
      handlers.sendJson(res, 200, { client: updated });
      return true;
    }

    // --- Internal recovery job routes (sweeper API key) ---
    if (req.method === "GET" && url.pathname === "/api/internal/wallet-recovery/jobs") {
      try {
        handlers.requireApiKey(req, handlers.sweeperApiKey, "SWEEPER_API_KEY");
      } catch (e) {
        handlers.sendJson(res, statusOf(e), { error: messageOf(e) });
        return true;
      }
      const requested = url.searchParams.get("status");
      const statuses = requested
        ? (requested.split(",").map((s) => s.trim()).filter(Boolean) as Array<
            "pending" | "claimed" | "submitted" | "included" | "failed" | "rejected"
          >)
        : (["pending"] as const);
      const chainId = url.searchParams.get("chainId")?.trim();
      const jobs = db.listWalletRecoveryJobs(
        [...statuses],
        chainId ? [chainId] : undefined
      );
      handlers.sendJson(res, 200, { jobs });
      return true;
    }

    if (req.method === "POST" && url.pathname === "/api/internal/wallet-recovery/claim") {
      try {
        handlers.requireApiKey(req, handlers.sweeperApiKey, "SWEEPER_API_KEY");
      } catch (e) {
        handlers.sendJson(res, statusOf(e), { error: messageOf(e) });
        return true;
      }
      const body = await readBodyJson(req, handlers);
      const id = str(body.id);
      const workerId = str(body.workerId) ?? "wallet-deployer";
      const expectedVersion = Number(body.expectedVersion);
      if (!id || !Number.isFinite(expectedVersion)) {
        handlers.sendJson(res, 400, { error: "id and expectedVersion required" });
        return true;
      }
      try {
        const job = db.claimWalletRecoveryJob({
          id,
          workerId,
          expectedVersion,
          leaseMs: appConfig.claimLeaseMs,
        });
        handlers.sendJson(res, 200, { job });
      } catch (e) {
        handlers.sendJson(res, statusOf(e), {
          error: messageOf(e),
          job: (e as { job?: unknown }).job ?? null,
        });
      }
      return true;
    }

    if (req.method === "POST" && url.pathname === "/api/internal/wallet-recovery/track") {
      try {
        handlers.requireApiKey(req, handlers.sweeperApiKey, "SWEEPER_API_KEY");
      } catch (e) {
        handlers.sendJson(res, statusOf(e), { error: messageOf(e) });
        return true;
      }
      const body = await readBodyJson(req, handlers);
      const id = str(body.id);
      if (!id) {
        handlers.sendJson(res, 400, { error: "id required" });
        return true;
      }
      try {
        const job = db.trackWalletRecoveryJob({
          id,
          status: body.status as "submitted" | "included" | "failed" | "rejected" | undefined,
          txHash: body.txHash != null ? String(body.txHash) : undefined,
          error: body.error != null ? String(body.error) : undefined,
          expectedVersion:
            body.expectedVersion != null ? Number(body.expectedVersion) : undefined,
          workerId: str(body.workerId),
        });
        handlers.sendJson(res, 200, { job });
      } catch (e) {
        handlers.sendJson(res, statusOf(e), {
          error: messageOf(e),
          job: (e as { job?: unknown }).job ?? null,
        });
      }
      return true;
    }

    // --- HMAC client wallet API ---
    if (!url.pathname.startsWith("/api/client/wallets")) {
      return false;
    }

    const raw = await handlers.readRawBody(req);
    const rawBody = raw.toString("utf8");
    let auth;
    try {
      auth = requireWalletClient(req, db, rawBody);
    } catch (e) {
      handlers.sendJson(res, statusOf(e), { error: messageOf(e) });
      return true;
    }
    const body =
      rawBody.length === 0 ? {} : (JSON.parse(rawBody) as Record<string, unknown>);

    if (req.method === "POST" && url.pathname === "/api/client/wallets/challenges") {
      const purpose = str(body.purpose) as WalletChallengePurpose | undefined;
      if (purpose !== "create" && purpose !== "recover" && purpose !== "cancel") {
        handlers.sendJson(res, 400, { error: "purpose must be create, recover, or cancel" });
        return true;
      }
      const challengeBytes = randomBytes(32);
      const challenge = challengeToBase64Url(challengeBytes);
      const record = db.createWalletChallenge({
        clientId: auth.client.id,
        purpose,
        challenge,
        email: str(body.email),
        walletAddress: str(body.walletAddress),
      });
      handlers.sendJson(res, 201, {
        challengeId: record.id,
        challenge: record.challenge,
        expiresAt: record.expiresAt,
        purpose: record.purpose,
      });
      return true;
    }

    if (req.method === "POST" && url.pathname === "/api/client/wallets") {
      await createClientWallet(req, res, db, appConfig, handlers, auth.client, body);
      return true;
    }

    if (req.method === "GET" && url.pathname === "/api/client/wallets") {
      const email = url.searchParams.get("email")?.trim();
      if (!email) {
        handlers.sendJson(res, 400, { error: "email required" });
        return true;
      }
      const identities = db.listWalletIdentities(auth.client.id, email);
      const chainId = url.searchParams.get("chainId")?.trim() ?? appConfig.wallet.chainId;
      const wallets = identities.map((identity) => {
        const account = db.getWalletAccount(identity.walletAddress);
        const devices = db.listWalletDevices(identity.walletAddress, chainId);
        return {
          address: identity.walletAddress,
          email: identity.email,
          contact: identity.contactJson ? safeJson(identity.contactJson) : null,
          account: account
            ? {
                address: account.address,
                salt: account.salt,
                ownerQx: account.ownerQx,
                ownerQy: account.ownerQy,
                credentialId: account.credentialId,
                deployedChains: account.deployedChains,
                createdAt: account.createdAt,
                updatedAt: account.updatedAt,
              }
            : null,
          devices: devices.map((d) => ({
            label: d.label,
            credentialId: d.credentialId,
            ownerQx: d.ownerQx,
            ownerQy: d.ownerQy,
            createdAt: d.createdAt,
            lastUsedAt: d.lastUsedAt,
          })),
        };
      });
      handlers.sendJson(res, 200, { email: email.trim().toLowerCase(), wallets });
      return true;
    }

    const sendPrepare = url.pathname.match(
      /^\/api\/client\/wallets\/(0x[0-9a-fA-F]{40})\/send\/prepare$/
    );
    if (req.method === "POST" && sendPrepare) {
      await prepareSend(res, db, appConfig, handlers, auth.client.id, sendPrepare[1]!, body);
      return true;
    }

    const sendSubmit = url.pathname.match(/^\/api\/client\/wallets\/(0x[0-9a-fA-F]{40})\/send$/);
    if (req.method === "POST" && sendSubmit) {
      await submitSend(res, db, appConfig, handlers, auth.client.id, sendSubmit[1]!, body);
      return true;
    }

    const recoveryCancel = url.pathname.match(
      /^\/api\/client\/wallets\/(0x[0-9a-fA-F]{40})\/recovery\/cancel$/
    );
    if (req.method === "POST" && recoveryCancel) {
      await cancelRecovery(res, db, appConfig, handlers, auth.client, recoveryCancel[1]!, body);
      return true;
    }

    const recoveryGet = url.pathname.match(
      /^\/api\/client\/wallets\/(0x[0-9a-fA-F]{40})\/recovery$/
    );
    if (req.method === "GET" && recoveryGet) {
      await getRecovery(res, db, appConfig, handlers, auth.client.id, recoveryGet[1]!);
      return true;
    }

    if (req.method === "POST" && recoveryGet) {
      await initiateRecovery(res, db, appConfig, handlers, auth.client, recoveryGet[1]!, body);
      return true;
    }

    handlers.sendJson(res, 404, { error: "Not found" });
    return true;
  };
}

async function createClientWallet(
  _req: IncomingMessage,
  res: ServerResponse,
  db: CommerceDb,
  appConfig: AppConfig,
  handlers: JsonHandlers,
  client: { id: string; rpId: string; origins: string[] | null },
  body: Record<string, unknown>
): Promise<void> {
  const email = str(body.email);
  const challengeId = str(body.challengeId);
  const ownerQx = normalizeHex32(str(body.ownerQx));
  const ownerQy = normalizeHex32(str(body.ownerQy));
  const credentialId = str(body.credentialId);
  if (!email || !challengeId || !ownerQx || !ownerQy || !credentialId) {
    handlers.sendJson(res, 400, {
      error: "email, challengeId, ownerQx, ownerQy, credentialId required",
    });
    return;
  }
  const challenge = db.consumeWalletChallenge({
    id: challengeId,
    clientId: client.id,
    purpose: "create",
  });
  if (!challenge) {
    handlers.sendJson(res, 400, { error: "invalid_or_expired_challenge" });
    return;
  }

  const assertion = body.assertion as WebAuthnAssertionJson | undefined;
  if (!assertion) {
    handlers.sendJson(res, 400, { error: "assertion required" });
    return;
  }
  try {
    verifyWebAuthnAssertion(assertion, {
      expectedChallengeBase64Url: challenge.challenge,
      rpId: client.rpId,
      origins: client.origins,
      ownerQx,
      ownerQy,
    });
  } catch (e) {
    handlers.sendJson(res, statusOf(e), {
      error: (e as { code?: string }).code ?? "assertion_failed",
      message: messageOf(e),
    });
    return;
  }

  const walletConfig = appConfig.wallet;
  if (!walletConfig.factoryAddress || !walletConfig.implementationAddress) {
    handlers.sendJson(res, 503, { error: "wallet_factory_not_configured" });
    return;
  }
  const salt = deriveWalletSalt(ownerQx, ownerQy);
  const address = predictWalletAddress(
    walletConfig.factoryAddress,
    walletConfig.implementationAddress,
    salt
  ).toLowerCase();

  const attestation =
    body.webauthnAttestation != null ? JSON.stringify(body.webauthnAttestation) : null;
  const account = db.upsertWalletAccount({
    address,
    salt,
    ownerQx,
    ownerQy,
    credentialId,
    webauthnAttestation: attestation,
  });
  const label = str(body.label) || "Passkey";
  const device = db.upsertWalletDevice({
    walletAddress: address,
    chainId: walletConfig.chainId,
    ownerQx,
    ownerQy,
    label,
    credentialId,
  });
  const contactJson =
    body.contact != null && typeof body.contact === "object"
      ? JSON.stringify(body.contact)
      : str(body.contactJson) ?? null;
  const identity = db.upsertWalletIdentity({
    clientId: client.id,
    email,
    walletAddress: address,
    contactJson,
  });

  handlers.sendJson(res, 201, {
    wallet: {
      address: account.address,
      salt: account.salt,
      email: identity.email,
      contact: identity.contactJson ? safeJson(identity.contactJson) : null,
      ownerQx: account.ownerQx,
      ownerQy: account.ownerQy,
      credentialId: account.credentialId,
      deployedChains: account.deployedChains,
      device: {
        label: device.label,
        credentialId: device.credentialId,
        ownerQx: device.ownerQx,
        ownerQy: device.ownerQy,
      },
      createdAt: account.createdAt,
    },
  });
}

async function prepareSend(
  res: ServerResponse,
  db: CommerceDb,
  appConfig: AppConfig,
  handlers: JsonHandlers,
  clientId: string,
  walletAddress: string,
  body: Record<string, unknown>
): Promise<void> {
  const addr = walletAddress.toLowerCase();
  if (!db.clientOwnsWallet(clientId, addr)) {
    handlers.sendJson(res, 403, { error: "wallet_not_bound_to_client" });
    return;
  }
  const to = str(body.to);
  const amount = str(body.amount);
  if (!to || !isAddress(to) || !amount) {
    handlers.sendJson(res, 400, { error: "to and amount required" });
    return;
  }
  const walletConfig = appConfig.wallet;
  const chainId = str(body.chainId) ?? walletConfig.chainId;
  const chain =
    walletConfig.chains.find((c) => c.chainId === chainId) ??
    (walletConfig.chainId === chainId
      ? {
          chainId,
          factoryAddress: walletConfig.factoryAddress ?? "",
          rpcUrl: walletConfig.rpcUrl,
          feeTokenAddress: walletConfig.feeTokenAddress,
          feeTokenSymbol: walletConfig.feeTokenSymbol,
          feeTokenDecimals: walletConfig.feeTokenDecimals,
          networkLabel: chainId,
        }
      : null);
  if (!chain?.feeTokenAddress || !walletConfig.bundlerBeneficiary) {
    handlers.sendJson(res, 503, { error: "bundler_not_configured" });
    return;
  }
  if (!chain.rpcUrl) {
    handlers.sendJson(res, 503, { error: "rpc_not_configured" });
    return;
  }
  const tokenSymbol = (str(body.token) ?? chain.feeTokenSymbol).toUpperCase();
  const sendToken =
    tokenSymbol === chain.feeTokenSymbol.toUpperCase()
      ? chain.feeTokenAddress
      : str(body.tokenAddress) ?? chain.feeTokenAddress;

  const provider = new JsonRpcProvider(chain.rpcUrl);
  const entryPoint = new Contract(walletConfig.entryPointAddress, ENTRYPOINT_ABI, provider);
  const nonce = BigInt(await entryPoint.getNonce(getAddress(addr), 0));
  const feeAmount = walletConfig.bundlerFeeUsdc;
  const sendAmount = BigInt(amount);
  const callData = encodeExecuteCallData(
    buildSendBatchCalls({
      feeToken: chain.feeTokenAddress,
      beneficiary: walletConfig.bundlerBeneficiary,
      feeAmount,
      recipient: getAddress(to),
      sendAmount,
      sendToken,
    })
  );
  const unsigned = buildPackedUserOperation({
    sender: getAddress(addr),
    nonce,
    callData,
  });
  const userOpHash = await entryPoint.getUserOpHash(userOpToTuple(unsigned));
  handlers.sendJson(res, 200, {
    userOp: unsigned,
    userOpHash,
    chainId,
    bundlerFeeUsdc: feeAmount.toString(),
    token: tokenSymbol,
    sendTokenAddress: sendToken,
  });
}

async function submitSend(
  res: ServerResponse,
  db: CommerceDb,
  appConfig: AppConfig,
  handlers: JsonHandlers,
  clientId: string,
  walletAddress: string,
  body: Record<string, unknown>
): Promise<void> {
  const addr = walletAddress.toLowerCase();
  if (!db.clientOwnsWallet(clientId, addr)) {
    handlers.sendJson(res, 403, { error: "wallet_not_bound_to_client" });
    return;
  }
  const userOp = body.userOp as PackedUserOperationJson | undefined;
  const userOpHash = str(body.userOpHash)?.toLowerCase();
  if (!userOp || !userOpHash) {
    handlers.sendJson(res, 400, { error: "userOp and userOpHash required" });
    return;
  }
  if (getAddress(userOp.sender).toLowerCase() !== addr) {
    handlers.sendJson(res, 400, { error: "sender_mismatch" });
    return;
  }
  const walletConfig = appConfig.wallet;
  const chainId = str(body.chainId) ?? walletConfig.chainId;
  const feeConfig = feeConfigFromWallet(walletConfig);
  if (!feeConfig.bundlerBeneficiary || !feeConfig.feeTokenAddress) {
    handlers.sendJson(res, 503, { error: "bundler_not_configured" });
    return;
  }
  const feeCheck = validateUserOpFee(userOp, feeConfig);
  if (!feeCheck.ok) {
    handlers.sendJson(res, 400, { error: feeCheck.reason, message: feeCheck.message });
    return;
  }
  const existing = db.getWalletUserOpByHash(userOpHash);
  if (existing && existing.status !== "rejected" && existing.status !== "failed") {
    handlers.sendJson(res, 409, { error: "duplicate_user_op_hash", status: existing.status });
    return;
  }
  try {
    const verified = await verifyUserOpHash(userOp, userOpHash, walletConfig);
    if (!verified) {
      handlers.sendJson(res, 400, { error: "invalid_user_op_hash" });
      return;
    }
    if (walletConfig.rpcUrl) {
      const balanceOk = await verifyTokenBalance(
        userOp.sender,
        feeConfig,
        userOp,
        walletConfig.rpcUrl
      );
      if (!balanceOk.ok) {
        handlers.sendJson(res, 400, { error: balanceOk.reason, message: balanceOk.message });
        return;
      }
    }
    const record =
      existing != null
        ? db.requeueWalletUserOp({
            userOpHash,
            userOp,
            walletAddress: getAddress(userOp.sender),
            chainId,
          })
        : db.createWalletUserOp({
            walletAddress: getAddress(userOp.sender),
            chainId,
            userOpHash,
            userOp,
          });
    if (!record) {
      handlers.sendJson(res, 409, { error: "duplicate_user_op_hash" });
      return;
    }
    handlers.sendJson(res, existing ? 200 : 201, { userOp: record });
  } catch (error) {
    handlers.sendJson(res, 400, {
      error: "submit_failed",
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

async function initiateRecovery(
  res: ServerResponse,
  db: CommerceDb,
  appConfig: AppConfig,
  handlers: JsonHandlers,
  client: { id: string; rpId: string; origins: string[] | null },
  walletAddress: string,
  body: Record<string, unknown>
): Promise<void> {
  const addr = walletAddress.toLowerCase();
  const email = str(body.email);
  if (!email) {
    handlers.sendJson(res, 400, { error: "email required" });
    return;
  }
  if (!db.clientOwnsWalletForEmail(client.id, email, addr)) {
    handlers.sendJson(res, 403, { error: "wallet_not_bound_to_client_email" });
    return;
  }
  if (body.identityVerified !== true) {
    handlers.sendJson(res, 400, {
      error: "identityVerified_required",
      message: "Client must verify email/identity before initiating recovery",
    });
    return;
  }
  const challengeId = str(body.challengeId);
  const ownerQx = normalizeHex32(str(body.ownerQx) ?? str(body.newOwnerQx));
  const ownerQy = normalizeHex32(str(body.ownerQy) ?? str(body.newOwnerQy));
  const credentialId = str(body.credentialId);
  if (!challengeId || !ownerQx || !ownerQy || !credentialId) {
    handlers.sendJson(res, 400, {
      error: "challengeId, ownerQx, ownerQy, credentialId required",
    });
    return;
  }
  const challenge = db.consumeWalletChallenge({
    id: challengeId,
    clientId: client.id,
    purpose: "recover",
  });
  if (!challenge) {
    handlers.sendJson(res, 400, { error: "invalid_or_expired_challenge" });
    return;
  }
  const assertion = body.assertion as WebAuthnAssertionJson | undefined;
  if (!assertion) {
    handlers.sendJson(res, 400, { error: "assertion required" });
    return;
  }
  try {
    verifyWebAuthnAssertion(assertion, {
      expectedChallengeBase64Url: challenge.challenge,
      rpId: client.rpId,
      origins: client.origins,
      ownerQx,
      ownerQy,
    });
  } catch (e) {
    handlers.sendJson(res, statusOf(e), {
      error: (e as { code?: string }).code ?? "assertion_failed",
      message: messageOf(e),
    });
    return;
  }

  const chainId = str(body.chainId) ?? appConfig.wallet.chainId;
  db.upsertWalletDevice({
    walletAddress: addr,
    chainId,
    ownerQx,
    ownerQy,
    label: str(body.label) || "Recovery device",
    credentialId,
  });
  const job = db.createWalletRecoveryJob({
    walletAddress: addr,
    chainId,
    kind: "initiate",
    newQx: ownerQx,
    newQy: ownerQy,
  });
  handlers.sendJson(res, 201, { job });
}

async function cancelRecovery(
  res: ServerResponse,
  db: CommerceDb,
  appConfig: AppConfig,
  handlers: JsonHandlers,
  client: { id: string; rpId: string; origins: string[] | null },
  walletAddress: string,
  body: Record<string, unknown>
): Promise<void> {
  const addr = walletAddress.toLowerCase();
  if (!db.clientOwnsWallet(client.id, addr)) {
    handlers.sendJson(res, 403, { error: "wallet_not_bound_to_client" });
    return;
  }
  const challengeId = str(body.challengeId);
  const credentialId = str(body.credentialId);
  const ownerQx = normalizeHex32(str(body.ownerQx));
  const ownerQy = normalizeHex32(str(body.ownerQy));
  if (!challengeId || !credentialId) {
    handlers.sendJson(res, 400, { error: "challengeId and credentialId required" });
    return;
  }
  const device =
    db.getWalletDeviceByCredentialId(credentialId, addr) ??
    (ownerQx && ownerQy
      ? db.listWalletDevices(addr, appConfig.wallet.chainId).find(
          (d) => d.ownerQx === ownerQx && d.ownerQy === ownerQy
        )
      : null);
  if (!device) {
    handlers.sendJson(res, 403, { error: "unknown_owner_device" });
    return;
  }
  const qx = ownerQx ?? device.ownerQx;
  const qy = ownerQy ?? device.ownerQy;

  const challenge = db.consumeWalletChallenge({
    id: challengeId,
    clientId: client.id,
    purpose: "cancel",
  });
  if (!challenge) {
    handlers.sendJson(res, 400, { error: "invalid_or_expired_challenge" });
    return;
  }

  // Prefer on-chain cancel digest as the WebAuthn challenge when RPC + pendingOwner available.
  let expectedChallenge = challenge.challenge;
  let cancelSignature: string | null = null;
  const assertion = body.assertion as WebAuthnAssertionJson | undefined;
  if (!assertion) {
    handlers.sendJson(res, 400, { error: "assertion required" });
    return;
  }

  const walletConfig = appConfig.wallet;
  if (walletConfig.rpcUrl) {
    try {
      const provider = new JsonRpcProvider(walletConfig.rpcUrl);
      const wallet = new Contract(
        getAddress(addr),
        [
          "function pendingOwner() view returns (bytes32 qx, bytes32 qy, uint64 executableAt, bytes32 requestId, bool active)",
        ],
        provider
      );
      const pending = await wallet.pendingOwner();
      if (pending.active) {
        const digest = solidityPackedKeccak256(
          ["string", "bytes32"],
          ["cancelPendingOwner", pending.requestId]
        );
        // Clients should sign the digest as WebAuthn challenge (hex → bytes).
        // Also accept our issued challenge for off-chain queue-only tests without RPC pending.
        expectedChallenge = challengeToBase64Url(Buffer.from(digest.slice(2), "hex"));
        // Encode assertion for on-chain cancelPendingOwnerWithSignature via worker.
        const { encodeWebAuthnSignature } = await import("../shared/webauthn-signature.js");
        // Rebuild AuthenticatorAssertionResponse-like object from JSON
        cancelSignature = encodeAssertionFromJson(assertion);
        void encodeWebAuthnSignature;
      }
    } catch {
      /* fall through to challenge-based verify */
    }
  }

  try {
    verifyWebAuthnAssertion(assertion, {
      expectedChallengeBase64Url: expectedChallenge,
      rpId: client.rpId,
      origins: client.origins,
      ownerQx: qx,
      ownerQy: qy,
    });
  } catch (e) {
    // Fallback: verify against the issued challenge (undeployed / no pendingOwner)
    if (expectedChallenge !== challenge.challenge) {
      try {
        verifyWebAuthnAssertion(assertion, {
          expectedChallengeBase64Url: challenge.challenge,
          rpId: client.rpId,
          origins: client.origins,
          ownerQx: qx,
          ownerQy: qy,
        });
      } catch (e2) {
        handlers.sendJson(res, statusOf(e2), {
          error: (e2 as { code?: string }).code ?? "assertion_failed",
          message: messageOf(e2),
        });
        return;
      }
    } else {
      handlers.sendJson(res, statusOf(e), {
        error: (e as { code?: string }).code ?? "assertion_failed",
        message: messageOf(e),
      });
      return;
    }
  }

  if (!cancelSignature) {
    cancelSignature = encodeAssertionFromJson(assertion);
  }

  const chainId = str(body.chainId) ?? walletConfig.chainId;
  const job = db.createWalletRecoveryJob({
    walletAddress: addr,
    chainId,
    kind: "cancel",
    cancelSignature,
  });
  handlers.sendJson(res, 201, { job });
}

async function getRecovery(
  res: ServerResponse,
  db: CommerceDb,
  appConfig: AppConfig,
  handlers: JsonHandlers,
  clientId: string,
  walletAddress: string
): Promise<void> {
  const addr = walletAddress.toLowerCase();
  if (!db.clientOwnsWallet(clientId, addr)) {
    handlers.sendJson(res, 403, { error: "wallet_not_bound_to_client" });
    return;
  }
  const jobs = db.listWalletRecoveryJobsForWallet(addr);
  let pendingOwner: {
    qx: string;
    qy: string;
    executableAt: string;
    requestId: string;
    active: boolean;
  } | null = null;
  if (appConfig.wallet.rpcUrl) {
    try {
      const provider = new JsonRpcProvider(appConfig.wallet.rpcUrl);
      const wallet = new Contract(
        getAddress(addr),
        [
          "function pendingOwner() view returns (bytes32 qx, bytes32 qy, uint64 executableAt, bytes32 requestId, bool active)",
        ],
        provider
      );
      const p = await wallet.pendingOwner();
      pendingOwner = {
        qx: p.qx,
        qy: p.qy,
        executableAt: p.executableAt.toString(),
        requestId: p.requestId,
        active: Boolean(p.active),
      };
    } catch {
      pendingOwner = null;
    }
  }
  handlers.sendJson(res, 200, { jobs, pendingOwner });
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
  if (!config.rpcUrl) return /^0x[0-9a-f]{64}$/i.test(expectedHash);
  const provider = new JsonRpcProvider(config.rpcUrl);
  const entryPoint = new Contract(config.entryPointAddress, ENTRYPOINT_ABI, provider);
  const hash = await entryPoint.getUserOpHash(userOpToTuple(userOp));
  return hash.toLowerCase() === expectedHash.toLowerCase();
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
  if (!feeCheck.ok || !feeCheck.decoded) {
    return { ok: false, reason: feeCheck.reason, message: feeCheck.message };
  }
  let totalOut = feeCheck.decoded.feeAmount;
  for (const call of feeCheck.decoded.mainCalls) {
    if (getAddress(call.target) !== getAddress(feeConfig.feeTokenAddress)) continue;
    try {
      const iface = new Contract(feeConfig.feeTokenAddress, ERC20_ABI).interface;
      const parsed = iface.parseTransaction({ data: call.data });
      if (parsed?.name === "transfer") totalOut += BigInt(parsed.args[1]);
    } catch {
      /* ignore */
    }
  }
  if (balance < totalOut) {
    return { ok: false, reason: "insufficient_balance", message: `Need ${totalOut}, have ${balance}` };
  }
  return { ok: true };
}

function encodeAssertionFromJson(assertion: WebAuthnAssertionJson): string {
  // Store raw JSON for the worker to ABI-encode when submitting cancel.
  return JSON.stringify(assertion);
}

async function readBodyJson(
  req: IncomingMessage,
  handlers: JsonHandlers
): Promise<Record<string, unknown>> {
  const raw = await handlers.readRawBody(req);
  if (raw.length === 0) return {};
  return JSON.parse(raw.toString("utf8")) as Record<string, unknown>;
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

function safeJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function statusOf(error: unknown): number {
  return typeof error === "object" &&
    error !== null &&
    "statusCode" in error &&
    typeof (error as { statusCode: number }).statusCode === "number"
    ? (error as { statusCode: number }).statusCode
    : 500;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
