import { useLocale } from "@/providers/LocaleProvider";
import { renderWalletWithdraw } from "@/pages/wallet/withdraw.js";
import { WalletFrame } from "./WalletFrame";
import { WalletBodyMount } from "./WalletBodyMount";

export function WithdrawPage() {
  const { t } = useLocale();
  return (
    <WalletFrame current="cash" title={t("wallet.withdrawTitle")} lede={t("wallet.withdrawLede")}>
      <WalletBodyMount render={renderWalletWithdraw} />
    </WalletFrame>
  );
}
