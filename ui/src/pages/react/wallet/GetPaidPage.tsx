import { ActionTile } from "@/components/ActionTile";
import { useLocale } from "@/providers/LocaleProvider";
import { WalletFrame } from "./WalletFrame";

export function GetPaidPage() {
  const { t } = useLocale();

  return (
    <WalletFrame current="getPaid" title={t("wallet.getPaidTitle")} lede={t("wallet.getPaidLede")}>
      <div className="grid gap-3 sm:grid-cols-2">
        <ActionTile
          href="/create"
          title={t("wallet.getPaidInvoiceTitle")}
          description={t("wallet.getPaidInvoiceBody")}
          cta={t("wallet.getPaidInvoiceCta")}
        />
        <ActionTile
          href="/wallet/receive"
          title={t("wallet.getPaidReceiveTitle")}
          description={t("wallet.getPaidReceiveBody")}
          cta={t("wallet.getPaidReceiveCta")}
        />
      </div>
    </WalletFrame>
  );
}
