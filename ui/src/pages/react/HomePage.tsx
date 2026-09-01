import { Link, useNavigate } from "react-router-dom";
import { ArrowUpRight, Banknote, FileText, Lock, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHero } from "@/components/PageHero";
import { PageCard } from "@/components/PageSplit";
import { Money } from "@/components/Money";
import { useLocale } from "@/providers/LocaleProvider";
import { deploymentMode } from "@/shared/networks.js";
import { saveWalletMode } from "@/shared/wallet-mode.js";
import { SITE } from "@/shared/site.js";
import { cn } from "@/lib/utils";

export function HomePage() {
  const { t } = useLocale();
  const navigate = useNavigate();
  const mode = deploymentMode();

  const loop = [
    {
      icon: Banknote,
      title: t("home.loopStablecoinsTitle"),
      body: t("home.loopStablecoinsBody"),
      href: "/wallet/receive",
    },
    {
      icon: FileText,
      title: t("home.loopInvoicesTitle"),
      body: t("home.loopInvoicesBody"),
      href: "/create",
    },
    {
      icon: Wallet,
      title: t("home.loopCashTitle"),
      body: t("home.loopCashBody"),
      href: "/wallet/cash",
    },
  ];

  return (
    <div className="mx-auto max-w-5xl px-4 pb-14 pt-10 md:px-8">
      <section className="grid gap-10 lg:grid-cols-2 lg:items-center">
        <div>
          <PageHero
            breadcrumb={t("home.eyebrow")}
            title={
              <>
                The wallet you run{" "}
                <span className="text-emphasis">business from.</span>
              </>
            }
            lede={t("home.lede")}
          />
          <div className="flex flex-wrap gap-3">
            <Button asChild size="lg">
              <Link to="/wallet/create">
                {t("home.ctaCreateWallet")}
                <ArrowUpRight className="h-4 w-4" />
              </Link>
            </Button>
            <Button asChild variant="secondary" size="lg">
              <a href={SITE.docsUrl} target="_blank" rel="noopener noreferrer">
                {t("home.ctaFieldGuide")}
              </a>
            </Button>
          </div>
        </div>

        <div className="rounded-2xl bg-brand-panel p-6 text-brand-panel-foreground shadow-sm">
          <div className="flex items-center justify-between gap-2">
            <span className="rounded-full bg-brand-panel-foreground/10 px-2.5 py-0.5 text-[10px] font-medium uppercase tracking-wide">
              {t("home.heroWalletPill", { mode: mode === "testnet" ? t("common.testnet") : t("common.mainnet") })}
            </span>
          </div>
          <p className="mt-4 text-xs text-brand-panel-foreground/70">{t("home.heroBalanceLabel")}</p>
          <div className="mt-1">
            <Money amount="12,840.60" className="text-brand-panel-foreground" size="lg" />
          </div>
          <p className="mt-1 text-sm text-brand-panel-foreground/70">{t("home.heroBalanceNetwork")}</p>
          <p className="mt-6 flex items-center gap-1.5 text-sm text-brand-panel-foreground/80">
            <ArrowUpRight className="h-4 w-4 text-ok" />
            {t("home.heroSettledMonth")}
          </p>
        </div>
      </section>

      <section className="mt-20 space-y-6" id="loop">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-emphasis">{t("home.loopEyebrow")}</p>
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          {loop.map(({ icon: Icon, title, body, href }) => (
            <Link
              key={href}
              to={href}
              className="group rounded-xl border border-border bg-card p-5 shadow-sm transition-colors hover:border-primary/30"
            >
              <Icon className="mb-3 h-5 w-5 text-emphasis" aria-hidden />
              <h2 className="text-base font-semibold">{title}</h2>
              <p className="mt-2 text-sm text-muted-foreground">{body}</p>
            </Link>
          ))}
        </div>
      </section>

      <section className="mt-20 space-y-4" id="modes">
        <div className="max-w-xl">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-emphasis">{t("home.modeEyebrow")}</p>
          <h2 className="mt-2 text-2xl font-semibold tracking-tight">{t("home.modeTitle")}</h2>
          <p className="mt-2 text-sm text-muted-foreground">{t("home.modeLede")}</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {(["simple", "advanced"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => {
                saveWalletMode(m);
                navigate(m === "advanced" ? "/wallet/super-wallet" : "/wallet");
              }}
              className={cn(
                "rounded-xl border border-border bg-card p-5 text-left shadow-sm transition-colors hover:border-primary/30"
              )}
            >
              <h3 className="text-sm font-semibold">
                {m === "simple" ? t("home.modeSoloTitle") : t("home.modeTeamTitle")}
              </h3>
              <p className="mt-2 text-sm text-muted-foreground">
                {m === "simple" ? t("home.modeSoloBody") : t("home.modeTeamBody")}
              </p>
              <span className="mt-4 inline-flex items-center gap-1 text-xs font-medium text-primary">
                {m === "simple" ? t("home.modeSoloCta") : t("home.modeTeamCta")}
                <ArrowUpRight className="h-3.5 w-3.5" />
              </span>
            </button>
          ))}
        </div>
      </section>

      <section className="mt-20">
        <PageCard className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <Lock className="mt-0.5 h-5 w-5 text-emphasis" aria-hidden />
            <div>
              <h2 className="text-base font-semibold">{t("home.trustTitle")}</h2>
              <p className="mt-1 max-w-lg text-sm text-muted-foreground">{t("home.trustBody")}</p>
            </div>
          </div>
          <Button asChild variant="secondary">
            <Link to="/security">{t("home.trustCta")}</Link>
          </Button>
        </PageCard>
      </section>
    </div>
  );
}
