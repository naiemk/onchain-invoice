import { PageCard, PageSplit } from "@/components/PageSplit";
import { OnrampFlow } from "@/onramp/OnrampFlow";
import { TrustNotice } from "@/components/TrustNotice";
import { useLocale } from "@/providers/LocaleProvider";
import { WalletFrame, useRequireWalletSession } from "./WalletFrame";

export function DepositPage() {
  const { t } = useLocale();
  const session = useRequireWalletSession();
  if (!session) return null;

  return (
    <WalletFrame current="cash" title={t("wallet.depositTitle")} lede={t("wallet.depositLede")}>
      <PageSplit>
        <PageCard>
          <OnrampFlow lockedAddress={session.address} />
        </PageCard>
        <PageCard>
          <h2 className="text-base font-semibold">{t("wallet.cashInTitle")}</h2>
          <TrustNotice className="mt-4 border-0 bg-muted/40 p-0">{t("wallet.depositHint")}</TrustNotice>
          <p className="mt-4 text-xs text-muted-foreground">{t("buy.continueHint")}</p>
        </PageCard>
      </PageSplit>
    </WalletFrame>
  );
}
