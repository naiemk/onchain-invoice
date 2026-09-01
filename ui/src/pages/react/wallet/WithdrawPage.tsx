import { useLocale } from "@/providers/LocaleProvider";
import { renderWalletWithdraw } from "@/pages/wallet/withdraw.js";
import { PageCard, PageSplit } from "@/components/PageSplit";
import { TrustNotice } from "@/components/TrustNotice";
import { WalletFrame } from "./WalletFrame";
import { WalletBodyMount } from "./WalletBodyMount";

export function WithdrawPage() {
  const { t } = useLocale();
  return (
    <WalletFrame current="cash" title={t("wallet.withdrawTitle")} lede={t("wallet.withdrawLede")}>
      <PageSplit>
        <PageCard>
          <WalletBodyMount render={renderWalletWithdraw} />
        </PageCard>
        <PageCard>
          <h2 className="text-base font-semibold">{t("wallet.cashOutTitle")}</h2>
          <TrustNotice className="mt-4 border-0 bg-muted/40 p-0">{t("wallet.withdrawHint")}</TrustNotice>
          <p className="mt-4 text-xs text-muted-foreground">{t("wallet.cashSettlementHint")}</p>
        </PageCard>
      </PageSplit>
    </WalletFrame>
  );
}
