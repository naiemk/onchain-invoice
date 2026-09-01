import { useLocale } from "@/providers/LocaleProvider";
import { renderWalletDeposit } from "@/pages/wallet/deposit.js";
import { PageCard, PageSplit } from "@/components/PageSplit";
import { TrustNotice } from "@/components/TrustNotice";
import { WalletFrame } from "./WalletFrame";
import { WalletBodyMount } from "./WalletBodyMount";

export function DepositPage() {
  const { t } = useLocale();
  return (
    <WalletFrame current="cash" title={t("wallet.depositTitle")} lede={t("wallet.depositLede")}>
      <PageSplit>
        <PageCard>
          <WalletBodyMount render={renderWalletDeposit} />
        </PageCard>
        <PageCard>
          <h2 className="text-base font-semibold">{t("wallet.cashInTitle")}</h2>
          <TrustNotice className="mt-4 border-0 bg-muted/40 p-0">{t("wallet.depositHint")}</TrustNotice>
        </PageCard>
      </PageSplit>
    </WalletFrame>
  );
}
