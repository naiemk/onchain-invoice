import { useLocale } from "@/providers/LocaleProvider";
import { PageCard, PageSplit } from "@/components/PageSplit";
import { TrustNotice } from "@/components/TrustNotice";
import { loadWalletSession } from "@/shared/wallet-session.js";
import { WalletFrame } from "./WalletFrame";
import { RecoveryOptions } from "./RecoveryOptions";
import { DevicesCard } from "./DevicesCard";
import { IdentityEmailCard } from "./IdentityEmailCard";
import { IdentityRestoreCard } from "./IdentityRestoreCard";

export function SecurityPage() {
  const { t } = useLocale();
  const session = loadWalletSession();

  return (
    <WalletFrame
      current="security"
      title={t("wallet.securityPageTitle")}
      lede={t("wallet.securityPageLedeIdentity")}
    >
      {session ? <IdentityEmailCard session={session} advanced={false} /> : null}
      {session?.identityId ? <IdentityRestoreCard session={session} /> : null}
      <PageSplit>
        <div className="space-y-6">
          {session ? <DevicesCard session={session} /> : null}
          <PageCard>
            <section id="recovery" className="scroll-mt-24">
              <h2 className="mb-4 text-base font-semibold">{t("wallet.recoverPageTitle")}</h2>
              <RecoveryOptions />
            </section>
          </PageCard>
        </div>
        <PageCard>
          <h2 className="text-base font-semibold">{t("wallet.recoveryMethodsTitle")}</h2>
          <p className="mt-2 text-sm text-muted-foreground">{t("wallet.recoveryMethodsHintIdentity")}</p>
          <TrustNotice className="mt-6 border-0 bg-muted/40 p-0">
            {t("wallet.securityDelayNotice")}
          </TrustNotice>
        </PageCard>
      </PageSplit>
    </WalletFrame>
  );
}
