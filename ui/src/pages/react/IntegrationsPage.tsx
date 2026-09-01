import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useLocale } from "@/providers/LocaleProvider";
import { integrationsByWave, PLATFORM_INTEGRATIONS, type PlatformIntegration } from "@/shared/integrations.js";
import { SITE } from "@/shared/site.js";
import type { MessageKey } from "@/i18n/t.js";

function PlatformCard({ platform }: { platform: PlatformIntegration }) {
  const { t } = useLocale();
  const name = t(`integrations.platforms.${platform.id}.name` as MessageKey);
  const description = t(`integrations.platforms.${platform.id}.description` as MessageKey);

  return (
    <Card id={`platform-${platform.id}`} className="overflow-hidden">
      <div className="border-b bg-muted/30 p-6">
        <img src={platform.logo} alt={name} className="h-10 w-auto object-contain" loading="lazy" />
      </div>
      <CardHeader>
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="text-lg">{name}</CardTitle>
          <Badge variant={platform.status === "available" ? "ok" : "secondary"}>
            {platform.status === "available" ? t("integrations.statusAvailable") : t("integrations.statusPreview")}
          </Badge>
        </div>
        <CardDescription className="text-base">{description}</CardDescription>
      </CardHeader>
      <CardContent className="flex gap-2 text-sm">
        <a href={platform.docsUrl} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
          {t("integrations.docs")}
        </a>
        <span aria-hidden="true">·</span>
        <a
          href={platform.skillUrl.replace("/blob/", "/raw/")}
          rel="alternate noopener noreferrer"
          target="_blank"
          className="text-primary hover:underline"
        >
          {t("integrations.aiSkill")}
        </a>
      </CardContent>
    </Card>
  );
}

function WaveSection({ wave, titleKey }: { wave: 1 | 2 | 3; titleKey: MessageKey }) {
  const { t } = useLocale();
  const items = integrationsByWave(wave);
  if (items.length === 0) return null;
  return (
    <section className="space-y-6" id={`wave-${wave}`}>
      <h2 className="text-2xl font-semibold tracking-tight">{t(titleKey)}</h2>
      <div className="grid gap-4 md:grid-cols-2">
        {items.map((p) => (
          <PlatformCard key={p.id} platform={p} />
        ))}
      </div>
    </section>
  );
}

export function IntegrationsPage() {
  const { t } = useLocale();

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 md:px-8">
      <header className="mb-12 max-w-2xl space-y-2">
        <p className="text-sm font-medium uppercase tracking-wider text-primary">{t("integrations.eyebrow")}</p>
        <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">{t("integrations.title")}</h1>
        <p className="text-lg text-muted-foreground">{t("integrations.lede")}</p>
      </header>

      <Card className="mb-16" id="contract">
        <CardHeader>
          <p className="text-sm font-medium uppercase tracking-wider text-primary">{t("integrations.contractEyebrow")}</p>
          <CardTitle>{t("integrations.contractTitle")}</CardTitle>
          <CardDescription className="text-base">{t("integrations.contractBody")}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2 text-sm">
          <a href={SITE.platformIntegrationDocsUrl} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
            {t("integrations.contractLink")}
          </a>
          <span aria-hidden="true">·</span>
          <a href={SITE.githubPlatformsUrl} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
            {t("integrations.sdkLink")}
          </a>
        </CardContent>
      </Card>

      <div className="space-y-16">
        <WaveSection wave={1} titleKey="integrations.wave1" />
        <WaveSection wave={2} titleKey="integrations.wave2" />
        <WaveSection wave={3} titleKey="integrations.wave3" />
      </div>

      <section className="mt-16 text-center">
        <h2 className="text-2xl font-semibold">{t("integrations.ctaTitle")}</h2>
        <p className="mx-auto mt-2 max-w-lg text-muted-foreground">{t("integrations.ctaLede")}</p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <Button asChild>
            <Link to="/create">{t("home.ctaCreate")}</Link>
          </Button>
          <Button asChild variant="secondary">
            <a href={SITE.agentSkillUrl} rel="alternate noopener noreferrer" target="_blank">
              {t("nav.aiSkill")}
            </a>
          </Button>
        </div>
      </section>
    </div>
  );
}
