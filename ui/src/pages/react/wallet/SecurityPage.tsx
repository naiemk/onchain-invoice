import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Mail, Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useLocale } from "@/providers/LocaleProvider";
import { renderWalletSecurity } from "@/pages/wallet/security.js";
import { renderWalletRecover } from "@/pages/wallet/recover.js";
import { PageCard, PageSplit } from "@/components/PageSplit";
import { TrustNotice } from "@/components/TrustNotice";
import { fetchWalletEmail } from "@/shared/wallet-recovery-api.js";
import { fetchAdvancedPolicy } from "@/shared/wallet-advanced-api.js";
import { loadWalletSession } from "@/shared/wallet-session.js";
import { WalletFrame } from "./WalletFrame";
import { WalletBodyMount } from "./WalletBodyMount";

function EmailStatusCard() {
  const { t } = useLocale();
  const session = loadWalletSession();
  const [status, setStatus] = useState<"loading" | "none" | "pending" | "verified">("loading");
  const [email, setEmail] = useState<string | null>(null);
  const [superWallet, setSuperWallet] = useState(false);

  useEffect(() => {
    if (!session) return;
    void (async () => {
      try {
        const policy = await fetchAdvancedPolicy(session.address).catch(() => null);
        if (policy?.advanced) {
          setSuperWallet(true);
          return;
        }
        const result = await fetchWalletEmail(session.address);
        if (result.verified && result.email) {
          setStatus("verified");
          setEmail(result.email);
        } else if (result.hasEmail && result.email) {
          setStatus("pending");
          setEmail(result.email);
        } else {
          setStatus("none");
        }
      } catch {
        setStatus("none");
      }
    })();
  }, [session]);

  if (superWallet || status === "loading") return null;

  if (status === "verified" && email) {
    return (
      <Alert className="mb-4 border-ok/30 bg-ok/5">
        <Mail className="h-4 w-4" />
        <AlertDescription>{t("wallet.recoverEmailVerified", { email })}</AlertDescription>
      </Alert>
    );
  }

  if (status === "pending" && email) {
    return (
      <Alert variant="warn" className="mb-4">
        <Mail className="h-4 w-4" />
        <AlertDescription>{t("wallet.recoverEmailPending", { email })}</AlertDescription>
      </Alert>
    );
  }

  return (
    <Alert className="mb-4 border-primary/30 bg-primary/5">
      <Mail className="h-4 w-4" />
      <AlertDescription className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <span>{t("wallet.emailAttachHint")}</span>
        <Button asChild size="sm" variant="secondary">
          <a href="#recovery">{t("wallet.emailAttachCta")}</a>
        </Button>
      </AlertDescription>
    </Alert>
  );
}

function OtherDevicesCard() {
  const { t } = useLocale();
  return (
    <Alert className="mb-4">
      <Smartphone className="h-4 w-4" />
      <AlertDescription className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <span>{t("wallet.otherDevicesHint")}</span>
        <Button asChild size="sm" variant="secondary">
          <a href="#devices">{t("wallet.addDevice")}</a>
        </Button>
      </AlertDescription>
    </Alert>
  );
}

export function SecurityPage() {
  const { t } = useLocale();
  return (
    <WalletFrame
      current="security"
      title={t("wallet.securityPageTitle")}
      lede={t("wallet.securityPageLede")}
    >
      <EmailStatusCard />
      <OtherDevicesCard />
      <PageSplit>
        <PageCard>
          <WalletBodyMount render={renderWalletSecurity} />
          <section id="recovery" className="mt-8 scroll-mt-24 border-t border-border pt-8">
            <h2 className="mb-4 text-base font-semibold">{t("wallet.recoverPageTitle")}</h2>
            <WalletBodyMount render={renderWalletRecover} />
          </section>
        </PageCard>
        <PageCard>
          <h2 className="text-base font-semibold">{t("wallet.recoveryMethodsTitle")}</h2>
          <p className="mt-2 text-sm text-muted-foreground">{t("wallet.recoveryMethodsHint")}</p>
          <TrustNotice className="mt-6 border-0 bg-muted/40 p-0">
            {t("wallet.securityDelayNotice")}
          </TrustNotice>
        </PageCard>
      </PageSplit>
    </WalletFrame>
  );
}
