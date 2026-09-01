import { useLocale } from "@/providers/LocaleProvider";
import { renderWalletDeposit } from "@/pages/wallet/deposit.js";
import { WalletFrame } from "./WalletFrame";
import { WalletBodyMount } from "./WalletBodyMount";

export function DepositPage() {
  const { t } = useLocale();
  return (
    <WalletFrame current="cash" title={t("wallet.depositTitle")} lede={t("wallet.depositLede")}>
      <WalletBodyMount render={renderWalletDeposit} />
    </WalletFrame>
  );
}
