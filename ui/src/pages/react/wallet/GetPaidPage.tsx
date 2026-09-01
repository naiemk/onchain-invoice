import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useLocale } from "@/providers/LocaleProvider";
import { WalletFrame } from "./WalletFrame";

export function GetPaidPage() {
  const { t } = useLocale();

  const tiles = [
    {
      href: "/create",
      title: t("wallet.getPaidInvoiceTitle"),
      body: t("wallet.getPaidInvoiceBody"),
      cta: t("wallet.getPaidInvoiceCta"),
      primary: true,
    },
    {
      href: "/wallet/receive",
      title: t("wallet.getPaidReceiveTitle"),
      body: t("wallet.getPaidReceiveBody"),
      cta: t("wallet.getPaidReceiveCta"),
      primary: false,
    },
  ];

  return (
    <WalletFrame current="getPaid" title={t("wallet.getPaidTitle")} lede={t("wallet.getPaidLede")}>
      <div className="grid gap-4 sm:grid-cols-2">
        {tiles.map(({ href, title, body, cta, primary }) => (
          <Link key={href} to={href} className="group no-underline hover:no-underline">
            <Card className="h-full transition-colors group-hover:border-primary/40">
              <CardHeader>
                <CardTitle className="text-lg">{title}</CardTitle>
                <CardDescription>{body}</CardDescription>
              </CardHeader>
              <CardContent>
                <Button variant={primary ? "default" : "secondary"} size="sm">
                  {cta}
                </Button>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </WalletFrame>
  );
}
