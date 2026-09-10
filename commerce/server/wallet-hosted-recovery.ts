import { randomBytes, createHash } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { Contract, JsonRpcProvider, ZeroHash, getAddress, isAddress, verifyMessage } from "ethers";
import type { AppConfig } from "./config.js";
import type { CommerceDb } from "./db.js";
import { verifyCaptcha } from "./captcha.js";
import { generateOtpCode, hashOtpCode, maskEmail, sendOtpEmail, sendRecoveryRequestedEmail } from "./email.js";
import {
  emailLookupOtpWallet,
  issueRecoveryEmailSession,
  verifyRecoveryEmailSession,
} from "./recovery-email-session.js";
import {
  challengeToBase64Url,
  verifyWebAuthnAssertion,
  type WebAuthnAssertionJson,
} from "../shared/webauthn-verify.js";
import {
  recoveryNewOwnerMessage,
  type HostedRecoveryChallengePurpose,
  type WalletRecoveryNewOwnerKind,
  type WalletRecoveryRequestRecord,
  type WalletRecoveryRequestStatus,
} from "../shared/wallet.js";
import { KEY_EOA } from "../shared/advanced-wallet.js";
import {
  eoaOwnerCoords,
  verifyRecoverTypedData,
} from "../shared/wallet-eip712.js";

type Handlers = {
  sendJson: (res: ServerResponse, code: number, body: unknown) => void;
  readJson: (req: IncomingMessage) => Promise<Record<string, unknown>>;
};

let guardianCache: { address: string; fetchedAt: number } | null = null;

export function registerHostedRecoveryRoutes(
  db: CommerceDb,
  appConfig: AppConfig,
  handlers: Handlers
) {
  return async function handleHostedRecoveryRoute(
    req: IncomingMessage,
    res: ServerResponse,
    url: URL
  ): Promise<boolean> {
    if (req.method === "GET" && url.pathname === "/api/wallet/email") {
      const wallet = url.searchParams.get("wallet")?.trim();
      if (!wallet || !isAddress(wallet)) {
        handlers.sendJson(res, 400, { error: "wallet required" });
        return true;
      }
      const record = db.getWalletEmail(wallet);
      handlers.sendJson(res, 200, {
        wallet: getAddress(wallet).toLowerCase(),
        email: record ? maskEmail(record.email) : null,
        verified: Boolean(record?.verifiedAt),
        hasEmail: Boolean(record),
      });
      return true;
    }

    if (req.method === "POST" && url.pathname === "/api/wallet/email") {
      await attachEmail(req, res, db, appConfig, handlers);
      return true;
    }

    if (req.method === "POST" && url.pathname === "/api/wallet/email/verify") {
      await verifyEmailOtp(req, res, db, appConfig, handlers, "attach");
      return true;
    }

    if (req.method === "POST" && url.pathname === "/api/wallet/recovery/email/start") {
      await startRecoveryEmailLookup(req, res, db, appConfig, handlers);
      return true;
    }

    if (req.method === "POST" && url.pathname === "/api/wallet/recovery/email/verify") {
      await verifyRecoveryEmailLookup(req, res, db, appConfig, handlers);
      return true;
    }

    if (req.method === "GET" && url.pathname === "/api/wallet/recovery/email/wallets") {
      await listRecoveryEmailWallets(req, res, db, appConfig, handlers);
      return true;
    }

    if (req.method === "POST" && url.pathname === "/api/wallet/recovery/challenges") {
      const body = await handlers.readJson(req);
      const purpose = str(body.purpose) as HostedRecoveryChallengePurpose | undefined;
      if (purpose !== "attach" && purpose !== "recover" && purpose !== "cancel" && purpose !== "record") {
        handlers.sendJson(res, 400, { error: "purpose must be attach, recover, cancel, or record" });
        return true;
      }
      const challenge = challengeToBase64Url(randomBytes(32));
      const record = db.createHostedRecoveryChallenge({
        purpose,
        challenge,
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

    if (req.method === "GET" && url.pathname === "/api/wallet/recovery") {
      await getRecoveryStatus(res, db, appConfig, handlers, url);
      return true;
    }

    if (req.method === "POST" && url.pathname === "/api/wallet/recovery/requests") {
      await createRecoveryRequest(req, res, db, appConfig, handlers);
      return true;
    }

    const verifyMatch = url.pathname.match(
      /^\/api\/wallet\/recovery\/requests\/([^/]+)\/verify-email$/
    );
    if (req.method === "POST" && verifyMatch) {
      await verifyRecoveryEmail(req, res, db, appConfig, handlers, verifyMatch[1]!);
      return true;
    }

    const cancelMatch = url.pathname.match(
      /^\/api\/wallet\/recovery\/requests\/([^/]+)\/cancel$/
    );
    if (req.method === "POST" && cancelMatch) {
      await cancelRecoveryRequest(req, res, db, appConfig, handlers, cancelMatch[1]!);
      return true;
    }

    // Guardian routes
    if (url.pathname.startsWith("/api/guardian")) {
      return handleGuardian(req, res, url, db, appConfig, handlers);
    }

    return false;
  };
}

async function requireCaptcha(
  appConfig: AppConfig,
  body: Record<string, unknown>,
  req: IncomingMessage
): Promise<void> {
  if (!appConfig.turnstileSecret) return;
  const ok = await verifyCaptcha(appConfig, body.captchaToken, req.socket.remoteAddress);
  if (!ok) {
    throw Object.assign(new Error("Captcha required"), { statusCode: 400, code: "captcha_failed" });
  }
}

function hostedRpId(appConfig: AppConfig): string {
  try {
    return new URL(appConfig.baseUrl).hostname;
  } catch {
    return "localhost";
  }
}

async function attachEmail(
  req: IncomingMessage,
  res: ServerResponse,
  db: CommerceDb,
  appConfig: AppConfig,
  handlers: Handlers
): Promise<void> {
  const body = await handlers.readJson(req);
  try {
    await requireCaptcha(appConfig, body, req);
  } catch (e) {
    handlers.sendJson(res, statusOf(e), { error: codeOf(e), message: messageOf(e) });
    return;
  }
  const walletAddress = str(body.walletAddress);
  const email = str(body.email)?.toLowerCase();
  const challengeId = str(body.challengeId);
  const ownerQx = normalizeHex32(str(body.ownerQx));
  const ownerQy = normalizeHex32(str(body.ownerQy));
  if (!walletAddress || !isAddress(walletAddress) || !email || !challengeId || !ownerQx || !ownerQy) {
    handlers.sendJson(res, 400, {
      error: "walletAddress, email, challengeId, ownerQx, ownerQy required",
    });
    return;
  }
  if (!email.includes("@")) {
    handlers.sendJson(res, 400, { error: "invalid_email" });
    return;
  }
  const account = db.getWalletAccount(walletAddress);
  if (!account) {
    handlers.sendJson(res, 404, { error: "account_not_found" });
    return;
  }
  const device =
    db.listWalletDevices(walletAddress, appConfig.wallet.chainId).find(
      (d) => d.ownerQx === ownerQx && d.ownerQy === ownerQy
    ) ??
    (account.ownerQx === ownerQx && account.ownerQy === ownerQy ? account : null);
  if (!device && !(account.ownerQx === ownerQx && account.ownerQy === ownerQy)) {
    handlers.sendJson(res, 403, { error: "unknown_owner_device" });
    return;
  }
  const challenge = db.consumeHostedRecoveryChallenge({ id: challengeId, purpose: "attach" });
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
      rpId: hostedRpId(appConfig),
      origins: null,
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

  db.upsertWalletEmail({ walletAddress, email, verifiedAt: null });
  const code = generateOtpCode();
  db.createWalletEmailOtp({
    walletAddress,
    email,
    purpose: "attach",
    codeHash: hashOtpCode(code),
  });
  try {
    await sendOtpEmail(appConfig.email, { to: email, code, purpose: "attach" });
  } catch (e) {
    handlers.sendJson(res, statusOf(e), { error: "email_send_failed", message: messageOf(e) });
    return;
  }
  handlers.sendJson(res, 200, {
    ok: true,
    email: maskEmail(email),
    verified: false,
    otpSent: true,
  });
}

async function verifyEmailOtp(
  req: IncomingMessage,
  res: ServerResponse,
  db: CommerceDb,
  appConfig: AppConfig,
  handlers: Handlers,
  purpose: "attach"
): Promise<void> {
  const body = await handlers.readJson(req);
  try {
    await requireCaptcha(appConfig, body, req);
  } catch (e) {
    handlers.sendJson(res, statusOf(e), { error: codeOf(e), message: messageOf(e) });
    return;
  }
  const walletAddress = str(body.walletAddress);
  const email = str(body.email)?.toLowerCase();
  const code = str(body.code);
  if (!walletAddress || !email || !code) {
    handlers.sendJson(res, 400, { error: "walletAddress, email, code required" });
    return;
  }
  const ok = db.consumeWalletEmailOtp({
    walletAddress,
    email,
    purpose,
    codeHash: hashOtpCode(code),
  });
  if (!ok) {
    handlers.sendJson(res, 400, { error: "invalid_otp" });
    return;
  }
  const record = db.markWalletEmailVerified(walletAddress, email);
  handlers.sendJson(res, 200, {
    ok: true,
    email: maskEmail(email),
    verified: true,
    wallet: record?.walletAddress,
  });
}

const ZERO_PUBKEY = `0x${"0".repeat(64)}`;

function emailSessionSecret(appConfig: AppConfig): string {
  return appConfig.guardianSessionSecret ?? appConfig.adminApiKey ?? "";
}

function readEmailSessionToken(req: IncomingMessage, body?: Record<string, unknown>): string | undefined {
  const fromBody = str(body?.emailSession);
  if (fromBody) return fromBody;
  const auth = req.headers.authorization;
  if (auth?.startsWith("Bearer ")) return auth.slice("Bearer ".length).trim();
  return undefined;
}

async function startRecoveryEmailLookup(
  req: IncomingMessage,
  res: ServerResponse,
  db: CommerceDb,
  appConfig: AppConfig,
  handlers: Handlers
): Promise<void> {
  const body = await handlers.readJson(req);
  try {
    await requireCaptcha(appConfig, body, req);
  } catch (e) {
    handlers.sendJson(res, statusOf(e), { error: codeOf(e), message: messageOf(e) });
    return;
  }
  const email = str(body.email)?.toLowerCase();
  if (!email?.includes("@")) {
    handlers.sendJson(res, 400, { error: "invalid_email" });
    return;
  }
  const wallets = db.listWalletsByVerifiedEmail(email);
  if (wallets.length) {
    const code = generateOtpCode();
    db.createWalletEmailOtp({
      walletAddress: emailLookupOtpWallet(email),
      email,
      purpose: "recover",
      codeHash: hashOtpCode(code),
    });
    try {
      await sendOtpEmail(appConfig.email, { to: email, code, purpose: "recover" });
    } catch (e) {
      handlers.sendJson(res, statusOf(e), { error: "email_send_failed", message: messageOf(e) });
      return;
    }
  }
  handlers.sendJson(res, 200, { ok: true });
}

async function verifyRecoveryEmailLookup(
  req: IncomingMessage,
  res: ServerResponse,
  db: CommerceDb,
  appConfig: AppConfig,
  handlers: Handlers
): Promise<void> {
  const body = await handlers.readJson(req);
  try {
    await requireCaptcha(appConfig, body, req);
  } catch (e) {
    handlers.sendJson(res, statusOf(e), { error: codeOf(e), message: messageOf(e) });
    return;
  }
  const email = str(body.email)?.toLowerCase();
  const code = str(body.code);
  if (!email?.includes("@") || !code) {
    handlers.sendJson(res, 400, { error: "email and code required" });
    return;
  }
  const ok = db.consumeWalletEmailOtp({
    walletAddress: emailLookupOtpWallet(email),
    email,
    purpose: "recover",
    codeHash: hashOtpCode(code),
  });
  if (!ok) {
    handlers.sendJson(res, 400, { error: "invalid_otp" });
    return;
  }
  const secret = emailSessionSecret(appConfig);
  if (!secret) {
    handlers.sendJson(res, 503, { error: "email_session_unavailable" });
    return;
  }
  const emailSession = issueRecoveryEmailSession(secret, email);
  handlers.sendJson(res, 200, { emailSession, email: maskEmail(email) });
}

async function listRecoveryEmailWallets(
  req: IncomingMessage,
  res: ServerResponse,
  db: CommerceDb,
  appConfig: AppConfig,
  handlers: Handlers
): Promise<void> {
  const email = verifyRecoveryEmailSession(emailSessionSecret(appConfig), readEmailSessionToken(req));
  if (!email) {
    handlers.sendJson(res, 401, { error: "invalid_email_session" });
    return;
  }
  const records = db.listWalletsByVerifiedEmail(email);
  const wallets = records.map((row) => {
    const account = db.getWalletAccount(row.walletAddress);
    const active = db.getActiveWalletRecoveryRequest(row.walletAddress);
    return {
      address: row.walletAddress,
      createdAt: account?.createdAt ?? row.createdAt,
      activeRecovery: Boolean(active),
    };
  });
  handlers.sendJson(res, 200, { wallets });
}

async function createRecoveryRequest(
  req: IncomingMessage,
  res: ServerResponse,
  db: CommerceDb,
  appConfig: AppConfig,
  handlers: Handlers
): Promise<void> {
  const body = await handlers.readJson(req);
  try {
    await requireCaptcha(appConfig, body, req);
  } catch (e) {
    handlers.sendJson(res, statusOf(e), { error: codeOf(e), message: messageOf(e) });
    return;
  }

  const sessionEmail = verifyRecoveryEmailSession(
    emailSessionSecret(appConfig),
    readEmailSessionToken(req, body)
  );
  const emailInput = str(body.email)?.toLowerCase();
  const fromArray = Array.isArray(body.walletAddresses)
    ? body.walletAddresses.filter((v): v is string => typeof v === "string" && isAddress(v)).map((a) => getAddress(a))
    : [];
  let single = str(body.walletAddress);
  if (!single && !fromArray.length && emailInput && !sessionEmail) {
    const byEmail = db.findWalletByVerifiedEmail(emailInput);
    single = byEmail?.walletAddress;
  }
  const walletAddresses = fromArray.length
    ? fromArray
    : single && isAddress(single)
      ? [getAddress(single)]
      : [];
  if (!walletAddresses.length) {
    handlers.sendJson(res, 400, { error: "walletAddress or walletAddresses required" });
    return;
  }

  const ownerKind = parseOwnerKind(str(body.ownerKind) ?? str(body.newOwnerKind));
  const challengeId = str(body.challengeId);
  if (!challengeId) {
    handlers.sendJson(res, 400, { error: "challengeId required" });
    return;
  }

  const challenge = db.consumeHostedRecoveryChallenge({ id: challengeId, purpose: "recover" });
  if (!challenge) {
    handlers.sendJson(res, 400, { error: "invalid_or_expired_challenge" });
    return;
  }

  let ownerQx = normalizeHex32(str(body.ownerQx) ?? str(body.newOwnerQx));
  let ownerQy = normalizeHex32(str(body.ownerQy) ?? str(body.newOwnerQy));
  let credentialId = str(body.credentialId);
  let newEoa: string | null = null;
  let eoaSignature: string | null = null;

  if (ownerKind === "eoa") {
    const eoaAddress = str(body.eoaAddress);
    eoaSignature = str(body.eoaSignature) ?? null;
    if (!eoaAddress || !isAddress(eoaAddress) || !eoaSignature) {
      handlers.sendJson(res, 400, { error: "eoaAddress and eoaSignature required" });
      return;
    }
    try {
      const leftover = getAddress(verifyMessage(recoveryNewOwnerMessage(challenge.challenge), eoaSignature));
      if (leftover === getAddress(eoaAddress)) {
        handlers.sendJson(res, 400, { error: "eoa_personal_sign_rejected" });
        return;
      }
    } catch {
      // Not an EIP-191 recovery message — continue with EIP-712.
    }
    newEoa = getAddress(eoaAddress);
    ownerQx = ZERO_PUBKEY;
    ownerQy = ZERO_PUBKEY;
    credentialId = `eoa:${newEoa.toLowerCase()}`;
  } else {
    if (!ownerQx || !ownerQy || !credentialId) {
      handlers.sendJson(res, 400, { error: "ownerQx, ownerQy, credentialId required" });
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
        rpId: hostedRpId(appConfig),
        origins: null,
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
  }

  const now = new Date().toISOString();
  const chainId = str(body.chainId) ?? appConfig.wallet.chainId;
  const recoverChainId = Number(chainId);
  const deviceLabel = str(body.label) || (ownerKind === "eoa" ? "Recovery wallet" : "Recovery device");
  const created: WalletRecoveryRequestRecord[] = [];
  const skipped: Array<{ address: string; error: string }> = [];
  const existingOwners: EoaExistingOwner[] = [];

  for (const walletAddress of walletAddresses) {
    const account = db.getWalletAccount(walletAddress);
    if (!account) {
      skipped.push({ address: walletAddress, error: "account_not_found" });
      continue;
    }
    const existing = db.getActiveWalletRecoveryRequest(walletAddress);
    if (existing) {
      skipped.push({ address: walletAddress, error: "recovery_already_active" });
      continue;
    }
    if (ownerKind === "eoa" && newEoa && eoaSignature) {
      try {
        const recovered = verifyRecoverTypedData(
          walletAddress,
          challenge.challenge,
          newEoa,
          recoverChainId,
          eoaSignature
        );
        if (recovered !== newEoa) {
          skipped.push({ address: walletAddress, error: "eoa_signature_mismatch" });
          continue;
        }
      } catch (e) {
        skipped.push({
          address: walletAddress,
          error: "eoa_signature_failed",
        });
        void e;
        continue;
      }
      const onChain = await lookupEoaOwner({
        db,
        rpcUrl: appConfig.wallet.rpcUrl,
        wallet: walletAddress,
        eoa: newEoa,
      });
      if (onChain.existingOwner && onChain.threshold > 1) {
        skipped.push({ address: walletAddress, error: "threshold_not_one" });
        continue;
      }
      if (onChain.existingOwner) {
        existingOwners.push({
          address: walletAddress,
          advanced: onChain.advanced,
          entityId: onChain.entityId ?? null,
          keyId: onChain.keyId ?? null,
          threshold: onChain.threshold,
          eoa: newEoa,
        });
        continue;
      }
    }
    const emailRecord = db.getWalletEmail(walletAddress);
    if (sessionEmail) {
      if (!emailRecord?.verifiedAt || emailRecord.email !== sessionEmail) {
        skipped.push({ address: walletAddress, error: "email_mismatch" });
        continue;
      }
    }
    let email = sessionEmail ?? emailInput ?? emailRecordEmail(emailRecord);
    const emailVerified = Boolean(
      sessionEmail || (email && emailRecord?.verifiedAt && emailRecord.email === email)
    );
    const status = email && !emailVerified ? "awaiting_email" : "awaiting_guardian";
    const request = db.createWalletRecoveryRequest({
      walletAddress,
      email: email ?? "",
      newQx: ownerQx,
      newQy: ownerQy,
      credentialId,
      deviceLabel,
      newOwnerKind: ownerKind,
      newEoa,
      status,
      emailVerifiedAt: emailVerified || !email ? now : null,
      captchaOkAt: now,
      chainId,
    });
    created.push(request);

    if (email && !emailVerified) {
      const code = generateOtpCode();
      db.createWalletEmailOtp({
        walletAddress,
        email,
        purpose: "recover",
        codeHash: hashOtpCode(code),
      });
      try {
        await sendOtpEmail(appConfig.email, { to: email, code, purpose: "recover" });
      } catch (e) {
        handlers.sendJson(res, statusOf(e), { error: "email_send_failed", message: messageOf(e) });
        return;
      }
    }
  }

  if (!created.length) {
    if (existingOwners.length) {
      handlers.sendJson(res, 200, {
        request: null,
        requests: [],
        skipped,
        otpSent: false,
        existingOwner: true,
        existingOwners,
        advanced: existingOwners[0]!.advanced,
        entityId: existingOwners[0]!.entityId,
        keyId: existingOwners[0]!.keyId,
      });
      return;
    }
    const personal = skipped.find((s) => s.error === "eoa_personal_sign_rejected");
    if (personal && walletAddresses.length === 1) {
      handlers.sendJson(res, 400, { error: "eoa_personal_sign_rejected", skipped });
      return;
    }
    const sigFail = skipped.find(
      (s) => s.error === "eoa_signature_failed" || s.error === "eoa_signature_mismatch"
    );
    if (sigFail && walletAddresses.length === 1) {
      handlers.sendJson(res, 400, { error: sigFail.error, skipped });
      return;
    }
    if (skipped.every((s) => s.error === "threshold_not_one") && skipped.length) {
      handlers.sendJson(res, 400, { error: "threshold_not_one", skipped });
      return;
    }
    const conflict = skipped.find((s) => s.error === "recovery_already_active");
    if (conflict && walletAddresses.length === 1) {
      const existing = db.getActiveWalletRecoveryRequest(walletAddresses[0]!);
      handlers.sendJson(res, 409, { error: "recovery_already_active", request: existing ? publicRequest(existing) : undefined });
      return;
    }
    handlers.sendJson(res, 404, { error: skipped[0]?.error ?? "account_not_found", skipped });
    return;
  }

  await notifyRecoveryRequested(appConfig, created).catch((e) => {
    console.error("[email] recovery notify:", e);
  });

  const otpSent = created.some((r) => r.status === "awaiting_email");
  handlers.sendJson(res, 201, {
    request: publicRequest(created[0]!),
    requests: created.map(publicRequest),
    skipped,
    otpSent,
    existingOwner: existingOwners.length > 0,
    existingOwners,
    advanced: existingOwners[0]?.advanced ?? false,
    entityId: existingOwners[0]?.entityId ?? null,
    keyId: existingOwners[0]?.keyId ?? null,
  });
}

type EoaExistingOwner = {
  address: string;
  advanced: boolean;
  entityId: string | null;
  keyId: string | null;
  threshold: number;
  eoa: string;
};

const EOA_OWNER_LOOKUP_ABI = [
  "function advanced() view returns (bool)",
  "function isOwner(bytes32 qx, bytes32 qy) view returns (bool)",
  "function threshold() view returns (uint8)",
  "function getKeyRecord(bytes32 keyId) view returns (tuple(bytes32 entityId, uint8 keyType, bytes32 qx, bytes32 qy, address eoa))",
];

async function lookupEoaOwner(input: {
  db: CommerceDb;
  rpcUrl?: string;
  wallet: string;
  eoa: string;
}): Promise<{
  existingOwner: boolean;
  advanced: boolean;
  entityId?: string;
  keyId?: string;
  threshold: number;
}> {
  const empty = { existingOwner: false, advanced: false, threshold: 1 };
  if (!input.rpcUrl) return empty;
  try {
    const provider = new JsonRpcProvider(input.rpcUrl);
    const code = await provider.getCode(input.wallet);
    if (!code || code === "0x" || code === "0x0") return empty;
    const contract = new Contract(input.wallet, EOA_OWNER_LOOKUP_ABI, provider);
    let advanced = false;
    try {
      advanced = Boolean(await contract.advanced());
    } catch {
      advanced = false;
    }
    if (advanced) {
      let threshold = 1;
      try {
        threshold = Number(await contract.threshold());
      } catch {
        threshold = 1;
      }
      const keys = input.db.listWalletEntityKeys(input.wallet);
      const match = keys.find(
        (k) => k.keyType === KEY_EOA && k.eoa && getAddress(k.eoa) === input.eoa
      );
      if (match) {
        try {
          const rec = await contract.getKeyRecord(match.keyId);
          if (rec?.eoa && getAddress(rec.eoa) === input.eoa && rec.entityId !== ZeroHash) {
            return {
              existingOwner: true,
              advanced: true,
              entityId: rec.entityId,
              keyId: match.keyId,
              threshold,
            };
          }
        } catch {
          // Record missing on-chain.
        }
      }
      return { existingOwner: false, advanced: true, threshold };
    }
    const { qx, qy } = eoaOwnerCoords(input.eoa);
    try {
      if (await contract.isOwner(qx, qy)) {
        return { existingOwner: true, advanced: false, threshold: 1 };
      }
    } catch {
      // Pre-EOA implementations revert on sentinel owners.
    }
    return empty;
  } catch {
    return empty;
  }
}

function emailRecordEmail(record: { email: string } | null): string | undefined {
  return record?.email;
}

function parseOwnerKind(value: string | undefined): WalletRecoveryNewOwnerKind {
  if (value === "yubikey" || value === "eoa") return value;
  return "webauthn";
}

async function notifyRecoveryRequested(
  appConfig: AppConfig,
  requests: WalletRecoveryRequestRecord[]
): Promise<void> {
  const lines = [
    "A hosted wallet recovery was requested.",
    "",
    ...requests.flatMap((r) => [
      `Request: ${r.id}`,
      `Wallet: ${r.walletAddress}`,
      `Email: ${r.email || "(none)"}`,
      `Signer: ${r.newOwnerKind}`,
      r.newEoa ? `EOA: ${r.newEoa}` : `New key: ${r.newQx.slice(0, 18)}… / ${r.newQy.slice(0, 18)}…`,
      `Device: ${r.deviceLabel ?? ""}`,
      `Chain: ${r.chainId}`,
      `Created: ${r.createdAt}`,
      `Status: ${r.status}`,
      "",
    ]),
  ];
  await sendRecoveryRequestedEmail(appConfig.email, { text: lines.join("\n").trim() });
}

async function verifyRecoveryEmail(
  req: IncomingMessage,
  res: ServerResponse,
  db: CommerceDb,
  appConfig: AppConfig,
  handlers: Handlers,
  requestId: string
): Promise<void> {
  const body = await handlers.readJson(req);
  try {
    await requireCaptcha(appConfig, body, req);
  } catch (e) {
    handlers.sendJson(res, statusOf(e), { error: codeOf(e), message: messageOf(e) });
    return;
  }
  const request = db.getWalletRecoveryRequest(requestId);
  if (!request) {
    handlers.sendJson(res, 404, { error: "request_not_found" });
    return;
  }
  if (request.status !== "awaiting_email") {
    handlers.sendJson(res, 400, { error: "not_awaiting_email", status: request.status });
    return;
  }
  const code = str(body.code);
  if (!code) {
    handlers.sendJson(res, 400, { error: "code required" });
    return;
  }
  const ok = db.consumeWalletEmailOtp({
    walletAddress: request.walletAddress,
    email: request.email,
    purpose: "recover",
    codeHash: hashOtpCode(code),
  });
  if (!ok) {
    handlers.sendJson(res, 400, { error: "invalid_otp" });
    return;
  }
  const now = new Date().toISOString();
  db.markWalletEmailVerified(request.walletAddress, request.email);
  const updated = db.updateWalletRecoveryRequest(request.id, {
    status: "awaiting_guardian",
    emailVerifiedAt: now,
  });
  handlers.sendJson(res, 200, { request: publicRequest(updated!) });
}

async function cancelRecoveryRequest(
  req: IncomingMessage,
  res: ServerResponse,
  db: CommerceDb,
  appConfig: AppConfig,
  handlers: Handlers,
  requestId: string
): Promise<void> {
  const body = await handlers.readJson(req);
  try {
    await requireCaptcha(appConfig, body, req);
  } catch (e) {
    handlers.sendJson(res, statusOf(e), { error: codeOf(e), message: messageOf(e) });
    return;
  }
  const request = db.getWalletRecoveryRequest(requestId);
  if (!request) {
    handlers.sendJson(res, 404, { error: "request_not_found" });
    return;
  }
  if (
    request.status === "completed" ||
    request.status === "archived" ||
    request.status === "cancelled" ||
    request.status === "rejected"
  ) {
    handlers.sendJson(res, 400, { error: "not_cancellable", status: request.status });
    return;
  }
  const challengeId = str(body.challengeId);
  const ownerQx = normalizeHex32(str(body.ownerQx));
  const ownerQy = normalizeHex32(str(body.ownerQy));
  const credentialId = str(body.credentialId);
  if (!challengeId || !credentialId) {
    handlers.sendJson(res, 400, { error: "challengeId and credentialId required" });
    return;
  }
  const device =
    db.getWalletDeviceByCredentialId(credentialId, request.walletAddress) ??
    (ownerQx && ownerQy
      ? db
          .listWalletDevices(request.walletAddress, appConfig.wallet.chainId)
          .find((d) => d.ownerQx === ownerQx && d.ownerQy === ownerQy)
      : null);
  const account = db.getWalletAccount(request.walletAddress);
  const qx = ownerQx ?? device?.ownerQx ?? account?.ownerQx;
  const qy = ownerQy ?? device?.ownerQy ?? account?.ownerQy;
  if (!qx || !qy) {
    handlers.sendJson(res, 403, { error: "unknown_owner_device" });
    return;
  }
  const challenge = db.consumeHostedRecoveryChallenge({ id: challengeId, purpose: "cancel" });
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
      rpId: hostedRpId(appConfig),
      origins: null,
      ownerQx: qx,
      ownerQy: qy,
    });
  } catch (e) {
    handlers.sendJson(res, statusOf(e), {
      error: (e as { code?: string }).code ?? "assertion_failed",
      message: messageOf(e),
    });
    return;
  }

  // If on-chain pending, enqueue cancel job with assertion payload
  if (request.status === "on_chain" || request.status === "queued") {
    const job = db.createWalletRecoveryJob({
      walletAddress: request.walletAddress,
      chainId: request.chainId,
      kind: "cancel",
      cancelSignature: JSON.stringify(assertion),
    });
    db.updateWalletRecoveryRequest(request.id, { status: "cancelled", jobId: job.id });
  } else {
    db.updateWalletRecoveryRequest(request.id, { status: "cancelled" });
  }
  handlers.sendJson(res, 200, {
    request: publicRequest(db.getWalletRecoveryRequest(request.id)!),
  });
}

async function getRecoveryStatus(
  res: ServerResponse,
  db: CommerceDb,
  appConfig: AppConfig,
  handlers: Handlers,
  url: URL
): Promise<void> {
  const wallet = url.searchParams.get("wallet")?.trim();
  if (!wallet || !isAddress(wallet)) {
    handlers.sendJson(res, 400, { error: "wallet required" });
    return;
  }
  const request = db.getActiveWalletRecoveryRequest(wallet);
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
      const contract = new Contract(
        getAddress(wallet),
        [
          "function pendingOwner() view returns (bytes32 qx, bytes32 qy, uint64 executableAt, bytes32 requestId, bool active)",
        ],
        provider
      );
      const p = await contract.pendingOwner();
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
  const email = db.getWalletEmail(wallet);
  handlers.sendJson(res, 200, {
    request: request ? publicRequest(request) : null,
    pendingOwner,
    email: email
      ? { email: maskEmail(email.email), verified: Boolean(email.verifiedAt) }
      : null,
  });
}

async function handleGuardian(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  db: CommerceDb,
  appConfig: AppConfig,
  handlers: Handlers
): Promise<boolean> {
  if (req.method === "GET" && url.pathname === "/api/guardian/nonce") {
    const address = url.searchParams.get("address")?.trim();
    if (!address || !isAddress(address)) {
      handlers.sendJson(res, 400, { error: "address required" });
      return true;
    }
    const guardian = await resolveGuardianAddress(appConfig);
    if (!guardian || getAddress(address) !== getAddress(guardian)) {
      handlers.sendJson(res, 403, { error: "not_guardian" });
      return true;
    }
    const nonce = randomBytes(16).toString("hex");
    db.consumeGuardianNonce(address, nonce, 10 * 60 * 1000);
    const issuedAt = new Date().toISOString();
    const message = guardianLoginMessage(address, nonce, issuedAt);
    handlers.sendJson(res, 200, { nonce, issuedAt, message, guardian });
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/guardian/login") {
    const body = await handlers.readJson(req);
    const address = str(body.address);
    const signature = str(body.signature);
    const message = str(body.message);
    const nonce = str(body.nonce);
    if (!address || !signature || !message || !nonce) {
      handlers.sendJson(res, 400, { error: "address, signature, message, nonce required" });
      return true;
    }
    const guardian = await resolveGuardianAddress(appConfig);
    if (!guardian || getAddress(address) !== getAddress(guardian)) {
      handlers.sendJson(res, 403, { error: "not_guardian" });
      return true;
    }
    if (!db.takeGuardianNonce(address, nonce)) {
      handlers.sendJson(res, 401, { error: "invalid_or_reused_nonce" });
      return true;
    }
    let recovered: string;
    try {
      recovered = getAddress(verifyMessage(message, signature));
    } catch {
      handlers.sendJson(res, 401, { error: "invalid_signature" });
      return true;
    }
    if (recovered !== getAddress(address)) {
      handlers.sendJson(res, 401, { error: "invalid_signature" });
      return true;
    }
    if (!message.includes(nonce) || !message.toLowerCase().includes("guardian")) {
      handlers.sendJson(res, 401, { error: "invalid_message" });
      return true;
    }

    const token = randomBytes(32).toString("hex");
    const tokenHash = hashToken(token);
    db.createGuardianSession({ tokenHash, address: getAddress(address) });
    handlers.sendJson(res, 200, {
      token,
      address: getAddress(address),
      expiresInSeconds: 12 * 60 * 60,
    });
    return true;
  }

  const session = requireGuardianSession(req, db);
  if (!session) {
    if (url.pathname.startsWith("/api/guardian")) {
      handlers.sendJson(res, 401, { error: "unauthorized" });
      return true;
    }
    return false;
  }

  const guardian = await resolveGuardianAddress(appConfig);
  if (!guardian || getAddress(session.address) !== getAddress(guardian)) {
    handlers.sendJson(res, 403, { error: "not_guardian" });
    return true;
  }

  if (req.method === "GET" && url.pathname === "/api/guardian/me") {
    handlers.sendJson(res, 200, { address: session.address, guardian });
    return true;
  }

  if (req.method === "GET" && url.pathname === "/api/guardian/recovery-requests") {
    const requested = url.searchParams.get("status");
    let statuses: WalletRecoveryRequestStatus[] | undefined;
    if (requested === "active") {
      statuses = ["awaiting_guardian", "queued", "on_chain"];
    } else if (requested === "archive") {
      statuses = ["completed", "cancelled", "rejected", "archived"];
    } else if (requested) {
      statuses = requested.split(",").map((s) => s.trim()) as WalletRecoveryRequestStatus[];
    } else {
      statuses = ["awaiting_guardian", "queued", "on_chain"];
    }
    const requests = db.listWalletRecoveryRequests(statuses).map((r) => guardianRequest(r));
    handlers.sendJson(res, 200, { requests });
    return true;
  }

  const approveMatch = url.pathname.match(
    /^\/api\/guardian\/recovery-requests\/([^/]+)\/approve$/
  );
  if (req.method === "POST" && approveMatch) {
    const request = db.getWalletRecoveryRequest(approveMatch[1]!);
    if (!request) {
      handlers.sendJson(res, 404, { error: "request_not_found" });
      return true;
    }
    if (request.status !== "awaiting_guardian") {
      handlers.sendJson(res, 400, { error: "not_awaiting_guardian", status: request.status });
      return true;
    }
    if (!request.emailVerifiedAt && request.email) {
      handlers.sendJson(res, 400, { error: "email_not_verified" });
      return true;
    }
    if (request.newOwnerKind === "eoa" || isZeroPubkey(request.newQx, request.newQy)) {
      handlers.sendJson(res, 400, {
        error: "eoa_new_owner_manual",
        message: "EOA new owners are not initiated on-chain. Review the request and handle manually.",
      });
      return true;
    }
    const job = db.createWalletRecoveryJob({
      walletAddress: request.walletAddress,
      chainId: request.chainId,
      kind: "initiate",
      newQx: request.newQx,
      newQy: request.newQy,
    });
    // Register recovery device for later UI
    db.upsertWalletDevice({
      walletAddress: request.walletAddress,
      chainId: request.chainId,
      ownerQx: request.newQx,
      ownerQy: request.newQy,
      label: request.deviceLabel || "Recovery device",
      credentialId: request.credentialId,
    });
    const now = new Date().toISOString();
    const updated = db.updateWalletRecoveryRequest(request.id, {
      status: "queued",
      guardianAddress: session.address,
      guardianActedAt: now,
      jobId: job.id,
    });
    handlers.sendJson(res, 200, { request: guardianRequest(updated!), job });
    return true;
  }

  const rejectMatch = url.pathname.match(
    /^\/api\/guardian\/recovery-requests\/([^/]+)\/reject$/
  );
  if (req.method === "POST" && rejectMatch) {
    const request = db.getWalletRecoveryRequest(rejectMatch[1]!);
    if (!request) {
      handlers.sendJson(res, 404, { error: "request_not_found" });
      return true;
    }
    if (request.status !== "awaiting_guardian" && request.status !== "awaiting_email") {
      handlers.sendJson(res, 400, { error: "not_rejectable", status: request.status });
      return true;
    }
    const now = new Date().toISOString();
    const updated = db.updateWalletRecoveryRequest(request.id, {
      status: "rejected",
      guardianAddress: session.address,
      guardianActedAt: now,
    });
    handlers.sendJson(res, 200, { request: guardianRequest(updated!) });
    return true;
  }

  handlers.sendJson(res, 404, { error: "Not found" });
  return true;
}

/** GET /nonce inserts nonce; login deletes it (one-time). — removed unused helper */

function requireGuardianSession(
  req: IncomingMessage,
  db: CommerceDb
): { address: string } | null {
  const header = req.headers["x-guardian-session"];
  const auth = req.headers.authorization;
  const token =
    typeof header === "string"
      ? header
      : auth?.startsWith("Bearer ")
        ? auth.slice("Bearer ".length)
        : undefined;
  if (!token) return null;
  return db.getGuardianSession(hashToken(token));
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function guardianLoginMessage(address: string, nonce: string, issuedAt: string): string {
  return [
    "Trustless Commerce guardian login",
    `Address: ${getAddress(address)}`,
    `Nonce: ${nonce}`,
    `Issued At: ${issuedAt}`,
  ].join("\n");
}

export async function resolveGuardianAddress(appConfig: AppConfig): Promise<string | null> {
  if (guardianCache && Date.now() - guardianCache.fetchedAt < 60_000) {
    return guardianCache.address;
  }
  if (appConfig.wallet.recoveryAddress && appConfig.wallet.rpcUrl) {
    try {
      const provider = new JsonRpcProvider(appConfig.wallet.rpcUrl);
      const recovery = new Contract(
        appConfig.wallet.recoveryAddress,
        ["function guardian() view returns (address)"],
        provider
      );
      const g = getAddress(await recovery.guardian());
      guardianCache = { address: g, fetchedAt: Date.now() };
      return g;
    } catch {
      /* fall through */
    }
  }
  if (appConfig.walletAdminGuardian) {
    const g = getAddress(appConfig.walletAdminGuardian);
    guardianCache = { address: g, fetchedAt: Date.now() };
    return g;
  }
  return null;
}

/** Sync hosted request status when recovery jobs complete (called from worker track path via API). */
export function syncRequestFromJob(
  db: CommerceDb,
  jobId: string,
  jobStatus: string
): void {
  const request = db.getWalletRecoveryRequestByJobId(jobId);
  if (!request) return;
  if (jobStatus === "included") {
    const job = db.getWalletRecoveryJob(jobId);
    if (job?.kind === "initiate") {
      db.updateWalletRecoveryRequest(request.id, { status: "on_chain" });
    } else if (job?.kind === "execute") {
      db.updateWalletRecoveryRequest(request.id, { status: "completed" });
      db.updateWalletRecoveryRequest(request.id, { status: "archived" });
    } else if (job?.kind === "cancel") {
      db.updateWalletRecoveryRequest(request.id, { status: "cancelled" });
    }
  } else if (jobStatus === "failed" || jobStatus === "rejected") {
    // leave queued/on_chain for retry visibility
  }
}

function publicRequest(r: {
  id: string;
  walletAddress: string;
  email: string;
  newQx: string;
  newQy: string;
  credentialId: string;
  deviceLabel: string | null;
  newOwnerKind?: WalletRecoveryNewOwnerKind;
  newEoa?: string | null;
  status: string;
  emailVerifiedAt: string | null;
  guardianAddress: string | null;
  guardianActedAt: string | null;
  jobId: string | null;
  chainId: string;
  createdAt: string;
  updatedAt: string;
}) {
  return {
    id: r.id,
    walletAddress: r.walletAddress,
    email: r.email ? maskEmail(r.email) : "",
    newQx: r.newQx,
    newQy: r.newQy,
    credentialId: r.credentialId,
    deviceLabel: r.deviceLabel,
    newOwnerKind: r.newOwnerKind ?? "webauthn",
    newEoa: r.newEoa,
    status: r.status,
    emailVerifiedAt: r.emailVerifiedAt,
    guardianAddress: r.guardianAddress,
    guardianActedAt: r.guardianActedAt,
    jobId: r.jobId,
    chainId: r.chainId,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

function guardianRequest(r: Parameters<typeof publicRequest>[0]) {
  return { ...publicRequest(r), email: r.email };
}

function normalizeHex32(value: string | undefined): string | null {
  if (!value) return null;
  const v = value.trim().toLowerCase();
  if (!/^0x[0-9a-f]{64}$/.test(v)) return null;
  return v;
}

function isZeroPubkey(qx: string, qy: string): boolean {
  return /^0x0+$/.test(qx.trim().toLowerCase()) && /^0x0+$/.test(qy.trim().toLowerCase());
}

function str(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const t = value.trim();
  return t.length ? t : undefined;
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

function codeOf(error: unknown): string {
  return typeof error === "object" && error && "code" in error
    ? String((error as { code: string }).code)
    : "error";
}
