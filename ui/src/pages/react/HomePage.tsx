import { Link, useNavigate } from "react-router-dom";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ActionTile } from "@/components/ActionTile";
import { Band, Surface } from "@/components/Surface";
import { Money } from "@/components/Money";
import { useLocale } from "@/providers/LocaleProvider";
import { deploymentMode, networksForDeployment } from "@/shared/networks.js";
import { saveWalletMode } from "@/shared/wallet-mode.js";
import { cn } from "@/lib/utils";
import { PLATFORM_INTEGRATIONS } from "@/shared/integrations.js";
import { ArrowRight } from "lucide-react";

export function HomePage() {
  const { t } = useLocale();
  const navigate = useNavigate();
  const [mode, setMode] = useState<"simple" | "advanced">("simple");
  const networks = networksForDeployment(deploymentMode());
  const chainLabels = networks
    .filter((n) => n.enabled !== false)
    .slice(0, 4)
    .map((n) => n.short)
    .join(" · ");

  const selectMode = (next: "simple" | "advanced") => {
    setMode(next);
    saveWalletMode(next);
    navigate(next === "advanced" ? "/wallet/super-wallet" : "/wallet");
  };

  const jobs = [
    { href: "/get-paid", title: t("home.jobGetPaidTitle"), body: t("home.jobGetPaidBody") },
    { href: "/wallet/send", title: t("home.jobPayTitle"), body: t("home.jobPayBody") },
    { href: "/wallet/cash", title: t("home.jobCashTitle"), body: t("home.jobCashBody") },
    { href: "/security", title: t("home.jobSecureTitle"), body: t("home.jobSecureBody") },
  ];

  return (
    <div className="mx-auto max-w-5xl px-4 pb-14 pt-8 md:px-8 md:pt-10">
      <section className="grid gap-8 lg:grid-cols-2 lg:items-center lg:gap-12">
        <div className="space-y-5">
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{t("brand")}</p>
          <h1 className="text-3xl font-semibold leading-tight tracking-tight md:text-4xl">{t("home.h1")}</h1>
          <p className="max-w-md text-sm text-muted-foreground md:text-base">{t("home.lede")}</p>
          <div className="flex flex-wrap gap-2">
            <Button asChild size="lg">
              <Link to="/wallet">{t("home.ctaOpenWallet")}</Link>
            </Button>
            <Button asChild variant="outline" size="lg">
              <Link to="/create">{t("home.ctaCreate")}</Link>
            </Button>
          </div>
          <p className="flex flex-wrap gap-2 text-xs text-muted-foreground" aria-label={t("home.trustRowLabel")}>
            <span>{t("home.trustPasskey")}</span>
            <span aria-hidden="true">·</span>
            <span>{t("home.trustStables")}</span>
            <span aria-hidden="true">·</span>
            <span>{chainLabels || t("home.trustChainsFallback")}</span>
          </p>
        </div>
        <Surface className="bg-brand-panel p-5 text-brand-panel-foreground">
          <p className="text-xs text-brand-panel-foreground/70">{t("home.heroBalanceLabel")}</p>
          <div className="mt-1">
            <Money amount="12,480.00" className="text-brand-panel-foreground" size="lg" />
          </div>
          <div className="mt-4 flex flex-wrap gap-1.5">
            {[t("home.heroActionGetPaid"), t("home.heroActionPay"), t("home.heroActionCashIn")].map((label) => (
              <Badge key={label} variant="secondary" className="bg-white/10 text-brand-panel-foreground hover:bg-white/15">
                {label}
              </Badge>
            ))}
          </div>
          <ul className="mt-4 space-y-1.5 text-sm">
            <li className="flex justify-between"><span className="text-ok">{t("home.heroActivityPaid")}</span><span>+240.00</span></li>
            <li className="flex justify-between"><span className="text-brand-panel-foreground/80">{t("home.heroActivityDeposit")}</span><span>+500.00</span></li>
            <li className="flex justify-between"><span className="text-brand-panel-foreground/80">{t("home.heroActivitySent")}</span><span>−85.00</span></li>
          </ul>
        </Surface>
      </section>

      <section className="mt-16 space-y-4" id="modes">
        <div className="max-w-xl">
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{t("home.modeEyebrow")}</p>
          <h2 className="mt-1 text-2xl font-semibold tracking-tight">{t("home.modeTitle")}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{t("home.modeLede")}</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {(["simple", "advanced"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => selectMode(m)}
              className={cn(
                "rounded-lg border p-4 text-left transition-colors",
                mode === m
                  ? "border-primary bg-muted/60 ring-1 ring-primary/25"
                  : "border-border bg-card hover:border-primary/30"
              )}
            >
              <h3 className="text-sm font-semibold">{m === "simple" ? t("home.modeSoloTitle") : t("home.modeTeamTitle")}</h3>
              <p className="mt-1.5 text-sm text-muted-foreground">
                {m === "simple" ? t("home.modeSoloBody") : t("home.modeTeamBody")}
              </p>
              <span className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-primary">
                {m === "simple" ? t("home.modeSoloCta") : t("home.modeTeamCta")}
                <ArrowRight className="h-3.5 w-3.5" />
              </span>
            </button>
          ))}
        </div>
        <p className="text-sm text-muted-foreground">
          {mode === "simple" ? t("home.modeSoloPreview") : t("home.modeTeamPreview")}
        </p>
      </section>

      <section className="mt-16 space-y-4" id="jobs">
        <div>
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{t("home.jobsEyebrow")}</p>
          <h2 className="mt-1 text-2xl font-semibold tracking-tight">{t("home.jobsTitle")}</h2>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {jobs.map(({ href, title, body }) => (
            <ActionTile key={href} href={href} title={title} description={body} />
          ))}
        </div>
      </section>

      <Band className="mt-16">
        <h2 className="text-xl font-semibold">{t("home.fiatTitle")}</h2>
        <p className="mt-2 max-w-lg text-sm text-brand-panel-foreground/80">{t("home.fiatBody")}</p>
        <Button
          asChild
          variant="outline"
          className="mt-5 border-brand-panel-foreground/25 bg-transparent text-brand-panel-foreground hover:bg-brand-panel-foreground/10 hover:text-brand-panel-foreground"
        >
          <Link to="/wallet/cash">{t("home.fiatCta")}</Link>
        </Button>
      </Band>

      <Band className="mt-6">
        <p className="text-xs font-medium uppercase tracking-wider text-brand-panel-foreground/60">{t("home.trustEyebrow")}</p>
        <h2 className="mt-1 text-xl font-semibold">{t("home.trustTitle")}</h2>
        <p className="mt-2 max-w-lg text-sm text-brand-panel-foreground/80">{t("home.trustBody")}</p>
        <Button
          asChild
          variant="outline"
          className="mt-5 border-brand-panel-foreground/25 bg-transparent text-brand-panel-foreground hover:bg-brand-panel-foreground/10 hover:text-brand-panel-foreground"
        >
          <Link to="/security">{t("home.trustCta")}</Link>
        </Button>
      </Band>

      <section className="mt-16 space-y-4" id="integrations">
        <div className="max-w-xl">
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{t("home.integrationsEyebrow")}</p>
          <h2 className="mt-1 text-2xl font-semibold tracking-tight">{t("home.integrationsTitle")}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{t("home.integrationsLede")}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {PLATFORM_INTEGRATIONS.slice(0, 7).map((p) => (
            <Link
              key={p.id}
              to={`/integrations#platform-${p.id}`}
              className="rounded-md border border-border bg-card px-3 py-2 grayscale transition hover:border-primary/30 hover:grayscale-0"
            >
              <img src={p.logo} alt={p.id} className="h-6 w-auto object-contain" loading="lazy" />
            </Link>
          ))}
        </div>
        <Button asChild variant="outline" size="sm">
          <Link to="/integrations">{t("home.integrationsCta")}</Link>
        </Button>
      </section>

      <section className="mt-16 text-center">
        <h2 className="text-2xl font-semibold tracking-tight">{t("home.readyTitle")}</h2>
        <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">{t("home.readyLede")}</p>
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          <Button asChild>
            <Link to="/wallet">{t("home.ctaOpenWallet")}</Link>
          </Button>
          <Button asChild variant="outline">
            <Link to="/create">{t("home.ctaCreate")}</Link>
          </Button>
        </div>
      </section>
    </div>
  );
}
