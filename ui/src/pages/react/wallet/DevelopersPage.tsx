import { ArrowUpRight, BookOpen, Code2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageCard } from "@/components/PageSplit";
import { useLocale } from "@/providers/LocaleProvider";
import { SITE } from "@/shared/site.js";
import { WalletFrame } from "./WalletFrame";

export function DevelopersPage() {
  const { t } = useLocale();

  const tiles = [
    {
      href: SITE.docsUrl,
      icon: BookOpen,
      label: t("wallet.developersDocs"),
      hint: t("wallet.developersDocsHint"),
    },
    {
      href: `${SITE.docsUrl}wallet-client-api/`,
      icon: Code2,
      label: t("wallet.developersApi"),
      hint: t("wallet.developersApiHint"),
    },
  ];

  return (
    <WalletFrame current="developers" title={t("wallet.developersTitle")} lede={t("wallet.developersLede")}>
      <div className="grid gap-4 sm:grid-cols-2">
        {tiles.map(({ href, icon: Icon, label, hint }) => (
          <PageCard key={href}>
            <Icon className="mb-3 h-5 w-5 text-emphasis" aria-hidden />
            <h2 className="text-base font-semibold">{label}</h2>
            <p className="mt-2 text-sm text-muted-foreground">{hint}</p>
            <Button asChild variant="secondary" className="mt-4" size="sm">
              <a href={href} target="_blank" rel="noopener noreferrer">
                {label}
                <ArrowUpRight className="h-3.5 w-3.5" />
              </a>
            </Button>
          </PageCard>
        ))}
        <PageCard className="sm:col-span-2">
          <Badge variant="secondary">{t("wallet.comingBadge")}</Badge>
          <p className="mt-2 text-sm text-muted-foreground">{t("wallet.developersKeysComing")}</p>
        </PageCard>
      </div>
    </WalletFrame>
  );
}
