import { useLocale } from "@/providers/LocaleProvider";
import { renderWalletOfframpCashout } from "@/pages/wallet/offramp-cashout.js";
import { WalletFrame } from "./WalletFrame";
import { WalletBodyMount } from "./WalletBodyMount";

export function OfframpCashoutPage() {
  const { t } = useLocale();
  return (
    <WalletFrame current="send" title={t("wallet.offrampCashoutTitle")}>
      <WalletBodyMount render={renderWalletOfframpCashout} />
    </WalletFrame>
  );
}
