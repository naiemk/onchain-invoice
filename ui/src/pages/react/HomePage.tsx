import { Link, useNavigate } from "react-router-dom";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useLocale } from "@/providers/LocaleProvider";
import { deploymentMode, networksForDeployment } from "@/shared/networks.js";
import { saveWalletMode } from "@/shared/wallet-mode.js";
import { cn } from "@/lib/utils";
import { PLATFORM_INTEGRATIONS } from "@/shared/integrations.js";
import { ArrowRight, Wallet } from "lucide-react";

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
    <div className="mx-auto max-w-6xl px-4 pb-16 pt-8 md:px-8 md:pt-12">
      {/* Hero */}
      <section className="grid gap-10 lg:grid-cols-2 lg:items-center lg:gap-16">
        <div className="space-y-6">
          <p className="text-sm font-medium uppercase tracking-wider text-primary">{t("brand")}</p>
          <h1 className="font-display text-4xl font-semibold leading-tight tracking-tight md:text-5xl">{t("home.h1")}</h1>
          <p className="text-lg text-muted-foreground">{t("home.lede")}</p>
          <div className="flex flex-wrap gap-3">
            <Button asChild size="lg">
              <Link to="/wallet">{t("home.ctaOpenWallet")}</Link>
            </Button>
            <Button asChild variant="secondary" size="lg">
              <Link to="/create">{t("home.ctaCreate")}</Link>
            </Button>
          </div>
          <p className="flex flex-wrap gap-2 text-sm text-muted-foreground" aria-label={t("home.trustRowLabel")}>
            <span>{t("home.trustPasskey")}</span>
            <span aria-hidden="true">·</span>
            <span>{t("home.trustStables")}</span>
            <span aria-hidden="true">·</span>
            <span>{chainLabels || t("home.trustChainsFallback")}</span>
          </p>
        </div>
        <Card className="border-brand-panel/20 bg-brand-panel text-brand-panel-foreground shadow-xl">
          <CardHeader className="pb-2">
            <CardDescription className="text-brand-panel-foreground/70">{t("home.heroBalanceLabel")}</CardDescription>
            <p className="font-display text-4xl font-semibold">
              12,480.00 <span className="text-lg font-sans font-normal opacity-70">USD</span>
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap gap-2">
              {[t("home.heroActionGetPaid"), t("home.heroActionPay"), t("home.heroActionCashIn")].map((label) => (
                <Badge key={label} variant="secondary" className="bg-white/10 text-brand-panel-foreground hover:bg-white/15">
                  {label}
                </Badge>
              ))}
            </div>
            <ul className="space-y-2 text-sm">
              <li className="flex justify-between"><span className="text-ok">{t("home.heroActivityPaid")}</span><span>+240.00</span></li>
              <li className="flex justify-between"><span>{t("home.heroActivityDeposit")}</span><span>+500.00</span></li>
              <li className="flex justify-between"><span>{t("home.heroActivitySent")}</span><span>−85.00</span></li>
            </ul>
          </CardContent>
        </Card>
      </section>

      {/* Mode chooser */}
      <section className="mt-20 space-y-6" id="modes">
        <div className="max-w-2xl">
          <p className="text-sm font-medium uppercase tracking-wider text-primary">{t("home.modeEyebrow")}</p>
          <h2 className="mt-2 text-3xl font-semibold tracking-tight">{t("home.modeTitle")}</h2>
          <p className="mt-2 text-muted-foreground">{t("home.modeLede")}</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          {(["simple", "advanced"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => selectMode(m)}
              className={cn(
                "rounded-xl border-2 p-6 text-left transition-all hover:shadow-md",
                mode === m
                  ? "border-primary bg-primary text-primary-foreground shadow-lg ring-2 ring-primary/30"
                  : "border-border bg-card hover:border-primary/30"
              )}
            >
              <h3 className="text-lg font-semibold">{m === "simple" ? t("home.modeSoloTitle") : t("home.modeTeamTitle")}</h3>
              <p className={cn("mt-2 text-sm", mode === m ? "text-primary-foreground/85" : "text-muted-foreground")}>{m === "simple" ? t("home.modeSoloBody") : t("home.modeTeamBody")}</p>
              <span className="mt-4 inline-flex items-center gap-1 text-sm font-medium">
                {m === "simple" ? t("home.modeSoloCta") : t("home.modeTeamCta")}
                <ArrowRight className="h-4 w-4" />
              </span>
            </button>
          ))}
        </div>
        <p className="rounded-lg bg-muted/50 px-4 py-3 text-sm text-muted-foreground">
          {mode === "simple" ? t("home.modeSoloPreview") : t("home.modeTeamPreview")}
        </p>
      </section>

      {/* Jobs bento */}
      <section className="mt-20 space-y-6" id="jobs">
        <div>
          <p className="text-sm font-medium uppercase tracking-wider text-primary">{t("home.jobsEyebrow")}</p>
          <h2 className="mt-2 text-3xl font-semibold tracking-tight">{t("home.jobsTitle")}</h2>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          {jobs.map(({ href, title, body }) => (
            <Link key={href} to={href} className="group no-underline hover:no-underline">
              <Card className="h-full transition-all group-hover:border-primary/40 group-hover:shadow-md">
                <CardHeader>
                  <CardTitle className="text-lg">{title}</CardTitle>
                  <CardDescription>{body}</CardDescription>
                </CardHeader>
              </Card>
            </Link>
          ))}
        </div>
      </section>

      {/* Fiat band */}
      <section className="mt-20 rounded-2xl bg-brand-panel px-8 py-10 text-brand-panel-foreground">
        <h2 className="text-2xl font-semibold">{t("home.fiatTitle")}</h2>
        <p className="mt-2 max-w-xl text-brand-panel-foreground/80">{t("home.fiatBody")}</p>
        <Button asChild variant="secondary" className="mt-6">
          <Link to="/wallet/cash">{t("home.fiatCta")}</Link>
        </Button>
      </section>

      {/* Security band */}
      <section className="mt-20">
        <Card className="border-brand-panel/30 bg-brand-panel text-brand-panel-foreground">
          <CardHeader>
            <p className="text-sm font-medium uppercase tracking-wider text-primary-foreground/70">{t("home.trustEyebrow")}</p>
            <CardTitle className="text-2xl text-brand-panel-foreground">{t("home.trustTitle")}</CardTitle>
            <CardDescription className="text-brand-panel-foreground/80">{t("home.trustBody")}</CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild variant="secondary">
              <Link to="/security">{t("home.trustCta")}</Link>
            </Button>
          </CardContent>
        </Card>
      </section>

      {/* Integrations strip */}
      <section className="mt-20 space-y-6" id="integrations">
        <div className="max-w-2xl">
          <p className="text-sm font-medium uppercase tracking-wider text-primary">{t("home.integrationsEyebrow")}</p>
          <h2 className="mt-2 text-3xl font-semibold tracking-tight">{t("home.integrationsTitle")}</h2>
          <p className="mt-2 text-muted-foreground">{t("home.integrationsLede")}</p>
        </div>
        <div className="flex flex-wrap gap-4">
          {PLATFORM_INTEGRATIONS.slice(0, 7).map((p) => (
            <Link key={p.id} to={`/integrations#platform-${p.id}`} className="rounded-lg border bg-card p-3 transition hover:border-primary/40">
              <img src={p.logo} alt={p.id} className="h-8 w-auto object-contain" loading="lazy" />
            </Link>
          ))}
        </div>
        <Button asChild variant="outline">
          <Link to="/integrations">{t("home.integrationsCta")}</Link>
        </Button>
      </section>

      {/* Final CTA */}
      <section className="mt-20 text-center">
        <h2 className="text-3xl font-semibold tracking-tight">{t("home.readyTitle")}</h2>
        <p className="mx-auto mt-2 max-w-lg text-muted-foreground">{t("home.readyLede")}</p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <Button asChild size="lg">
            <Link to="/wallet"><Wallet className="mr-2 h-4 w-4" />{t("home.ctaOpenWallet")}</Link>
          </Button>
          <Button asChild variant="secondary" size="lg">
            <Link to="/create">{t("home.ctaCreate")}</Link>
          </Button>
        </div>
      </section>
    </div>
  );
}
