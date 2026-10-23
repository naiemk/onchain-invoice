import { Link, useNavigate } from "react-router-dom";
import { ArrowUpRight, Banknote, FileText, Lock, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHero } from "@/components/PageHero";
import { PageCard } from "@/components/PageSplit";
import { useLocale } from "@/providers/LocaleProvider";
import { saveWalletMode } from "@/shared/wallet-mode.js";
import { SITE } from "@/shared/site.js";
import { cn } from "@/lib/utils";

const SITE_LD = {
  "@context": "https://schema.org",
  "@graph": [
    { "@type": "Organization", name: "Trustless Commerce", url: SITE.origin, logo: `${SITE.origin}/logo.png`, sameAs: [SITE.githubUrl, SITE.telegramChannel] },
    { "@type": "WebSite", name: "Trustless Commerce", url: SITE.origin },
  ],
};

export function HomePage() {
  const { t } = useLocale();
  const navigate = useNavigate();

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
                Accept stablecoin payments.{" "}
                <span className="text-emphasis">Keep control of your money.</span>
              </>
            }
            lede="Create crypto invoices, share payment links, and integrate non-custodial checkout. Built for businesses and developers that want direct-to-wallet payments."
          />
          <div className="flex flex-wrap gap-3">
            <Button asChild size="lg">
              <Link to="/create">
                {t("home.ctaCreate")}
                <ArrowUpRight className="h-4 w-4" />
              </Link>
            </Button>
            <Button asChild variant="secondary" size="lg">
              <Link to="/developers/crypto-payment-api">Explore the API</Link>
            </Button>
            <Button asChild variant="ghost" size="lg">
              <Link to="/wallet">{t("home.ctaOpenWallet")}</Link>
            </Button>
          </div>
        </div>

        <div className="overflow-hidden rounded-2xl bg-brand-panel shadow-sm">
          <img
            src="/home-hero-get-paid.png"
            alt={t("home.heroImageAlt")}
            className="h-full w-full object-cover"
          />
        </div>
      </section>

      <section className="mt-20 space-y-4" id="use-cases">
        <h2 className="text-2xl font-semibold tracking-tight">Ways to get paid</h2>
        <div className="grid gap-4 md:grid-cols-3">
          {[
            { to: "/crypto-invoices", title: "Crypto invoices", body: "Bill a client in stablecoins and track created, paid and swept states." },
            { to: "/crypto-payment-links", title: "Payment links", body: "Share a link or embed checkout; customers pay to a unique address." },
            { to: "/developers/crypto-payment-api", title: "Payment API", body: "Create invoices with one request and poll status from your backend." },
          ].map((c) => (
            <Link key={c.to} to={c.to} className="rounded-xl border border-border bg-card p-5 shadow-sm transition-colors hover:border-primary/30">
              <h3 className="text-base font-semibold">{c.title}</h3>
              <p className="mt-2 text-sm text-muted-foreground">{c.body}</p>
            </Link>
          ))}
        </div>
        <p className="text-sm text-muted-foreground">
          Flow: create an invoice, the customer pays, the payment is detected, and the funds are swept to your address.{" "}
          <Link className="underline" to="/stablecoin-payments">
            How stablecoin payments work
          </Link>
          .
        </p>
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
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(SITE_LD) }} />
    </div>
  );
}
