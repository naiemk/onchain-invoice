import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { TurnstileWidget, type TurnstileControl } from "@/components/TurnstileWidget";
import { useLocale } from "@/providers/LocaleProvider";
import {
  attachWalletEmail,
  createRecoveryChallenge,
  verifyWalletEmailOtp,
} from "@/shared/wallet-recovery-api.js";
import { fetchWalletConfig } from "@/shared/wallet-api.js";
import { loadWalletSession, type WalletSession } from "@/shared/wallet-session.js";
import { assertPasskeyChallenge } from "@/shared/webauthn.js";

type Step = "email" | "code";

export function EmailAttachWizard({
  open,
  onOpenChange,
  session,
  onDone,
  allowSkip = false,
  initialEmail = "",
  startOnCode = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  session: WalletSession | null;
  onDone: () => void;
  allowSkip?: boolean;
  initialEmail?: string;
  startOnCode?: boolean;
}) {
  const { t } = useLocale();
  const [step, setStep] = useState<Step>(startOnCode ? "code" : "email");
  const [draft, setDraft] = useState(initialEmail);
  const [otp, setOtp] = useState("");
  const [pendingEmail, setPendingEmail] = useState(initialEmail);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [siteKey, setSiteKey] = useState<string | null>(null);
  const captchaRef = useRef<TurnstileControl | null>(null);

  useEffect(() => {
    if (!open) return;
    setStep(startOnCode ? "code" : "email");
    setDraft(initialEmail);
    setPendingEmail(initialEmail);
    setOtp("");
    setError(null);
    void fetchWalletConfig()
      .then((cfg) => setSiteKey(cfg.turnstileSiteKey ?? null))
      .catch(() => setSiteKey(null));
  }, [open, initialEmail, startOnCode]);

  const liveSession = (): WalletSession | null => loadWalletSession() ?? session;

  const submitEmail = async () => {
    const live = liveSession();
    const next = draft.trim();
    if (!live) {
      setError(t("wallet.recoverNeedSession"));
      return;
    }
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
      setStep("code");
      captchaRef.current?.reset();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const verifyOtp = async () => {
    const live = liveSession();
    if (!live) {
      setError(t("wallet.recoverNeedSession"));
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
      await verifyWalletEmailOtp({
        walletAddress: live.address,
        email: pendingEmail || draft,
        code: otp.trim(),
        captchaToken,
      });
      onOpenChange(false);
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const skip = () => {
    onOpenChange(false);
    onDone();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("wallet.emailWizardTitle")}</DialogTitle>
          <DialogDescription>
            {step === "email"
              ? t("wallet.emailWizardLede")
              : t("wallet.emailWizardCodeLede", { email: pendingEmail || draft })}
          </DialogDescription>
        </DialogHeader>

        {step === "email" ? (
          <div className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="email-wizard-email">{t("wallet.recoverEmailLabel")}</Label>
              <Input
                id="email-wizard-email"
                type="email"
                autoComplete="email"
                placeholder="you@company.com"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
              />
            </div>
            <TurnstileWidget siteKey={siteKey} controlRef={captchaRef} />
          </div>
        ) : (
          <div className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="email-wizard-otp">{t("wallet.recoverOtpLabel")}</Label>
              <Input
                id="email-wizard-otp"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={otp}
                onChange={(e) => setOtp(e.target.value)}
              />
            </div>
            <TurnstileWidget siteKey={siteKey} controlRef={captchaRef} />
          </div>
        )}

        {error ? <p className="text-sm text-destructive">{error}</p> : null}

        <DialogFooter className="flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          {allowSkip ? (
            <button
              type="button"
              className="text-xs text-muted-foreground underline underline-offset-2"
              data-testid="email-wizard-skip"
              onClick={skip}
            >
              {t("wallet.emailWizardSkip")}
            </button>
          ) : (
            <span />
          )}
          <Button
            type="button"
            disabled={busy}
            onClick={() => void (step === "email" ? submitEmail() : verifyOtp())}
          >
            {step === "email" ? t("wallet.emailWizardSend") : t("wallet.recoverVerifyOtp")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
