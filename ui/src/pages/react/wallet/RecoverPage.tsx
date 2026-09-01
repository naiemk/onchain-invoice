import { useLocale } from "@/providers/LocaleProvider";
import { renderWalletRecover } from "@/pages/wallet/recover.js";
import { WalletFrame } from "./WalletFrame";
import { WalletBodyMount } from "./WalletBodyMount";

export function RecoverPage() {
  const { t } = useLocale();
  return (
    <WalletFrame current="recover" title={t("wallet.recoverTitle")} lede={t("wallet.recoverLede")}>
      <WalletBodyMount render={renderWalletRecover} />
    </WalletFrame>
  );
}
