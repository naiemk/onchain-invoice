import { useLocale } from "@/providers/LocaleProvider";
import { renderWalletSend } from "@/pages/wallet/send.js";
import { WalletFrame } from "./WalletFrame";
import { WalletBodyMount } from "./WalletBodyMount";

export function SendPage() {
  const { t } = useLocale();
  return (
    <WalletFrame current="send" title={t("wallet.sendTitle")}>
      <WalletBodyMount render={renderWalletSend} />
    </WalletFrame>
  );
}
