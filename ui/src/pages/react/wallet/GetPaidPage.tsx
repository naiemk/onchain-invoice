import { Link } from "react-router-dom";
import { ArrowUpRight, FileText, QrCode } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageCard } from "@/components/PageSplit";
import { useLocale } from "@/providers/LocaleProvider";
import { WalletFrame } from "./WalletFrame";

export function GetPaidPage() {
  const { t } = useLocale();

  const cards = [
    {
      href: "/create",
      icon: FileText,
      title: t("wallet.getPaidInvoiceTitle"),
      body: t("wallet.getPaidInvoiceBody"),
      cta: t("wallet.getPaidInvoiceCta"),
    },
    {
      href: "/wallet/receive",
      icon: QrCode,
      title: t("wallet.getPaidReceiveTitle"),
      body: t("wallet.getPaidReceiveBody"),
      cta: t("wallet.getPaidReceiveCta"),
    },
  ];

  return (
    <WalletFrame current="getPaid" title={t("wallet.getPaidTitle")} lede={t("wallet.getPaidLede")}>
      <div className="grid gap-4 sm:grid-cols-2">
        {cards.map(({ href, icon: Icon, title, body, cta }) => (
          <PageCard key={href}>
            <Icon className="mb-3 h-5 w-5 text-emphasis" aria-hidden />
            <h2 className="text-base font-semibold">{title}</h2>
            <p className="mt-2 text-sm text-muted-foreground">{body}</p>
            <Button asChild variant="secondary" className="mt-4" size="sm">
              <Link to={href}>
                {cta}
                <ArrowUpRight className="h-3.5 w-3.5" />
              </Link>
            </Button>
          </PageCard>
        ))}
      </div>
    </WalletFrame>
  );
}
