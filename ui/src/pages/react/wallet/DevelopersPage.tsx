import { Badge } from "@/components/ui/badge";
import { useLocale } from "@/providers/LocaleProvider";
import { SITE } from "@/shared/site.js";
import { WalletFrame } from "./WalletFrame";

export function DevelopersPage() {
  const { t } = useLocale();

  const links = [
    {
      href: SITE.docsUrl,
      label: t("wallet.developersDocs"),
      hint: t("wallet.developersDocsHint"),
      external: true,
    },
    {
      href: `${SITE.docsUrl}wallet-client-api/`,
      label: t("wallet.developersApi"),
      hint: t("wallet.developersApiHint"),
      external: true,
    },
  ];

  return (
    <WalletFrame current="developers" title={t("wallet.developersTitle")} lede={t("wallet.developersLede")}>
      <ul className="space-y-6">
        {links.map(({ href, label, hint }) => (
          <li key={href}>
            <a href={href} target="_blank" rel="noopener noreferrer" className="font-medium text-primary hover:underline">
              {label}
            </a>
            <p className="mt-1 text-sm text-muted-foreground">{hint}</p>
          </li>
        ))}
        <li className="flex flex-wrap items-center gap-2 text-sm">
          <Badge variant="secondary">{t("wallet.comingBadge")}</Badge>
          {t("wallet.developersKeysComing")}
        </li>
      </ul>
    </WalletFrame>
  );
}
