import { Link, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useLocale } from "@/providers/LocaleProvider";
import { saveWalletMode } from "@/shared/wallet-mode.js";
import { ArrowRight, FileText, List, QrCode } from "lucide-react";

const TILES = [
  { href: "/create", icon: FileText, titleKey: "getPaid.createTitle", bodyKey: "getPaid.createBody", ctaKey: "getPaid.createCta" },
  { href: "/merchant", icon: List, titleKey: "getPaid.listTitle", bodyKey: "getPaid.listBody", ctaKey: "getPaid.listCta" },
  { href: "/wallet/receive", icon: QrCode, titleKey: "getPaid.receiveTitle", bodyKey: "getPaid.receiveBody", ctaKey: "getPaid.receiveCta" },
] as const;

export function GetPaidPage() {
  const { t } = useLocale();
  const navigate = useNavigate();

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 md:px-8">
      <header className="mb-10 space-y-2">
        <p className="text-sm font-medium uppercase tracking-wider text-primary">{t("getPaid.eyebrow")}</p>
        <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">{t("getPaid.title")}</h1>
        <p className="text-lg text-muted-foreground">{t("getPaid.lede")}</p>
      </header>
      <div className="grid gap-4 md:grid-cols-3">
        {TILES.map(({ href, icon: Icon, titleKey, bodyKey, ctaKey }) => (
          <Link key={href} to={href} className="group no-underline hover:no-underline">
            <Card className="flex h-full flex-col transition-all group-hover:border-primary/40 group-hover:shadow-md">
              <CardHeader>
                <Icon className="mb-2 h-8 w-8 text-primary" />
                <CardTitle className="text-lg">{t(titleKey)}</CardTitle>
                <CardDescription>{t(bodyKey)}</CardDescription>
              </CardHeader>
              <CardContent className="mt-auto">
                <span className="inline-flex items-center gap-1 text-sm font-medium text-primary">
                  {t(ctaKey)} <ArrowRight className="h-4 w-4" />
                </span>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
      <p className="mt-6 text-sm text-muted-foreground">
        {t("getPaid.advancedHint")}{" "}
        <Button
          variant="link"
          className="h-auto p-0"
          onClick={() => {
            saveWalletMode("advanced");
            navigate("/merchant");
          }}
        >
          {t("getPaid.switchAdvanced")}
        </Button>
      </p>
    </div>
  );
}
