import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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
      <header className="mb-10 space-y-2">
        <p className="text-sm font-medium uppercase tracking-wider text-primary">{t("securityPage.eyebrow")}</p>
        <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">{t("securityPage.title")}</h1>
        <p className="text-lg text-muted-foreground">{t("securityPage.lede")}</p>
      </header>
      <div className="space-y-6">
        {blocks.map(({ title, body, cta }) => (
          <Card key={title}>
            <CardHeader>
              <CardTitle>{title}</CardTitle>
              <CardDescription className="text-base text-muted-foreground">{body}</CardDescription>
            </CardHeader>
            {cta && (
              <CardContent>
                <Button asChild variant="secondary">
                  <Link to={cta.href}>{cta.label}</Link>
                </Button>
              </CardContent>
            )}
          </Card>
        ))}
        <Card>
          <CardHeader>
            <CardTitle>{t("securityPage.advancedTitle")}</CardTitle>
            <CardDescription className="text-base">{t("securityPage.advancedBody")}</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="space-y-3">
              {advancedItems.map(({ label, available }) => (
                <li key={label} className="flex items-center gap-2 text-sm">
                  <Badge variant={available ? "ok" : "secondary"}>
                    {available ? t("securityPage.available") : t("securityPage.coming")}
                  </Badge>
                  {label}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
        <div className="flex flex-wrap gap-3">
          <Button asChild>
            <Link to="/wallet">{t("securityPage.openWallet")}</Link>
          </Button>
          <Button asChild variant="secondary">
            <a href={SITE.docsUrl} target="_blank" rel="noopener noreferrer">{t("nav.docs")}</a>
          </Button>
        </div>
      </div>
    </div>
  );
}
