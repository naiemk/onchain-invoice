import { useLocale } from "@/providers/LocaleProvider";
import { renderWalletProposals } from "@/pages/wallet/proposals.js";
import { WalletFrame } from "./WalletFrame";
import { WalletBodyMount } from "./WalletBodyMount";

export function ProposalsPage() {
  const { t } = useLocale();
  return (
    <WalletFrame current="send" title={t("wallet.proposalsTitle")}>
      <WalletBodyMount render={renderWalletProposals} />
    </WalletFrame>
  );
}
