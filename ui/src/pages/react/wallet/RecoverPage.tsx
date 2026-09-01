import { useLocale } from "@/providers/LocaleProvider";
import { renderWalletRecover } from "@/pages/wallet/recover.js";
import { PageCard, PageSplit } from "@/components/PageSplit";
import { TrustNotice } from "@/components/TrustNotice";
import { WalletFrame } from "./WalletFrame";
import { WalletBodyMount } from "./WalletBodyMount";

export function RecoverPage() {
  const { t } = useLocale();
  return (
    <WalletFrame current="recover" title={t("wallet.recoverPageTitle")} lede={t("wallet.recoverPageLede")}>
      <PageSplit>
        <PageCard>
          <WalletBodyMount render={renderWalletRecover} />
        </PageCard>
        <PageCard>
          <h2 className="text-base font-semibold">{t("wallet.recoveryMethodsTitle")}</h2>
          <p className="mt-2 text-sm text-muted-foreground">{t("wallet.recoveryMethodsHint")}</p>
          <TrustNotice className="mt-6 border-0 bg-muted/40 p-0">{t("wallet.securityDelayNotice")}</TrustNotice>
        </PageCard>
      </PageSplit>
    </WalletFrame>
  );
}
