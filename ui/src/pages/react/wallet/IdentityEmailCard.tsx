import { useCallback, useEffect, useRef, useState } from "react";
import { Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { TurnstileWidget, type TurnstileControl } from "@/components/TurnstileWidget";
import { useLocale } from "@/providers/LocaleProvider";
import {
  attachWalletEmail,
  createRecoveryChallenge,
  fetchWalletEmail,
  verifyWalletEmailOtp,
} from "@/shared/wallet-recovery-api.js";
import { fetchWalletConfig } from "@/shared/wallet-api.js";
import { listWalletEntities } from "@/shared/wallet-advanced-api.js";
import { loadWalletSession, type WalletSession } from "@/shared/wallet-session.js";
import { assertPasskeyChallenge } from "@/shared/webauthn.js";

export function IdentityEmailCard({
  session,
  advanced,
}: {
  session: WalletSession;
  advanced: boolean;
}) {
  const { t } = useLocale();
  const [status, setStatus] = useState<"loading" | "none" | "pending" | "verified">("loading");
  const [email, setEmail] = useState<string | null>(null);
  const [superLabel, setSuperLabel] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [otp, setOtp] = useState("");
  const [pendingEmail, setPendingEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [siteKey, setSiteKey] = useState<string | null>(null);
  const captchaRef = useRef<TurnstileControl | null>(null);

  const reload = useCallback(async () => {
    try {
      const result = await fetchWalletEmail(session.address);
      if (result.verified && result.email) {
        setStatus("verified");
        setEmail(result.email);
      } else if (result.hasEmail && result.email) {
        setStatus("pending");
        setEmail(result.email);
      } else {
        setStatus("none");
        setEmail(null);
      }
    } catch {
      setStatus("none");
    }
    if (advanced) {
      const roster = await listWalletEntities(session.address).catch(() => ({ entities: [] }));
      const mine = roster.entities.find((e) => e.entityId === session.entityId) ?? roster.entities[0];
      setSuperLabel(mine?.label ?? null);
    }
  }, [advanced, session.address, session.entityId]);

  useEffect(() => {
    void (async () => {
      const cfg = await fetchWalletConfig().catch(() => null);
      setSiteKey(cfg?.turnstileSiteKey ?? null);
      await reload();
    })();
  }, [reload]);

  const submitEmail = async () => {
    const live = loadWalletSession() ?? session;
    const next = draft.trim();
    if (!next.includes("@")) {
      setError(t("wallet.recoverInvalidEmail"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const captchaToken = captchaRef.current?.getToken() ?? null;
      if (siteKey && !captchaToken) {
        setError(t("wallet.recoverCaptchaRequired"));
        return;
      }
      const ch = await createRecoveryChallenge("attach", live.address);
      const { assertion } = await assertPasskeyChallenge({
        challengeBase64Url: ch.challenge,
        credentialId: live.credentialId,
      });
      await attachWalletEmail({
        walletAddress: live.address,
        email: next,
        challengeId: ch.challengeId,
        ownerQx: live.qx,
        ownerQy: live.qy,
        assertion,
        captchaToken,
      });
      setPendingEmail(next);
      setStatus("pending");
      setEmail(next);
      setEditing(false);
      captchaRef.current?.reset();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const verifyOtp = async () => {
    const live = loadWalletSession() ?? session;
    setBusy(true);
    setError(null);
    try {
      const captchaToken = captchaRef.current?.getToken() ?? null;
      if (siteKey && !captchaToken) {
        setError(t("wallet.recoverCaptchaRequired"));
        return;
      }
      await verifyWalletEmailOtp({
        walletAddress: live.address,
        email: pendingEmail || email || "",
        code: otp.trim(),
        captchaToken,
      });
      setOtp("");
      setPendingEmail("");
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  if (status === "loading") return null;

  if (advanced) {
    const shown = superLabel || email;
    return (
      <Alert className="mb-4" data-testid="identity-email-card">
        <Mail className="h-4 w-4" />
        <AlertDescription>
          <p className="font-medium">{t("wallet.identityEmailTitle")}</p>
          <p className="mt-1 text-sm">
            {shown ? t("wallet.recoverEmailVerified", { email: shown }) : t("wallet.identityEmailNone")}
          </p>
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <Alert className="mb-4" data-testid="identity-email-card">
      <Mail className="h-4 w-4" />
      <AlertDescription className="space-y-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="font-medium">{t("wallet.identityEmailTitle")}</p>
            {status === "verified" && email ? (
              <p className="mt-1 text-sm">{t("wallet.recoverEmailVerified", { email })}</p>
            ) : status === "pending" && email ? (
              <p className="mt-1 text-sm">{t("wallet.recoverEmailPending", { email })}</p>
            ) : (
              <p className="mt-1 text-sm text-muted-foreground">{t("wallet.emailAttachHint")}</p>
            )}
          </div>
          {status === "verified" && !editing ? (
            <Button type="button" size="sm" variant="secondary" onClick={() => setEditing(true)}>
              {t("wallet.identityChangeEmail")}
            </Button>
          ) : null}
        </div>

        {(status === "none" || editing) && (
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              type="email"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="you@company.com"
              autoComplete="email"
            />
            <Button type="button" size="sm" disabled={busy} onClick={() => void submitEmail()}>
              {t("wallet.emailAttachCta")}
            </Button>
          </div>
        )}

        {status === "pending" && (
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              inputMode="numeric"
              value={otp}
              onChange={(e) => setOtp(e.target.value)}
              placeholder={t("wallet.recoverOtpLabel")}
            />
            <Button type="button" size="sm" disabled={busy} onClick={() => void verifyOtp()}>
              {t("wallet.recoverVerifyOtp")}
            </Button>
          </div>
        )}

        <TurnstileWidget siteKey={siteKey} onTokenChange={() => undefined} controlRef={captchaRef} />
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
      </AlertDescription>
    </Alert>
  );
}
