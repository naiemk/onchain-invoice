import { Link, useSearchParams } from "react-router-dom";
import { PageHero } from "@/components/PageHero";
import { PageCard } from "@/components/PageSplit";
import { OnrampFlow } from "@/onramp/OnrampFlow";
import { useLocale } from "@/providers/LocaleProvider";
import { loadWalletSession } from "@/shared/wallet-session.js";

export function BuyPage() {
  const { t } = useLocale();
  const [params] = useSearchParams();
  const session = loadWalletSession();
  const queryAddress = params.get("address")?.trim() ?? "";
  const invoiceId = (params.get("invoice") ?? params.get("id") ?? "").trim();
  const invoicePrice = params.get("price")?.trim() ?? undefined;
  const lockAddress = Boolean(queryAddress);
  const address = queryAddress || session?.address || "";

  return (
    <div className="mx-auto max-w-lg px-4 py-10 md:px-8">
      <PageHero breadcrumb={t("buy.breadcrumb")} title={t("buy.title")} lede={t("buy.lede")} />
      {invoiceId && (
        <p className="mb-4 text-sm text-muted-foreground">
          <Link to={`/pay?id=${encodeURIComponent(invoiceId)}`} className="text-primary underline">
            {t("buy.backToQuotes")}
          </Link>
        </p>
      )}
      <PageCard>
        <OnrampFlow
          lockedAddress={lockAddress ? address : undefined}
          initialAddress={address}
          initialAmount={params.get("amount") ?? undefined}
          initialRegion={params.get("country") ?? params.get("region") ?? undefined}
          initialFiat={params.get("fiat") ?? undefined}
          invoiceId={invoiceId || undefined}
          invoicePrice={invoicePrice}
        />
      </PageCard>
    </div>
  );
}
