import { Link } from "react-router-dom";
import { ArrowUpRight, Check, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHero } from "@/components/PageHero";
import { PageCard } from "@/components/PageSplit";
import { StatusBadge } from "@/components/StatusBadge";
import { TrustNotice } from "@/components/TrustNotice";
import { useLocale } from "@/providers/LocaleProvider";
import { PLATFORM_INTEGRATIONS, type PlatformIntegration } from "@/shared/integrations.js";
import type { MessageKey } from "@/i18n/t.js";

function PlatformCard({ platform }: { platform: PlatformIntegration }) {
  const { t } = useLocale();
  const { id, logo, docsUrl, status } = platform;
  const name = t(`integrations.platforms.${id}.name` as MessageKey);
  const description = t(`integrations.platforms.${id}.description` as MessageKey);

  return (
    <PageCard className="flex flex-col">
      <div className="mb-4 flex items-start justify-between gap-2">
        <img
          src={logo}
          alt=""
          width={40}
          height={40}
          className="h-10 w-10 rounded-lg"
        />
        <StatusBadge tone={status === "available" ? "available" : "muted"}>
          {status === "available" ? t("integrations.statusAvailable") : t("integrations.statusPreview")}
        </StatusBadge>
      </div>
      <h2 className="text-base font-semibold">{name}</h2>
      <p className="mt-2 flex-1 text-sm text-muted-foreground">{description}</p>
      <Button asChild variant="secondary" className="mt-4 w-fit" size="sm">
        <a href={docsUrl} target="_blank" rel="noopener noreferrer">
          {status === "available" ? (
            <>
              <Zap className="h-3.5 w-3.5" />
              {t("integrations.connect")}
            </>
          ) : (
            <>
              <Check className="h-3.5 w-3.5" />
              {t("integrations.manage")}
            </>
          )}
        </a>
      </Button>
    </PageCard>
  );
}

export function IntegrationsPage() {
  const { t } = useLocale();

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 md:px-8">
      <PageHero
        breadcrumb={t("integrations.breadcrumb")}
        title={t("integrations.title")}
        lede={t("integrations.lede")}
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {PLATFORM_INTEGRATIONS.map((p) => (
          <PlatformCard key={p.id} platform={p} />
        ))}
      </div>

      <TrustNotice className="mt-8">
        {t("integrations.contractBody")}{" "}
        <Link to="/security" className="font-medium text-foreground underline underline-offset-2">
          {t("integrations.contractLink")}
        </Link>
        <ArrowUpRight className="ms-1 inline h-3.5 w-3.5" />
      </TrustNotice>
    </div>
  );
}
