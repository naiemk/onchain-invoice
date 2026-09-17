import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { EmailOtpFields } from "./EmailOtpFields";
import { readCaptchaToken, TurnstileWidget, type TurnstileControl } from "@/components/TurnstileWidget";
import { useLocale } from "@/providers/LocaleProvider";
import { fetchWalletConfig, registerDevice } from "@/shared/wallet-api.js";
import {
  lookupIdentityEmail,
  fetchIdentityDevOtp,
  fetchIdentityMe,
  googleIdentityStartUrl,
  loginIdentityPasskey,
  logoutIdentity,
  parseIdentityIdParam,
  registerIdentityPasskey,
  startIdentityEmail,
  verifyIdentityEmail,
} from "@/shared/identity-api.js";
import type { IdentityMeResponse } from "../../../../../commerce/shared/identity.js";
import {
  authenticatePasskey,
  createPasskey,
  formatPasskeyError,
  abortPendingWebAuthn,
  clearPendingPasskey,
  clearSkipWebAuthnPrompt,
  markSkipWebAuthnPrompt,
  saveWalletSession,
  shouldSkipWebAuthnPrompt,
  webAuthnSupported,
} from "@/shared/webauthn.js";
import { inferDeviceLabel } from "@/shared/passkey-name.js";
import { resolveWalletLabel } from "@/shared/wallet-label.js";
import { clearAllWalletLocalState, listWalletRegistry } from "@/shared/wallet-session.js";
import { WalletFrame } from "./WalletFrame";

type AuthMode = "signup" | "login";
type AuthStep = "email" | "captcha" | "code" | "legal" | "biometric";

function GoogleMark() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden>
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
      />
    </svg>
  );
}

function AuthTitle({ children }: { children: ReactNode }) {
  return <h1 className="text-center text-xl font-semibold tracking-tight">{children}</h1>;
}

function EmailOnFile({
  email,
  disabled,
  onChangeEmail,
}: {
  email: string;
  disabled: boolean;
  onChangeEmail: () => void;
}) {
  const { t } = useLocale();
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <p className="min-w-0 truncate font-medium">{email}</p>
      <Button type="button" variant="ghost" size="sm" disabled={disabled} onClick={onChangeEmail}>
        {t("wallet.authChangeEmail")}
      </Button>
    </div>
  );
}

function LegalLinks({ className }: { className?: string }) {
  const { t } = useLocale();
  return (
    <p className={className}>
      {t("wallet.authAgreePrefix")}{" "}
      <Link to="/terms" className="underline underline-offset-2">
        {t("wallet.authTermsOfUse")}
      </Link>{" "}
      {t("wallet.authAgreeAnd")}{" "}
      <Link to="/privacy" className="underline underline-offset-2">
        {t("wallet.authPrivacyPolicy")}
      </Link>
      .
    </p>
  );
}

function AuthEmailCard({
  mode,
  email,
  onEmailChange,
  googleEnabled,
  busy,
  onNext,
  onToggleMode,
}: {
  mode: AuthMode;
  email: string;
  onEmailChange: (value: string) => void;
  googleEnabled: boolean;
  busy: boolean;
  onNext: () => void;
  onToggleMode: () => void;
}) {
  const { t } = useLocale();
  const submit = (event: FormEvent) => {
    event.preventDefault();
    onNext();
  };
  return (
    <form className="mx-auto max-w-sm space-y-5" onSubmit={submit} data-testid="wallet-auth-card">
      <AuthTitle>{t("wallet.authWelcome")}</AuthTitle>
      <div className="space-y-2">
        <Label htmlFor="identity-email">{t("wallet.connectEmail")}</Label>
        <Input
          id="identity-email"
          type="email"
          autoComplete="username webauthn"
          placeholder="you@company.com"
          value={email}
          onChange={(e) => onEmailChange(e.target.value)}
        />
      </div>
      <Button type="submit" className="w-full" disabled={busy}>
        {t("wallet.authNext")}
      </Button>
      <p className="text-center text-sm text-muted-foreground">
        {mode === "signup" ? t("wallet.authHaveAccount") : t("wallet.authNoAccount")}{" "}
        <button
          type="button"
          className="font-medium text-foreground underline underline-offset-2"
          onClick={onToggleMode}
        >
          {mode === "signup" ? t("wallet.authLogIn") : t("wallet.authSignUp")}
        </button>
      </p>
      {googleEnabled ? (
        <>
          <div className="relative py-1">
            <div className="absolute inset-0 flex items-center" aria-hidden>
              <div className="w-full border-t" />
            </div>
            <div className="relative flex justify-center text-xs uppercase tracking-wide text-muted-foreground">
              <span className="bg-card px-2">{t("wallet.authOthers")}</span>
            </div>
          </div>
          <Button type="button" variant="outline" className="w-full gap-2" asChild>
            <a href={googleIdentityStartUrl()}>
              <GoogleMark />
              {t("wallet.authGoogle")}
            </a>
          </Button>
        </>
      ) : null}
      {mode === "signup" ? <LegalLinks className="text-center text-xs text-muted-foreground" /> : null}
    </form>
  );
}

export function WalletAuthCard({ onOpened }: { onOpened: () => void }) {
  const { t } = useLocale();
  const [searchParams, setSearchParams] = useSearchParams();
  const supported = webAuthnSupported();
  const captchaRef = useRef<TurnstileControl | null>(null);
  const [me, setMe] = useState<IdentityMeResponse | null>(null);
  const [mode, setMode] = useState<AuthMode>("signup");
  const [step, setStep] = useState<AuthStep>("email");
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [identityId, setIdentityId] = useState<string | undefined>(undefined);
  const [siteKey, setSiteKey] = useState<string | null>(null);
  const [googleEnabled, setGoogleEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [agreedTerms, setAgreedTerms] = useState(false);
  const [agreedPrivacy, setAgreedPrivacy] = useState(false);

  const bootstrapRef = useRef(false);

  useEffect(() => {
    void fetchWalletConfig()
      .then((cfg) => {
        setSiteKey(cfg.turnstileSiteKey ?? null);
        setGoogleEnabled(Boolean(cfg.googleAuthEnabled));
      })
      .catch(() => {
        setSiteKey(null);
        setGoogleEnabled(false);
      });
  }, []);

  useEffect(() => {
    if (searchParams.get("google") !== "unavailable") return;
    setStatus(t("wallet.googleUnavailable"));
    const next = new URLSearchParams(searchParams);
    next.delete("google");
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams, t]);

  useEffect(() => {
    if (!supported || step !== "email") return;
    if (shouldSkipWebAuthnPrompt()) return;
    let cancelled = false;
    void (async () => {
      try {
        const auth = await authenticatePasskey({ mediation: "conditional" });
        if (cancelled || !auth) return;
        await openFromPasskey(auth.credentialId, auth.rawId, auth.qx, auth.qy);
        onOpened();
      } catch {
        /* ignore conditional UI */
      }
    })();
    return () => {
      cancelled = true;
      void abortPendingWebAuthn();
    };
  }, [supported, step, onOpened]);

  const openFromPasskey = async (credentialId: string, rawId: string, qx: string, qy: string) => {
    const login = await loginIdentityPasskey(credentialId);
    const config = await fetchWalletConfig();
    const deviceLabel = inferDeviceLabel();
    const registry = listWalletRegistry();
    const first = login.wallets[0];
    if (!first) throw new Error(t("wallet.unlockNotFound"));
    for (const [index, w] of login.wallets.entries()) {
      const existing = registry.find((row) => row.address.toLowerCase() === w.address.toLowerCase());
      const label = resolveWalletLabel({
        saved: existing?.label,
        server: w.label,
        index,
        fallback: t("wallet.defaultWalletName"),
      });
      saveWalletSession({
        address: w.address,
        chainId: config.chainId,
        salt: w.salt,
        qx: qx || w.ownerQx,
        qy: qy || w.ownerQy,
        credentialId,
        rawId,
        label,
        identityId: login.identityId,
      });
    }
    const firstLabel = resolveWalletLabel({
      saved: registry.find((row) => row.address.toLowerCase() === first.address.toLowerCase())?.label,
      server: first.label,
      index: 0,
      fallback: t("wallet.defaultWalletName"),
    });
    saveWalletSession({
      address: first.address,
      chainId: config.chainId,
      salt: first.salt,
      qx: qx || first.ownerQx,
      qy: qy || first.ownerQy,
      credentialId,
      rawId,
      label: firstLabel,
      identityId: login.identityId,
    });
    await registerDevice({
      walletAddress: first.address,
      chainId: config.chainId,
      ownerQx: qx || first.ownerQx,
      ownerQy: qy || first.ownerQy,
      label: deviceLabel,
      credentialId,
    }).catch(() => undefined);
    clearPendingPasskey(credentialId);
  };

  const enrollPasskey = async (nextEmail: string) => {
    setBusy(true);
    setStatus(t("wallet.creatingPasskey"));
    try {
      const owner = await createPasskey(nextEmail, { purpose: "enroll", email: nextEmail });
      const registered = await registerIdentityPasskey({
        qx: owner.qx,
        qy: owner.qy,
        credentialId: owner.credentialId,
        webauthnAttestation: owner.attestation,
      });
      if (!registered.wallets.length) throw new Error(t("wallet.noFactory"));
      clearPendingPasskey(owner.credentialId);
      await openFromPasskey(owner.credentialId, owner.rawId, owner.qx, owner.qy);
      onOpened();
    } catch (error) {
      setStatus(formatPasskeyError(error));
    } finally {
      setBusy(false);
    }
  };

  const promptPasskey = async (nextIdentityId?: string) => {
    if (nextIdentityId) setIdentityId(nextIdentityId);
    setBusy(true);
    setStatus(t("wallet.sendSigning"));
    try {
      clearSkipWebAuthnPrompt();
      void abortPendingWebAuthn();
      const auth = await authenticatePasskey();
      if (auth) {
        await openFromPasskey(auth.credentialId, auth.rawId, auth.qx, auth.qy);
        onOpened();
        return;
      }
      setStep("biometric");
      setStatus(null);
    } catch {
      setStep("biometric");
      setStatus(null);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (bootstrapRef.current) return;
    bootstrapRef.current = true;
    if (shouldSkipWebAuthnPrompt()) return;
    void fetchIdentityMe().then((next) => {
      if (!next) return;
      setMe(next);
      setEmail(next.email);
      setIdentityId(next.identityId);
      if (next.identityExists) {
        void promptPasskey(next.identityId);
        return;
      }
      setStep("legal");
    });
  }, []);

  const sendOtp = async () => {
    const captchaToken = readCaptchaToken(captchaRef);
    if (siteKey && !captchaToken) {
      setStatus(t("wallet.recoverCaptchaRequired"));
      return false;
    }
    await startIdentityEmail(email, captchaToken);
    const last = await fetchIdentityDevOtp();
    const normalized = email.trim().toLowerCase();
    if (last?.code && last.to?.toLowerCase() === normalized) {
      setOtp(last.code);
      setStatus(t("wallet.devOtpFilled"));
    } else {
      setStatus(null);
    }
    setStep("code");
    return true;
  };

  const onNext = async () => {
    if (!email.includes("@")) {
      setStatus(t("wallet.recoverInvalidEmail"));
      return;
    }
    setBusy(true);
    setStatus(null);
    try {
      const found = await lookupIdentityEmail(email);
      if (!found.exists) {
        setIdentityId(undefined);
        if (siteKey) {
          setStep("captcha");
          return;
        }
        await sendOtp();
        return;
      }
      setIdentityId(parseIdentityIdParam(found.identityId) ?? found.identityId);
      await promptPasskey(found.identityId);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const onSendCode = async () => {
    setBusy(true);
    setStatus(null);
    try {
      await sendOtp();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const onVerifyCode = async () => {
    setBusy(true);
    setStatus(null);
    try {
      const next = await verifyIdentityEmail(email, otp.trim());
      setMe(next);
      setIdentityId(next.identityId);
      if (next.identityExists) {
        await promptPasskey(next.identityId);
        return;
      }
      setAgreedTerms(false);
      setAgreedPrivacy(false);
      setStep("legal");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const resetToEmail = () => {
    void (async () => {
      await abortPendingWebAuthn();
      markSkipWebAuthnPrompt();
      clearAllWalletLocalState();
      setMe(null);
      setIdentityId(undefined);
      setOtp("");
      setAgreedTerms(false);
      setAgreedPrivacy(false);
      setStatus(null);
      setStep("email");
      await logoutIdentity();
    })();
  };

  const pairHref = identityId
    ? `/wallet/pair?identityId=${encodeURIComponent(identityId)}${
        email.trim() ? `&email=${encodeURIComponent(email.trim())}` : ""
      }`
    : "/wallet/pair";

  return (
    <WalletFrame current="home" showChrome={false}>
      {step === "email" ? (
        <AuthEmailCard
          mode={mode}
          email={email}
          onEmailChange={setEmail}
          googleEnabled={googleEnabled}
          busy={busy}
          onNext={() => void onNext()}
          onToggleMode={() => setMode((prev) => (prev === "signup" ? "login" : "signup"))}
        />
      ) : step === "captcha" ? (
        <div className="mx-auto max-w-sm space-y-4">
          <AuthTitle>{t("wallet.authWelcome")}</AuthTitle>
          <EmailOnFile email={email} disabled={busy} onChangeEmail={resetToEmail} />
          <TurnstileWidget siteKey={siteKey} controlRef={captchaRef} />
          <Button type="button" className="w-full" disabled={busy} onClick={() => void onSendCode()}>
            {t("wallet.sendEmailCode")}
          </Button>
        </div>
      ) : step === "code" ? (
        <form
          className="mx-auto max-w-sm space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            void onVerifyCode();
          }}
        >
          <AuthTitle>{t("wallet.authOtpTitle")}</AuthTitle>
          <EmailOnFile email={email} disabled={busy} onChangeEmail={resetToEmail} />
          <EmailOtpFields
            step="code"
            email={email}
            onEmailChange={setEmail}
            otp={otp}
            onOtpChange={setOtp}
            siteKey={siteKey}
            captchaRef={captchaRef}
            showCaptcha={false}
          />
          <Button type="submit" className="w-full" disabled={busy}>
            {t("wallet.recoverVerifyOtp")}
          </Button>
        </form>
      ) : step === "legal" ? (
        <div className="mx-auto max-w-sm space-y-4">
          <AuthTitle>{t("wallet.authLegalTitle")}</AuthTitle>
          <EmailOnFile email={me?.email ?? email} disabled={busy} onChangeEmail={resetToEmail} />
          <div className="space-y-3">
            <label className="flex items-start gap-3 text-sm">
              <Checkbox
                id="auth-agree-terms"
                checked={agreedTerms}
                onCheckedChange={(value) => setAgreedTerms(value === true)}
              />
              <span>
                {t("wallet.authReadPrefix")}{" "}
                <Link to="/terms" className="underline underline-offset-2">
                  {t("wallet.authTermsOfUse")}
                </Link>
              </span>
            </label>
            <label className="flex items-start gap-3 text-sm">
              <Checkbox
                id="auth-agree-privacy"
                checked={agreedPrivacy}
                onCheckedChange={(value) => setAgreedPrivacy(value === true)}
              />
              <span>
                {t("wallet.authReadPrefix")}{" "}
                <Link to="/privacy" className="underline underline-offset-2">
                  {t("wallet.authPrivacyPolicy")}
                </Link>
              </span>
            </label>
          </div>
          <Button
            type="button"
            className="w-full"
            disabled={busy || !agreedTerms || !agreedPrivacy || !supported}
            onClick={() => void enrollPasskey(me?.email ?? email)}
          >
            {busy ? t("wallet.creatingPasskey") : t("wallet.authCreateFirstWallet")}
          </Button>
        </div>
      ) : (
        <div className="mx-auto max-w-sm space-y-4">
          <AuthTitle>{t("wallet.authBiometricFailed")}</AuthTitle>
          <EmailOnFile email={me?.email ?? email} disabled={busy} onChangeEmail={resetToEmail} />
          <Button type="button" className="w-full" disabled={!supported || busy} onClick={() => void promptPasskey(identityId)}>
            {t("wallet.authTryAgain")}
          </Button>
          <div className="space-y-2">
            <Button type="button" variant="outline" className="w-full" asChild>
              <Link to={pairHref}>{t("wallet.authPairAnotherDevice")}</Link>
            </Button>
            <p className="text-sm text-muted-foreground">{t("wallet.authPairExplain")}</p>
          </div>
          <p className="text-center text-sm">
            <Link to="/wallet/recover" className="underline underline-offset-2">
              {t("wallet.authLostAllDevices")}
            </Link>
          </p>
        </div>
      )}
      {status && <p className="mx-auto mt-4 max-w-sm text-sm text-destructive">{status}</p>}
    </WalletFrame>
  );
}
