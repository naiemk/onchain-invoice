import type { IncomingMessage, ServerResponse } from "node:http";
import { ZeroAddress, getAddress, hexlify, isAddress, isHexString, randomBytes, verifyTypedData } from "ethers";
import { verifyCaptcha } from "./captcha.js";
import type { AppConfig } from "./config.js";
import type { CommerceDb } from "./db.js";
import { generateOtpCode, hashOtpCode, maskEmail, sendOtpEmail, getLastDevOtp } from "./email.js";
import { exchangeGoogleCode, googleAuthUrl, parseGoogleIdToken } from "./google-oauth.js";
import {
  addIdentityMethodOnChain,
  identityMethodExistsOnChain,
  readIdentityRestoreEnabled,
  registerIdentityOnChain,
  removeIdentityMethodOnChain,
  restoreIdentityMethodOnChain,
} from "./identity-onchain.js";
import {
  clearIdentityCookie,
  clearOAuthStateCookie,
  issueIdentityRecoverSession,
  issueIdentitySession,
  issueOAuthState,
  parseCookieHeader,
  readIdentityRecoverSessionFromRequest,
  readIdentitySessionFromRequest,
  setIdentityCookie,
  setIdentityRecoverCookie,
  setOAuthStateCookie,
  verifyOAuthState,
} from "./identity-session.js";
import { loginOptionsAfterFailedGet } from "../shared/identity-store.js";
import {
  computeIdentityMethodId,
  identityEip712Domain,
  IDENTITY_VERIFY_TYPES,
  METHOD_EOA,
  METHOD_WEBAUTHN,
  METHOD_YUBIKEY,
} from "../shared/identity-store.js";
import { GOOGLE_OAUTH_COOKIE_NAME } from "../shared/identity.js";
import type { IdentityMethodKind } from "../shared/identity.js";
import { deriveIdentityWalletSalt, predictWalletAddress } from "../shared/wallet-address.js";
import { clientIp, takeToken } from "./rate-limit.js";

type Handlers = {
  sendJson: (res: ServerResponse, code: number, body: unknown) => void;
  readJson: (req: IncomingMessage) => Promise<Record<string, unknown>>;
};

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function identityOtpWallet(email: string): string {
  return `identity:${email.trim().toLowerCase()}`;
}

function sessionSecret(config: AppConfig): string {
  return config.identity.sessionSecret;
}

function cookieSecure(config: AppConfig): boolean {
  return config.baseUrl.startsWith("https://");
}

function requireSession(req: IncomingMessage, config: AppConfig) {
  const session = readIdentitySessionFromRequest(sessionSecret(config), req);
  if (!session) {
    throw Object.assign(new Error("unauthorized"), { statusCode: 401, code: "unauthorized" });
  }
  return session;
}

function identityFromCredentialId(db: CommerceDb, credentialId: string) {
  const method = db.getIdentityMethodByCredentialId(credentialId);
  if (!method) return null;
  return db.getIdentityById(method.identityId);
}

function kindToNum(kind: IdentityMethodKind): number {
  if (kind === "yubikey") return METHOD_YUBIKEY;
  if (kind === "eoa") return METHOD_EOA;
  return METHOD_WEBAUTHN;
}

function numToKind(kind: number): IdentityMethodKind {
  if (kind === METHOD_YUBIKEY) return "yubikey";
  if (kind === METHOD_EOA) return "eoa";
  return "webauthn";
}

function normalizeQxQy(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const v = value.trim().toLowerCase();
  if (!isHexString(v, 32)) return undefined;
  return v;
}

function methodCounts(db: CommerceDb, identityId: string) {
  const methods = db.listIdentityMethods(identityId);
  return {
    webauthn: methods.filter((m) => m.kind === "webauthn").length,
    yubikey: methods.filter((m) => m.kind === "yubikey").length,
    eoa: methods.filter((m) => m.kind === "eoa").length,
  };
}

function mePayload(
  db: CommerceDb,
  identityId: string,
  email: string,
  restoreEnabled = true
) {
  const counts = methodCounts(db, identityId);
  const identityExists = counts.webauthn + counts.yubikey + counts.eoa > 0;
  return {
    email,
    identityId,
    methods: counts,
    keys: db.listIdentityMethods(identityId),
    identityExists,
    restoreEnabled,
    options: loginOptionsAfterFailedGet({
      identityExists,
      webauthnCount: counts.webauthn,
      yubikeyCount: counts.yubikey,
      eoaCount: counts.eoa,
    }),
  };
}

async function mePayloadWithRestore(db: CommerceDb, config: AppConfig, identityId: string, email: string) {
  const restoreEnabled = await readIdentityRestoreEnabled(config.identity, identityId);
  return mePayload(db, identityId, email, restoreEnabled);
}

const recoverChallenges = new Map<string, { challenge: string; exp: number }>();

function recoverChallengeKey(req: IncomingMessage): string {
  return clientIp(req);
}

function issueRecoverChallenge(req: IncomingMessage): string {
  const challenge = hexlify(randomBytes(32));
  recoverChallenges.set(recoverChallengeKey(req), { challenge, exp: Date.now() + 5 * 60 * 1000 });
  return challenge;
}

function consumeRecoverChallenge(req: IncomingMessage, challenge: string | undefined): boolean {
  if (!challenge) return false;
  const row = recoverChallenges.get(recoverChallengeKey(req));
  recoverChallenges.delete(recoverChallengeKey(req));
  if (!row || row.exp < Date.now()) return false;
  return row.challenge.toLowerCase() === challenge.trim().toLowerCase();
}

function requireRecoverSession(req: IncomingMessage, config: AppConfig) {
  const session = readIdentityRecoverSessionFromRequest(sessionSecret(config), req);
  if (!session) {
    throw Object.assign(new Error("unauthorized"), { statusCode: 401, code: "unauthorized" });
  }
  return session;
}

async function requireCaptcha(
  config: AppConfig,
  body: Record<string, unknown>,
  req: IncomingMessage
): Promise<void> {
  const ok = await verifyCaptcha(config, body.captchaToken, req.socket.remoteAddress);
  if (!ok) {
    throw Object.assign(new Error("captcha_failed"), { statusCode: 400, code: "captcha_failed" });
  }
}

function issueSessionCookie(res: ServerResponse, config: AppConfig, identityId: string, email: string): void {
  const token = issueIdentitySession(sessionSecret(config), identityId, email);
  setIdentityCookie(res, token, cookieSecure(config));
}

function createWalletForIdentity(
  db: CommerceDb,
  config: AppConfig,
  identityId: string,
  ownerQx: string,
  ownerQy: string,
  credentialId: string | null,
  label?: string | null
) {
  const factory = config.identity.walletFactoryAddress ?? config.wallet.factoryAddress;
  const impl = config.identity.walletImplementation ?? config.wallet.implementationAddress;
  if (!factory || !impl) {
    throw Object.assign(new Error("wallet_factory_not_configured"), { statusCode: 503 });
  }
  const index = db.listWalletAccountsByIdentityId(identityId).length;
  const salt = deriveIdentityWalletSalt(identityId, index);
  const address = predictWalletAddress(factory, impl, salt);
  const name = label?.trim() || (index === 0 ? "Wallet" : `Wallet ${index + 1}`);
  const account = db.upsertWalletAccount({
    address,
    salt,
    ownerQx,
    ownerQy,
    credentialId,
    webauthnAttestation: null,
    identityId,
    label: name,
  });
  const identity = db.getIdentityById(identityId);
  if (identity?.email.includes("@")) {
    db.upsertWalletEmail({
      walletAddress: account.address,
      email: identity.email,
      verifiedAt: new Date().toISOString(),
    });
  }
  return account;
}

export function registerIdentityRoutes(
  db: CommerceDb,
  config: AppConfig,
  handlers: Handlers
): (req: IncomingMessage, res: ServerResponse, url: URL) => Promise<boolean> {
  return async (req, res, url) => {
    if (!url.pathname.startsWith("/api/identity")) return false;

    try {
      if (req.method === "POST" && url.pathname === "/api/identity/email/lookup") {
        const body = await handlers.readJson(req);
        const email = str(body.email)?.toLowerCase();
        if (!email?.includes("@")) {
          handlers.sendJson(res, 200, { exists: false });
          return true;
        }
        const identity = db.getIdentityByEmail(email);
        if (!identity) {
          handlers.sendJson(res, 200, { exists: false });
          return true;
        }
        const counts = methodCounts(db, identity.identityId);
        const identityExists = counts.webauthn + counts.yubikey + counts.eoa > 0;
        const restoreEnabled = await readIdentityRestoreEnabled(config.identity, identity.identityId);
        handlers.sendJson(res, 200, {
          exists: identityExists,
          ...(identityExists ? { identityId: identity.identityId } : {}),
          restoreEnabled,
          options: loginOptionsAfterFailedGet({
            identityExists,
            webauthnCount: counts.webauthn,
            yubikeyCount: counts.yubikey,
            eoaCount: counts.eoa,
          }),
        });
        return true;
      }

      if (req.method === "POST" && url.pathname === "/api/identity/email/start") {
        const body = await handlers.readJson(req);
        await requireCaptcha(config, body, req);
        const email = str(body.email)?.toLowerCase();
        if (!email?.includes("@")) {
          handlers.sendJson(res, 200, { ok: true });
          return true;
        }
        const existing = db.getIdentityByEmail(email);
        if (existing) {
          const counts = methodCounts(db, existing.identityId);
          if (counts.webauthn + counts.yubikey + counts.eoa > 0) {
            handlers.sendJson(res, 200, { ok: true, exists: true, email: maskEmail(email) });
            return true;
          }
        }
        const code = generateOtpCode();
        db.createWalletEmailOtp({
          walletAddress: identityOtpWallet(email),
          email,
          purpose: "login",
          codeHash: hashOtpCode(code),
        });
        try {
          await sendOtpEmail(config.email, {
            to: email,
            code,
            purpose: "login",
            logCode: config.identity.devOtp,
          });
        } catch (err) {
          console.error("[identity] OTP email failed", err);
        }
        handlers.sendJson(res, 200, { ok: true, email: maskEmail(email) });
        return true;
      }

      if (req.method === "GET" && url.pathname === "/api/identity/email/dev-otp") {
        if (!config.identity.devOtp) {
          handlers.sendJson(res, 404, { error: "not_found" });
          return true;
        }
        const last = getLastDevOtp();
        handlers.sendJson(res, 200, last ?? { to: null, code: null, purpose: null });
        return true;
      }

      if (req.method === "POST" && url.pathname === "/api/identity/email/verify") {
        const body = await handlers.readJson(req);
        const email = str(body.email)?.toLowerCase();
        const code = str(body.code);
        if (!email?.includes("@") || !code) {
          handlers.sendJson(res, 400, { error: "email_and_code_required" });
          return true;
        }
        const ok = db.consumeWalletEmailOtp({
          walletAddress: identityOtpWallet(email),
          email,
          purpose: "login",
          codeHash: hashOtpCode(code),
        });
        if (!ok) {
          handlers.sendJson(res, 400, { error: "invalid_otp" });
          return true;
        }
        const identity = db.getOrCreateIdentityByEmail(email);
        issueSessionCookie(res, config, identity.identityId, identity.email);
        handlers.sendJson(res, 200, { ok: true, ...mePayload(db, identity.identityId, identity.email) });
        return true;
      }

      if (req.method === "GET" && url.pathname === "/api/identity/google/start") {
        if (
          !config.identity.googleClientId ||
          !config.identity.googleClientSecret ||
          !config.identity.googleRedirectUri
        ) {
          res.writeHead(302, { location: "/wallet?google=unavailable" });
          res.end();
          return true;
        }
        const state = issueOAuthState(sessionSecret(config));
        setOAuthStateCookie(res, state, cookieSecure(config));
        const loc = googleAuthUrl(config.identity, state);
        res.writeHead(302, { location: loc });
        res.end();
        return true;
      }

      if (req.method === "GET" && url.pathname === "/api/identity/google/callback") {
        const code = url.searchParams.get("code") ?? "";
        const state = url.searchParams.get("state") ?? "";
        const cookies = parseCookieHeader(req.headers.cookie);
        const cookieState = cookies[GOOGLE_OAUTH_COOKIE_NAME] ?? "";
        if (!code || !state || cookieState !== state || !verifyOAuthState(sessionSecret(config), state)) {
          handlers.sendJson(res, 400, { error: "invalid_oauth_state" });
          return true;
        }
        clearOAuthStateCookie(res, cookieSecure(config));
        const { id_token } = await exchangeGoogleCode(config.identity, code);
        const claims = parseGoogleIdToken(id_token, config.identity.skipIdTokenVerify);
        const existingBySub = db.getIdentityByGoogleSub(claims.sub);
        const existingByEmail = db.getIdentityByEmail(claims.email);
        if (existingBySub && existingByEmail && existingBySub.identityId !== existingByEmail.identityId) {
          handlers.sendJson(res, 409, { error: "identity_conflict" });
          return true;
        }
        const identity =
          existingBySub ??
          existingByEmail ??
          db.getOrCreateIdentityByEmail(claims.email, claims.sub);
        if (!identity.googleSub) {
          db.setIdentityGoogleSub(identity.identityId, claims.sub);
        }
        issueSessionCookie(res, config, identity.identityId, identity.email);
        const dest = config.identity.successRedirect;
        res.writeHead(302, { location: dest });
        res.end();
        return true;
      }

      if (req.method === "GET" && url.pathname === "/api/identity/me") {
        const session = requireSession(req, config);
        const identity = db.getIdentityById(session.identityId);
        if (!identity) {
          handlers.sendJson(res, 401, { error: "unauthorized" });
          return true;
        }
        handlers.sendJson(res, 200, await mePayloadWithRestore(db, config, identity.identityId, identity.email));
        return true;
      }

      if (req.method === "POST" && url.pathname === "/api/identity/logout") {
        clearIdentityCookie(res, cookieSecure(config));
        handlers.sendJson(res, 200, { ok: true });
        return true;
      }

      if (req.method === "GET" && url.pathname === "/api/identity/recover/challenge") {
        handlers.sendJson(res, 200, { challenge: issueRecoverChallenge(req) });
        return true;
      }

      if (req.method === "GET" && url.pathname === "/api/identity/recover/security-keys") {
        handlers.sendJson(res, 200, { credentialIds: db.listYubikeyCredentialIds() });
        return true;
      }

      if (req.method === "POST" && url.pathname === "/api/identity/recover/prove") {
        const body = await handlers.readJson(req);
        const kindRaw = str(body.kind);
        const kind: "yubikey" | "eoa" | null = kindRaw === "yubikey" || kindRaw === "eoa" ? kindRaw : null;
        if (!kind) {
          handlers.sendJson(res, 400, { error: "kind_required" });
          return true;
        }
        let method = null as ReturnType<CommerceDb["getIdentityMethodByCredentialId"]>;
        if (kind === "yubikey") {
          const credentialId = str(body.credentialId);
          if (!credentialId) {
            handlers.sendJson(res, 400, { error: "credentialId required" });
            return true;
          }
          method = db.getIdentityMethodByCredentialId(credentialId);
          if (!method || method.kind !== "yubikey") {
            handlers.sendJson(res, 404, { error: "identity_not_found" });
            return true;
          }
        } else {
          const challenge = str(body.challenge);
          const signature = str(body.signature);
          const eoaRaw = str(body.eoa) ?? str(body.address);
          if (!challenge || !signature || !eoaRaw || !isAddress(eoaRaw)) {
            handlers.sendJson(res, 400, { error: "eoa_challenge_signature_required" });
            return true;
          }
          if (!consumeRecoverChallenge(req, challenge)) {
            handlers.sendJson(res, 400, { error: "invalid_or_expired_challenge" });
            return true;
          }
          const store = config.identity.storeAddress ?? config.wallet.storeAddress;
          const chainId = BigInt(config.wallet.chainId || "0");
          if (!store || !chainId) {
            handlers.sendJson(res, 503, { error: "identity_store_unavailable" });
            return true;
          }
          let recovered: string;
          try {
            recovered = getAddress(
              verifyTypedData(
                identityEip712Domain(store, chainId),
                IDENTITY_VERIFY_TYPES,
                { message: challenge },
                signature
              )
            );
          } catch {
            handlers.sendJson(res, 400, { error: "invalid_signature" });
            return true;
          }
          if (recovered.toLowerCase() !== getAddress(eoaRaw).toLowerCase()) {
            handlers.sendJson(res, 400, { error: "invalid_signature" });
            return true;
          }
          method = db.getIdentityMethodByEoa(recovered);
          if (!method || method.kind !== "eoa") {
            handlers.sendJson(res, 404, { error: "identity_not_found" });
            return true;
          }
        }
        const identity = db.getIdentityById(method.identityId);
        if (!identity) {
          handlers.sendJson(res, 404, { error: "identity_not_found" });
          return true;
        }
        const restoreEnabled = await readIdentityRestoreEnabled(config.identity, identity.identityId);
        const wallets = db.listWalletAccountsByIdentityId(identity.identityId).map((w) => ({
          address: w.address,
          salt: w.salt,
          label: w.label,
        }));
        const token = issueIdentityRecoverSession(sessionSecret(config), {
          identityId: identity.identityId,
          email: identity.email,
          kind,
          methodId: method.id,
          credentialId: method.credentialId ?? undefined,
          qx: method.qx ?? undefined,
          qy: method.qy ?? undefined,
          eoa: method.eoa ?? undefined,
        });
        setIdentityRecoverCookie(res, token, cookieSecure(config));
        handlers.sendJson(res, 200, {
          email: identity.email,
          identityId: identity.identityId,
          restoreEnabled,
          methods: methodCounts(db, identity.identityId),
          wallets,
          provingMethod: {
            kind: method.kind,
            credentialId: method.credentialId,
            qx: method.qx,
            qy: method.qy,
            eoa: method.eoa,
          },
        });
        return true;
      }

      if (req.method === "GET" && url.pathname === "/api/identity/recover/session") {
        const recover = requireRecoverSession(req, config);
        const identity = db.getIdentityById(recover.identityId);
        if (!identity) {
          handlers.sendJson(res, 401, { error: "unauthorized" });
          return true;
        }
        const restoreEnabled = await readIdentityRestoreEnabled(config.identity, identity.identityId);
        handlers.sendJson(res, 200, {
          email: identity.email,
          identityId: identity.identityId,
          restoreEnabled,
          methods: methodCounts(db, identity.identityId),
          wallets: db.listWalletAccountsByIdentityId(identity.identityId).map((w) => ({
            address: w.address,
            salt: w.salt,
            label: w.label,
          })),
          provingMethod: {
            kind: recover.kind,
            credentialId: recover.credentialId ?? null,
            qx: recover.qx ?? null,
            qy: recover.qy ?? null,
            eoa: recover.eoa ?? null,
          },
        });
        return true;
      }

      if (req.method === "POST" && url.pathname === "/api/identity/recover/add-method") {
        const recover = requireRecoverSession(req, config);
        const body = await handlers.readJson(req);
        const pay = str(body.pay) ?? "relayer";
        const qx = normalizeQxQy(body.qx ?? body.ownerQx);
        const qy = normalizeQxQy(body.qy ?? body.ownerQy);
        const credentialId = str(body.credentialId);
        const kindRaw = str(body.kind) ?? "webauthn";
        const kind: IdentityMethodKind =
          kindRaw === "yubikey" || kindRaw === "eoa" ? kindRaw : "webauthn";
        if (!qx || !qy || !credentialId) {
          handlers.sendJson(res, 400, { error: "qx_qy_credentialId_required" });
          return true;
        }
        const authorization = str(body.authorization);
        const methodId = computeIdentityMethodId(recover.identityId, kindToNum(kind), qx, qy, ZeroAddress);
        if (pay === "relayer") {
          try {
            await requireCaptcha(config, body, req);
          } catch (e) {
            handlers.sendJson(res, 400, { error: "captcha_failed", message: e instanceof Error ? e.message : String(e) });
            return true;
          }
          const limited = takeToken(`identity-recover-relay:${recover.identityId}`, 1 / 120, 1);
          if (!limited.ok) {
            handlers.sendJson(res, 429, { error: "rate_limited" });
            return true;
          }
          if (config.identity.storeAddress && config.identity.rpcUrl) {
            if (!authorization) {
              handlers.sendJson(res, 400, { error: "authorization_required" });
              return true;
            }
            try {
              await addIdentityMethodOnChain(config.identity, {
                identityId: recover.identityId,
                kind: kindToNum(kind),
                qx,
                qy,
                eoa: ZeroAddress,
                authorization,
              });
            } catch (e) {
              handlers.sendJson(res, 502, {
                error: "add_method_failed",
                message: e instanceof Error ? e.message : String(e),
              });
              return true;
            }
          }
        } else if (pay === "recorded") {
          const exists = await identityMethodExistsOnChain(config.identity, methodId);
          if (!exists) {
            handlers.sendJson(res, 400, { error: "method_not_on_chain" });
            return true;
          }
        } else {
          handlers.sendJson(res, 400, { error: "pay_invalid" });
          return true;
        }
        const method = db.insertIdentityMethod({
          id: methodId,
          identityId: recover.identityId,
          kind,
          credentialId,
          qx,
          qy,
          eoa: null,
        });
        handlers.sendJson(res, 201, { method, identityId: recover.identityId, email: recover.email });
        return true;
      }

      if (req.method === "POST" && url.pathname === "/api/identity/passkey/register") {
        const session = requireSession(req, config);
        const body = await handlers.readJson(req);
        const qx = normalizeQxQy(body.qx ?? body.ownerQx);
        const qy = normalizeQxQy(body.qy ?? body.ownerQy);
        const credentialId = str(body.credentialId);
        if (!qx || !qy || !credentialId) {
          handlers.sendJson(res, 400, { error: "qx_qy_credentialId_required" });
          return true;
        }
        const counts = methodCounts(db, session.identityId);
        if (counts.webauthn > 0) {
          handlers.sendJson(res, 409, { error: "identity_exists", hint: "pair" });
          return true;
        }
        const identity = db.getIdentityById(session.identityId);
        if (!identity) {
          handlers.sendJson(res, 401, { error: "unauthorized" });
          return true;
        }
        const methodId = computeIdentityMethodId(identity.identityId, METHOD_WEBAUTHN, qx, qy, ZeroAddress);
        db.insertIdentityMethod({
          id: methodId,
          identityId: identity.identityId,
          kind: "webauthn",
          credentialId,
          qx,
          qy,
          eoa: null,
        });
        const attestation = body.webauthnAttestation != null ? JSON.stringify(body.webauthnAttestation) : null;
        try {
          await registerIdentityOnChain(config.identity, identity.identityId, qx, qy);
        } catch (e) {
          handlers.sendJson(res, 502, {
            error: "identity_register_failed",
            message: e instanceof Error ? e.message : String(e),
          });
          return true;
        }
        let wallets = db.listWalletAccountsByIdentityId(identity.identityId);
        if (wallets.length === 0) {
          const account = createWalletForIdentity(db, config, identity.identityId, qx, qy, credentialId);
          if (attestation) {
            db.upsertWalletAccount({
              address: account.address,
              salt: account.salt,
              ownerQx: qx,
              ownerQy: qy,
              credentialId,
              webauthnAttestation: attestation,
              identityId: identity.identityId,
            });
          }
          wallets = db.listWalletAccountsByIdentityId(identity.identityId);
        }
        handlers.sendJson(res, 201, {
          ok: true,
          wallets,
          ...mePayload(db, identity.identityId, identity.email, true),
        });
        return true;
      }

      if (
        (req.method === "GET" || req.method === "POST") &&
        url.pathname === "/api/identity/pair/ready"
      ) {
        const body = req.method === "POST" ? await handlers.readJson(req) : {};
        const credentialId = str(body.credentialId) ?? str(url.searchParams.get("credentialId"));
        const qx = normalizeQxQy(body.qx ?? url.searchParams.get("qx"));
        const qy = normalizeQxQy(body.qy ?? url.searchParams.get("qy"));
        if (!credentialId && !(qx && qy)) {
          handlers.sendJson(res, 400, { error: "credentialId_or_qx_qy_required" });
          return true;
        }
        const ready = Boolean(
          (credentialId && db.getIdentityMethodByCredentialId(credentialId)) ||
            (qx && qy && db.getIdentityMethodByPublicKey(qx, qy))
        );
        handlers.sendJson(res, 200, { ready });
        return true;
      }

      if (req.method === "POST" && url.pathname === "/api/identity/passkey/login") {
        const body = await handlers.readJson(req);
        const credentialId = str(body.credentialId);
        const qx = normalizeQxQy(body.qx);
        const qy = normalizeQxQy(body.qy);
        if (!credentialId && !(qx && qy)) {
          handlers.sendJson(res, 400, { error: "credentialId required" });
          return true;
        }
        const method =
          (credentialId ? db.getIdentityMethodByCredentialId(credentialId) : null) ??
          (qx && qy ? db.getIdentityMethodByPublicKey(qx, qy) : null);
        if (!method) {
          handlers.sendJson(res, 404, { error: "identity_not_found" });
          return true;
        }
        const identity = db.getIdentityById(method.identityId);
        if (!identity) {
          handlers.sendJson(res, 404, { error: "identity_not_found" });
          return true;
        }
        const wallets = db.listWalletAccountsByIdentityId(method.identityId);
        issueSessionCookie(res, config, identity.identityId, identity.email);
        handlers.sendJson(res, 200, {
          identityId: method.identityId,
          email: identity.email,
          method: { kind: method.kind, credentialId: method.credentialId, qx: method.qx, qy: method.qy },
          wallets,
        });
        return true;
      }

      if (req.method === "GET" && url.pathname === "/api/identity/wallets") {
        const session = requireSession(req, config);
        const wallets = db.listWalletAccountsByIdentityId(session.identityId);
        handlers.sendJson(res, 200, { wallets, identityId: session.identityId });
        return true;
      }

      if (req.method === "POST" && url.pathname === "/api/identity/wallets") {
        const body = await handlers.readJson(req);
        let session = readIdentitySessionFromRequest(sessionSecret(config), req);
        if (!session) {
          const credentialId = str(body.credentialId);
          const identity = credentialId ? identityFromCredentialId(db, credentialId) : null;
          if (!identity) {
            handlers.sendJson(res, 401, { error: "unauthorized" });
            return true;
          }
          issueSessionCookie(res, config, identity.identityId, identity.email);
          session = { identityId: identity.identityId, email: identity.email, exp: 0 };
        }
        const counts = methodCounts(db, session.identityId);
        if (counts.webauthn < 1) {
          handlers.sendJson(res, 400, { error: "passkey_required" });
          return true;
        }
        const methods = db.listIdentityMethods(session.identityId);
        const passkey = methods.find((m) => m.kind === "webauthn" && m.qx && m.qy);
        if (!passkey?.qx || !passkey.qy) {
          handlers.sendJson(res, 400, { error: "passkey_required" });
          return true;
        }
        const account = createWalletForIdentity(
          db,
          config,
          session.identityId,
          passkey.qx,
          passkey.qy,
          passkey.credentialId,
          str(body.label)
        );
        handlers.sendJson(res, 201, { account });
        return true;
      }

      if (req.method === "PATCH" && url.pathname === "/api/identity/wallets") {
        const body = await handlers.readJson(req);
        let session = readIdentitySessionFromRequest(sessionSecret(config), req);
        if (!session) {
          const credentialId = str(body.credentialId);
          const identity = credentialId ? identityFromCredentialId(db, credentialId) : null;
          if (!identity) {
            handlers.sendJson(res, 401, { error: "unauthorized" });
            return true;
          }
          issueSessionCookie(res, config, identity.identityId, identity.email);
          session = { identityId: identity.identityId, email: identity.email, exp: 0 };
        }
        const address = str(body.address);
        const label = str(body.label);
        if (!address || !label) {
          handlers.sendJson(res, 400, { error: "address_and_label_required" });
          return true;
        }
        const account = db.getWalletAccount(address);
        if (!account || account.identityId !== session.identityId) {
          handlers.sendJson(res, 404, { error: "wallet_not_found" });
          return true;
        }
        const updated = db.setWalletAccountLabel(address, label);
        handlers.sendJson(res, 200, { account: updated });
        return true;
      }

      if (req.method === "POST" && url.pathname === "/api/identity/methods") {
        const body = await handlers.readJson(req);
        let session = readIdentitySessionFromRequest(sessionSecret(config), req);
        if (!session) {
          const proving = str(body.provingCredentialId);
          const identity = proving ? identityFromCredentialId(db, proving) : null;
          if (!identity) {
            handlers.sendJson(res, 401, { error: "unauthorized" });
            return true;
          }
          issueSessionCookie(res, config, identity.identityId, identity.email);
          session = { identityId: identity.identityId, email: identity.email, exp: 0 };
        }
        const kindRaw = str(body.kind) ?? "webauthn";
        const kind: IdentityMethodKind =
          kindRaw === "yubikey" || kindRaw === "eoa" ? kindRaw : "webauthn";
        const qx = normalizeQxQy(body.qx ?? body.ownerQx) ?? `0x${"00".repeat(32)}`;
        const qy = normalizeQxQy(body.qy ?? body.ownerQy) ?? `0x${"00".repeat(32)}`;
        const eoa = str(body.eoa) ?? ZeroAddress;
        const credentialId = str(body.credentialId) ?? null;
        const authorization = str(body.authorization);
        const pay = str(body.pay);
        const counts = methodCounts(db, session.identityId);
        if (counts.webauthn + counts.yubikey + counts.eoa < 1) {
          handlers.sendJson(res, 400, { error: "register_passkey_first" });
          return true;
        }
        const methodId = computeIdentityMethodId(session.identityId, kindToNum(kind), qx, qy, eoa);
        if (pay === "recorded") {
          const exists = await identityMethodExistsOnChain(config.identity, methodId);
          if (!exists) {
            handlers.sendJson(res, 400, { error: "method_not_on_chain" });
            return true;
          }
        } else if (pay === "pending") {
          /* Wallet cannot pay yet — index the method until it is recorded on-chain. */
        } else {
          if (config.identity.storeAddress && config.identity.rpcUrl && !authorization) {
            handlers.sendJson(res, 400, { error: "authorization_required" });
            return true;
          }
          if (authorization) {
            try {
              await addIdentityMethodOnChain(config.identity, {
                identityId: session.identityId,
                kind: kindToNum(kind),
                qx,
                qy,
                eoa,
                authorization,
              });
            } catch (e) {
              handlers.sendJson(res, 502, {
                error: "add_method_failed",
                message: e instanceof Error ? e.message : String(e),
              });
              return true;
            }
          }
        }
        const method = db.insertIdentityMethod({
          id: methodId,
          identityId: session.identityId,
          kind,
          credentialId,
          qx: kind === "eoa" ? null : qx,
          qy: kind === "eoa" ? null : qy,
          eoa: kind === "eoa" ? eoa : null,
        });
        handlers.sendJson(res, 201, { method });
        return true;
      }

      if (req.method === "DELETE" && url.pathname === "/api/identity/methods") {
        const session = requireSession(req, config);
        const body = await handlers.readJson(req);
        const methodId = str(body.methodId);
        const credentialId = str(body.credentialId);
        const qx = normalizeQxQy(body.qx ?? body.ownerQx);
        const qy = normalizeQxQy(body.qy ?? body.ownerQy);
        const owned = db.listIdentityMethods(session.identityId);
        let method = methodId
          ? owned.find((m) => m.id.toLowerCase() === methodId.toLowerCase())
          : undefined;
        if (!method && credentialId) {
          const byCred = db.getIdentityMethodByCredentialId(credentialId);
          if (byCred && byCred.identityId === session.identityId) method = byCred;
        }
        if (!method && qx && qy) {
          method = owned.find(
            (m) =>
              m.qx &&
              m.qy &&
              m.qx.toLowerCase() === qx.toLowerCase() &&
              m.qy.toLowerCase() === qy.toLowerCase()
          );
        }
        if (!method) {
          handlers.sendJson(res, 404, { error: "method_not_found" });
          return true;
        }
        const remaining = db.listIdentityMethods(session.identityId).filter((m) => m.id !== method.id);
        if (remaining.length < 1) {
          handlers.sendJson(res, 400, { error: "last_method" });
          return true;
        }
        const authorization = str(body.authorization);
        if (config.identity.storeAddress && config.identity.rpcUrl) {
          const onChain = await identityMethodExistsOnChain(config.identity, method.id);
          if (onChain) {
            if (!authorization) {
              handlers.sendJson(res, 400, { error: "authorization_required" });
              return true;
            }
            try {
              const removed = await removeIdentityMethodOnChain(config.identity, {
                identityId: session.identityId,
                methodId: method.id,
                authorization,
              });
              if (!removed) {
                handlers.sendJson(res, 400, { error: "remove_need_funds" });
                return true;
              }
            } catch (e) {
              const message = e instanceof Error ? e.message : String(e);
              if (/LastMethod/i.test(message)) {
                handlers.sendJson(res, 400, { error: "last_method" });
                return true;
              }
              if (/InvalidSignature|0x8baa579f/i.test(message)) {
                handlers.sendJson(res, 400, { error: "invalid_signature" });
                return true;
              }
              handlers.sendJson(res, 502, {
                error: "remove_method_failed",
                message,
              });
              return true;
            }
          }
        }
        db.deleteIdentityMethod(method.id);
        handlers.sendJson(res, 200, { ok: true, id: method.id });
        return true;
      }

      if (req.method === "POST" && url.pathname === "/api/identity/restore") {
        const session = requireSession(req, config);
        const body = await handlers.readJson(req);
        const qx = normalizeQxQy(body.qx ?? body.ownerQx);
        const qy = normalizeQxQy(body.qy ?? body.ownerQy);
        const credentialId = str(body.credentialId);
        const kindRaw = str(body.kind) ?? "webauthn";
        const kind: IdentityMethodKind =
          kindRaw === "yubikey" || kindRaw === "eoa" ? kindRaw : "webauthn";
        if (!qx || !qy) {
          handlers.sendJson(res, 400, { error: "qx_qy_required" });
          return true;
        }
        try {
          await restoreIdentityMethodOnChain(config.identity, {
            identityId: session.identityId,
            kind: kindToNum(kind),
            qx,
            qy,
          });
        } catch (e) {
          handlers.sendJson(res, 502, {
            error: "restore_failed",
            message: e instanceof Error ? e.message : String(e),
          });
          return true;
        }
        const methodId = computeIdentityMethodId(
          session.identityId,
          kindToNum(kind),
          qx,
          qy,
          ZeroAddress
        );
        const method = db.insertIdentityMethod({
          id: methodId,
          identityId: session.identityId,
          kind,
          credentialId: credentialId ?? null,
          qx,
          qy,
          eoa: null,
        });
        handlers.sendJson(res, 200, { ok: true, method });
        return true;
      }
    } catch (e) {
      const status =
        typeof e === "object" && e && "statusCode" in e && typeof (e as { statusCode: number }).statusCode === "number"
          ? (e as { statusCode: number }).statusCode
          : 500;
      const code =
        typeof e === "object" && e && "code" in e && typeof (e as { code: string }).code === "string"
          ? (e as { code: string }).code
          : undefined;
      handlers.sendJson(res, status, {
        error: code ?? (e instanceof Error ? e.message : "error"),
        message: e instanceof Error ? e.message : String(e),
      });
      return true;
    }

    handlers.sendJson(res, 404, { error: "not_found" });
    return true;
  };
}

export { numToKind };
