import { useLocale } from "@/providers/LocaleProvider";
import { renderWalletPair } from "@/pages/wallet/pair.js";
import { WalletFrame } from "./WalletFrame";
import { WalletBodyMount } from "./WalletBodyMount";

export function PairPage() {
  const { t } = useLocale();
  return (
    <WalletFrame current="pair" title={t("wallet.pairTitle")} lede={t("wallet.pairLede")}>
      <WalletBodyMount render={renderWalletPair} />
    </WalletFrame>
  );
}
