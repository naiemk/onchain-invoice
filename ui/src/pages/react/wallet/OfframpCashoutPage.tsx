import { useLocale } from "@/providers/LocaleProvider";
import { renderWalletOfframpCashout } from "@/pages/wallet/offramp-cashout.js";
import { PageCard, PageSplit } from "@/components/PageSplit";
import { TrustNotice } from "@/components/TrustNotice";
import { WalletFrame } from "./WalletFrame";
import { WalletBodyMount } from "./WalletBodyMount";

export function OfframpCashoutPage() {
  const { t } = useLocale();
  return (
    <WalletFrame current="cash" title={t("wallet.offrampCashoutTitle")} lede={t("wallet.offrampCashoutLede")}>
      <PageSplit>
        <PageCard>
          <WalletBodyMount render={renderWalletOfframpCashout} />
        </PageCard>
        <PageCard>
          <h2 className="text-base font-semibold">{t("wallet.sendPauseTitle")}</h2>
          <TrustNotice className="mt-4 border-0 bg-muted/40 p-0">{t("wallet.sendPauseBody")}</TrustNotice>
        </PageCard>
      </PageSplit>
    </WalletFrame>
  );
}
