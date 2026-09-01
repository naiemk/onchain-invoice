import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Surface } from "@/components/Surface";
import { useLocale } from "@/providers/LocaleProvider";
import { integrationsByWave, type PlatformIntegration } from "@/shared/integrations.js";
import { SITE } from "@/shared/site.js";
import type { MessageKey } from "@/i18n/t.js";

function PlatformCard({ platform }: { platform: PlatformIntegration }) {
  const { t } = useLocale();
  const name = t(`integrations.platforms.${platform.id}.name` as MessageKey);
  const description = t(`integrations.platforms.${platform.id}.description` as MessageKey);

  return (
    <Surface id={`platform-${platform.id}`} className="overflow-hidden">
      <div className="border-b border-border bg-muted/40 px-4 py-4">
        <img src={platform.logo} alt={name} className="h-8 w-auto object-contain" loading="lazy" />
      </div>
      <div className="space-y-2 p-4">
        <div className="flex items-start justify-between gap-2">
          <h3 className="text-sm font-semibold">{name}</h3>
          <Badge variant={platform.status === "available" ? "ok" : "secondary"}>
            {platform.status === "available" ? t("integrations.statusAvailable") : t("integrations.statusPreview")}
          </Badge>
        </div>
        <p className="text-sm text-muted-foreground">{description}</p>
        <div className="flex gap-2 text-sm">
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
        </div>
      </div>
    </Surface>
  );
}

function WaveSection({ wave, titleKey }: { wave: 1 | 2 | 3; titleKey: MessageKey }) {
  const { t } = useLocale();
  const items = integrationsByWave(wave);
  if (items.length === 0) return null;
  return (
    <section className="space-y-3" id={`wave-${wave}`}>
      <h2 className="text-lg font-semibold tracking-tight">{t(titleKey)}</h2>
      <div className="grid gap-3 md:grid-cols-2">
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
      <header className="mb-8 max-w-2xl space-y-1.5">
        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{t("integrations.eyebrow")}</p>
        <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">{t("integrations.title")}</h1>
        <p className="text-sm text-muted-foreground">{t("integrations.lede")}</p>
      </header>

      <Surface className="mb-12 space-y-2 p-5" id="contract">
        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{t("integrations.contractEyebrow")}</p>
        <h2 className="text-lg font-semibold">{t("integrations.contractTitle")}</h2>
        <p className="text-sm text-muted-foreground">{t("integrations.contractBody")}</p>
        <div className="flex flex-wrap gap-2 pt-1 text-sm">
          <a href={SITE.platformIntegrationDocsUrl} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
            {t("integrations.contractLink")}
          </a>
          <span aria-hidden="true">·</span>
          <a href={SITE.githubPlatformsUrl} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
            {t("integrations.sdkLink")}
          </a>
        </div>
      </Surface>

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
          <Button asChild variant="outline">
            <a href={SITE.agentSkillUrl} rel="alternate noopener noreferrer" target="_blank">
              {t("nav.aiSkill")}
            </a>
          </Button>
        </div>
      </section>
    </div>
  );
}
