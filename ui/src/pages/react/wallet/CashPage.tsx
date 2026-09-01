import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowDown, ArrowUp, Building2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageCard, PageSplit } from "@/components/PageSplit";
import { Money } from "@/components/Money";
import { cn } from "@/lib/utils";
import { useLocale } from "@/providers/LocaleProvider";
import { fetchWalletBalance } from "@/shared/wallet-api.js";
import { loadWalletSession } from "@/shared/wallet-session.js";
import { WalletFrame } from "./WalletFrame";

type CashMode = "out" | "in";

export function CashPage() {
  const { t } = useLocale();
  const session = loadWalletSession();
  const [mode, setMode] = useState<CashMode>("out");
  const [available, setAvailable] = useState("0.00");

  useEffect(() => {
    if (!session) return;
    void fetchWalletBalance(session.address)
      .then((b) => setAvailable(b.totalUsd))
      .catch(() => setAvailable("0.00"));
  }, [session]);

  return (
    <WalletFrame current="cash" title={t("wallet.cashPageTitle")} lede={t("wallet.cashPageLede")}>
      <PageSplit>
        <PageCard>
          <Building2 className="mb-3 h-5 w-5 text-emphasis" aria-hidden />
          <h2 className="text-base font-semibold">{t("wallet.cashBankTitle")}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{t("wallet.cashBankDetail")}</p>
          <Button asChild variant="secondary" className="mt-4" size="sm">
            <Link to="/wallet/deposit">{t("wallet.manageBankAccounts")}</Link>
          </Button>
        </PageCard>

        <PageCard>
          <div className="mb-6 inline-flex rounded-full border border-border p-0.5">
            {(["out", "in"] as const).map((m) => (
              <button
                key={m}
                type="button"
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium transition-colors",
                  mode === m ? "bg-primary text-primary-foreground" : "text-muted-foreground"
                )}
                onClick={() => setMode(m)}
              >
                {m === "out" ? <ArrowUp className="h-3.5 w-3.5" /> : <ArrowDown className="h-3.5 w-3.5" />}
                {m === "out" ? t("wallet.cashOutTitle") : t("wallet.cashInTitle")}
              </button>
            ))}
          </div>

          <div className="flex items-end justify-between gap-4">
            <div>
              <p className="text-sm text-muted-foreground">{t("wallet.availableToMove")}</p>
              <p className="text-xs text-muted-foreground">USDC · Base</p>
            </div>
            <Money amount={available} size="lg" />
          </div>

          <p className="mt-6 text-xs text-muted-foreground">{t("wallet.cashSettlementHint")}</p>

          <Button asChild className="mt-6">
            <Link to={mode === "out" ? "/wallet/withdraw" : "/wallet/deposit"}>
              {mode === "out" ? t("wallet.withdrawCta") : t("wallet.depositCta")}
            </Link>
          </Button>
        </PageCard>
      </PageSplit>
    </WalletFrame>
  );
}
