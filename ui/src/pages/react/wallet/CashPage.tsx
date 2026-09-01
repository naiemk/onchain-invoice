import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useLocale } from "@/providers/LocaleProvider";
import { WalletFrame } from "./WalletFrame";

export function CashPage() {
  const { t } = useLocale();

  const tiles = [
    {
      href: "/wallet/deposit",
      title: t("wallet.cashInTitle"),
      body: t("wallet.cashInBody"),
      cta: t("wallet.depositCta"),
      primary: true,
    },
    {
      href: "/wallet/withdraw",
      title: t("wallet.cashOutTitle"),
      body: t("wallet.cashOutBody"),
      cta: t("wallet.withdrawCta"),
      primary: false,
    },
  ];

  return (
    <WalletFrame current="cash" title={t("wallet.cashTitle")} lede={t("wallet.cashLede")}>
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
      <p className="mt-6 text-sm text-muted-foreground">{t("wallet.cashHint")}</p>
    </WalletFrame>
  );
}
