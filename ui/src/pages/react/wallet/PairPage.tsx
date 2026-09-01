import { useLocale } from "@/providers/LocaleProvider";
import { renderWalletPair } from "@/pages/wallet/pair.js";
import { PageCard } from "@/components/PageSplit";
import { WalletFrame } from "./WalletFrame";
import { WalletBodyMount } from "./WalletBodyMount";

export function PairPage() {
  const { t } = useLocale();
  return (
    <WalletFrame current="pair" title={t("wallet.pairPageTitle")} lede={t("wallet.pairPageLede")} showChrome={false}>
      <PageCard className="mx-auto max-w-lg">
        <WalletBodyMount render={renderWalletPair} />
      </PageCard>
    </WalletFrame>
  );
}
