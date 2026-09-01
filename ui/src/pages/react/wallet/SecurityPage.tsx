import { useLocale } from "@/providers/LocaleProvider";
import { renderWalletSecurity } from "@/pages/wallet/security.js";
import { WalletFrame } from "./WalletFrame";
import { WalletBodyMount } from "./WalletBodyMount";

export function SecurityPage() {
  const { t } = useLocale();
  return (
    <WalletFrame current="security" title={t("wallet.devicesTab")} lede={t("wallet.pairRequired")}>
      <WalletBodyMount render={renderWalletSecurity} />
    </WalletFrame>
  );
}
