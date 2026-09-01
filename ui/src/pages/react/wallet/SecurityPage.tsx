import { useLocale } from "@/providers/LocaleProvider";
import { renderWalletSecurity } from "@/pages/wallet/security.js";
import { PageCard, PageSplit } from "@/components/PageSplit";
import { TrustNotice } from "@/components/TrustNotice";
import { WalletFrame } from "./WalletFrame";
import { WalletBodyMount } from "./WalletBodyMount";

export function SecurityPage() {
  const { t } = useLocale();
  return (
    <WalletFrame
      current="security"
      title={t("wallet.securityPageTitle")}
      lede={t("wallet.securityPageLede")}
    >
      <PageSplit>
        <PageCard>
          <WalletBodyMount render={renderWalletSecurity} />
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
