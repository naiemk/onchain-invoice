import { useLocale } from "@/providers/LocaleProvider";
import { renderWalletReceive } from "@/pages/wallet/receive.js";
import { WalletFrame } from "./WalletFrame";
import { WalletBodyMount } from "./WalletBodyMount";

export function ReceivePage() {
  const { t } = useLocale();
  return (
    <WalletFrame current="receive" title={t("wallet.receiveTitle")} lede={t("wallet.receiveLede")}>
      <WalletBodyMount render={renderWalletReceive} />
    </WalletFrame>
  );
}
