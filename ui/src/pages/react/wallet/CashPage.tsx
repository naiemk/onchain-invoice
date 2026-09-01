import { ActionTile } from "@/components/ActionTile";
import { useLocale } from "@/providers/LocaleProvider";
import { WalletFrame } from "./WalletFrame";

export function CashPage() {
  const { t } = useLocale();

  return (
    <WalletFrame current="cash" title={t("wallet.cashTitle")} lede={t("wallet.cashLede")}>
      <div className="grid gap-3 sm:grid-cols-2">
        <ActionTile
          href="/wallet/deposit"
          title={t("wallet.cashInTitle")}
          description={t("wallet.cashInBody")}
          cta={t("wallet.depositCta")}
        />
        <ActionTile
          href="/wallet/withdraw"
          title={t("wallet.cashOutTitle")}
          description={t("wallet.cashOutBody")}
          cta={t("wallet.withdrawCta")}
        />
      </div>
      <p className="mt-4 text-sm text-muted-foreground">{t("wallet.cashHint")}</p>
    </WalletFrame>
  );
}
