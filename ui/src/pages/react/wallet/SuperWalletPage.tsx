import { useLocale } from "@/providers/LocaleProvider";
import { renderWalletSuperWallet } from "@/pages/wallet/super-wallet.js";
import { WalletFrame } from "./WalletFrame";
import { WalletBodyMount } from "./WalletBodyMount";

export function SuperWalletPage() {
  const { t } = useLocale();
  return (
    <WalletFrame current="superWallet" title={t("wallet.superWalletTitle")} lede={t("wallet.superWalletLede")}>
      <WalletBodyMount render={renderWalletSuperWallet} />
    </WalletFrame>
  );
}
