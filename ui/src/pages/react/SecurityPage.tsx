import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Surface } from "@/components/Surface";
import { useLocale } from "@/providers/LocaleProvider";
import { SITE } from "@/shared/site.js";

export function SecurityPage() {
  const { t } = useLocale();

  const blocks = [
    { title: t("securityPage.passkeyTitle"), body: t("securityPage.passkeyBody") },
    { title: t("securityPage.settlementTitle"), body: t("securityPage.settlementBody") },
    {
      title: t("securityPage.recoveryTitle"),
      body: t("securityPage.recoveryBody"),
      cta: { href: "/wallet/recover", label: t("securityPage.recoveryCta") },
    },
  ];

  const advancedItems = [
    { label: t("securityPage.advDevices"), available: true },
    { label: t("securityPage.advRecovery"), available: true },
    { label: t("securityPage.advRoles"), available: false },
    { label: t("securityPage.advPolicies"), available: false },
    { label: t("securityPage.advMultisig"), available: false },
  ];

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 md:px-8">
      <header className="mb-8 space-y-1.5">
        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{t("securityPage.eyebrow")}</p>
        <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">{t("securityPage.title")}</h1>
        <p className="text-sm text-muted-foreground">{t("securityPage.lede")}</p>
      </header>
      <div className="space-y-3">
        {blocks.map(({ title, body, cta }) => (
          <Surface key={title} className="p-5">
            <h2 className="text-sm font-semibold">{title}</h2>
            <p className="mt-1.5 text-sm text-muted-foreground">{body}</p>
            {cta && (
              <Button asChild variant="outline" size="sm" className="mt-4">
                <Link to={cta.href}>{cta.label}</Link>
              </Button>
            )}
          </Surface>
        ))}
        <Surface className="p-5">
          <h2 className="text-sm font-semibold">{t("securityPage.advancedTitle")}</h2>
          <p className="mt-1.5 text-sm text-muted-foreground">{t("securityPage.advancedBody")}</p>
          <ul className="mt-4 space-y-2">
            {advancedItems.map(({ label, available }) => (
              <li key={label} className="flex items-center gap-2 text-sm">
                <Badge variant={available ? "ok" : "secondary"}>
                  {available ? t("securityPage.available") : t("securityPage.coming")}
                </Badge>
                {label}
              </li>
            ))}
          </ul>
        </Surface>
        <div className="flex flex-wrap gap-2 pt-2">
          <Button asChild>
            <Link to="/wallet">{t("securityPage.openWallet")}</Link>
          </Button>
          <Button asChild variant="outline">
            <a href={SITE.docsUrl} target="_blank" rel="noopener noreferrer">{t("nav.docs")}</a>
          </Button>
        </div>
      </div>
    </div>
  );
}
