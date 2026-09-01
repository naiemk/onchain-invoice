import { Link } from "react-router-dom";
import { ArrowUpRight, FileText, List, QrCode } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHero } from "@/components/PageHero";
import { PageCard } from "@/components/PageSplit";
import { useLocale } from "@/providers/LocaleProvider";
import { saveWalletMode } from "@/shared/wallet-mode.js";
import { useNavigate } from "react-router-dom";

const cards = [
  {
    href: "/create",
    icon: FileText,
    titleKey: "getPaid.createTitle",
    bodyKey: "getPaid.createBody",
    ctaKey: "getPaid.createCta",
  },
  {
    href: "/merchant",
    icon: List,
    titleKey: "getPaid.listTitle",
    bodyKey: "getPaid.listBody",
    ctaKey: "getPaid.listCta",
  },
  {
    href: "/wallet/receive",
    icon: QrCode,
    titleKey: "getPaid.receiveTitle",
    bodyKey: "getPaid.receiveBody",
    ctaKey: "getPaid.receiveCta",
  },
] as const;

export function GetPaidPage() {
  const { t } = useLocale();
  const navigate = useNavigate();

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 md:px-8">
      <PageHero
        breadcrumb={t("getPaid.breadcrumb")}
        title={t("getPaid.title")}
        lede={t("getPaid.lede")}
      />

      <div className="grid gap-4 md:grid-cols-3">
        {cards.map(({ href, icon: Icon, titleKey, bodyKey, ctaKey }) => (
          <PageCard key={href} className="flex flex-col">
            <Icon className="mb-3 h-5 w-5 text-emphasis" aria-hidden />
            <h2 className="text-base font-semibold">{t(titleKey)}</h2>
            <p className="mt-2 flex-1 text-sm text-muted-foreground">{t(bodyKey)}</p>
            <Button asChild variant="secondary" className="mt-4 w-fit">
              <Link to={href}>
                {t(ctaKey)}
                <ArrowUpRight className="h-3.5 w-3.5" />
              </Link>
            </Button>
          </PageCard>
        ))}
      </div>

      <p className="mt-8 text-sm text-muted-foreground">
        {t("getPaid.advancedHint")}{" "}
        <Button
          variant="link"
          className="h-auto p-0 text-sm"
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
