import { LegacyMount } from "@/components/LegacyMount";
import { useLocale } from "@/providers/LocaleProvider";
import { renderMerchant } from "@/pages/merchant.js";
import { WalletFrame } from "./WalletFrame";

export function InvoicesPage() {
  const { t } = useLocale();
  return (
    <WalletFrame
      current="invoices"
      title={t("wallet.advancedInvoicesTitle")}
      lede={t("wallet.advancedInvoicesBody")}
    >
      <div className="legacy-page rounded-xl border border-border bg-card p-4 shadow-sm">
        <LegacyMount render={renderMerchant} />
      </div>
    </WalletFrame>
  );
}
