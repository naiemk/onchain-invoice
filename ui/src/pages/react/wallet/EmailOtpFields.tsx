import type { MutableRefObject } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TurnstileWidget, type TurnstileControl } from "@/components/TurnstileWidget";
import { useLocale } from "@/providers/LocaleProvider";

export function EmailOtpFields({
  step,
  email,
  onEmailChange,
  otp,
  onOtpChange,
  siteKey,
  captchaRef,
  emailId = "identity-email",
  otpId = "identity-otp",
  autoCompleteEmail = "username webauthn",
  showCaptcha,
}: {
  step: "email" | "code";
  email: string;
  onEmailChange: (value: string) => void;
  otp: string;
  onOtpChange: (value: string) => void;
  siteKey: string | null;
  captchaRef: MutableRefObject<TurnstileControl | null>;
  emailId?: string;
  otpId?: string;
  autoCompleteEmail?: string;
  showCaptcha?: boolean;
}) {
  const { t } = useLocale();
  const captcha = showCaptcha ?? true;
  if (step === "email") {
    return (
      <div className="space-y-3">
        <div className="space-y-2">
          <Label htmlFor={emailId}>{t("wallet.connectEmail")}</Label>
          <Input
            id={emailId}
            type="email"
            autoComplete={autoCompleteEmail}
            placeholder="you@company.com"
            value={email}
            onChange={(e) => onEmailChange(e.target.value)}
          />
        </div>
        {captcha ? <TurnstileWidget siteKey={siteKey} controlRef={captchaRef} /> : null}
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <Label htmlFor={otpId}>{t("wallet.recoverOtpLabel")}</Label>
        <Input
          id={otpId}
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          value={otp}
          onChange={(e) => onOtpChange(e.target.value)}
        />
      </div>
      {captcha ? <TurnstileWidget siteKey={siteKey} controlRef={captchaRef} /> : null}
    </div>
  );
}
