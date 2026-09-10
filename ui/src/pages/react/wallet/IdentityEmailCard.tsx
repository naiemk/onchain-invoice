import { useCallback, useEffect, useState } from "react";
import { Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useLocale } from "@/providers/LocaleProvider";
import { fetchWalletEmail } from "@/shared/wallet-recovery-api.js";
import { listWalletEntities } from "@/shared/wallet-advanced-api.js";
import { type WalletSession } from "@/shared/wallet-session.js";
import { EmailAttachWizard } from "./EmailAttachWizard";

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
  const [wizardOpen, setWizardOpen] = useState(false);

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
    void reload();
  }, [reload]);

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

  const cta =
    status === "verified"
      ? t("wallet.identityChangeEmail")
      : status === "pending"
        ? t("wallet.recoverVerifyOtp")
        : t("wallet.emailAttachCta");

  return (
    <>
      <Alert className="mb-4" data-testid="identity-email-card">
        <Mail className="h-4 w-4" />
        <AlertDescription className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
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
          <Button type="button" size="sm" variant="secondary" onClick={() => setWizardOpen(true)}>
            {cta}
          </Button>
        </AlertDescription>
      </Alert>
      <EmailAttachWizard
        open={wizardOpen}
        onOpenChange={setWizardOpen}
        session={session}
        initialEmail={email ?? ""}
        startOnCode={status === "pending"}
        onDone={() => void reload()}
      />
    </>
  );
}
