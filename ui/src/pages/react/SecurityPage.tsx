import { Link } from "react-router-dom";
import { ArrowUpRight, Shield } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHero } from "@/components/PageHero";
import { PageCard, PageSplit } from "@/components/PageSplit";
import { TrustNotice } from "@/components/TrustNotice";
import { StatusBadge } from "@/components/StatusBadge";
import { useLocale } from "@/providers/LocaleProvider";

export function SecurityPage() {
  const { t } = useLocale();

  const recoveryItems = [
    { label: t("securityPage.mapPasskeys"), tone: "active" as const, detail: "2" },
    { label: t("securityPage.mapEmail"), tone: "verified" as const, detail: t("securityPage.verified") },
    { label: t("securityPage.mapGuardian"), tone: "muted" as const, detail: t("securityPage.notAdded") },
  ];

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 md:px-8">
      <PageHero
        breadcrumb={t("securityPage.breadcrumb")}
        title={t("securityPage.title")}
        lede={t("securityPage.lede")}
      />

      <PageSplit>
        <PageCard className="bg-brand-panel text-brand-panel-foreground">
          <Shield className="mb-3 h-5 w-5 text-brand-panel-foreground/80" aria-hidden />
          <h2 className="text-lg font-semibold">{t("securityPage.protectedTitle")}</h2>
          <p className="mt-2 text-sm text-brand-panel-foreground/80">{t("securityPage.protectedBody")}</p>
          <Button asChild variant="secondary" className="mt-6">
            <Link to="/wallet/security">
              {t("securityPage.addPasskeyCta")}
              <ArrowUpRight className="h-3.5 w-3.5" />
            </Link>
          </Button>
        </PageCard>

        <PageCard>
          <h2 className="text-lg font-semibold">{t("securityPage.recoveryMapTitle")}</h2>
          <ul className="mt-4 space-y-3">
            {recoveryItems.map(({ label, tone, detail }) => (
              <li key={label} className="flex items-center justify-between gap-3 text-sm">
                <span className="font-medium">{label}</span>
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground">{detail}</span>
                  <StatusBadge tone={tone}>{detail === t("securityPage.notAdded") ? t("securityPage.notAdded") : tone === "verified" ? t("securityPage.verified") : t("securityPage.active")}</StatusBadge>
                </div>
              </li>
            ))}
          </ul>
          <Button asChild variant="secondary" className="mt-6">
            <Link to="/wallet/recover">{t("securityPage.reviewRecoveryCta")}</Link>
          </Button>
        </PageCard>
      </PageSplit>

      <TrustNotice className="mt-8">{t("securityPage.transparencyNotice")}</TrustNotice>
    </div>
  );
}
