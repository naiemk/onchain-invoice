import { useLocale } from "@/providers/LocaleProvider";
import { renderWalletJoinSuper } from "@/pages/wallet/join-super.js";
import { WalletFrame } from "./WalletFrame";
import { WalletBodyMount } from "./WalletBodyMount";

export function JoinSuperPage() {
  const { t } = useLocale();
  return (
    <WalletFrame current="pair" title={t("wallet.joinSuperTitle")} lede={t("wallet.joinSuperLede")}>
      <WalletBodyMount render={renderWalletJoinSuper} />
    </WalletFrame>
  );
}
