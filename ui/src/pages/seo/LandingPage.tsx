import { Link } from "react-router-dom";
import { ArrowUpRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHero } from "@/components/PageHero";
import { PageCard } from "@/components/PageSplit";
import { SITE } from "@/shared/site";
import { trackEvent } from "@/shared/analytics";
import { LANDING_PAGES, ROADMAP_URL, type LandingContent } from "./landing-content";

function CtaLink({ cta, variant, page }: { cta: { label: string; to: string; external?: boolean }; variant?: "secondary"; page: string }) {
  const onClick = () => {
    trackEvent("seo_cta_clicked", { page, cta: cta.label });
    if (cta.to.startsWith("/create")) trackEvent("invoice_create_started", { source: page });
    if (cta.external && cta.to.includes("woocommerce")) trackEvent("integration_guide_opened", { platform: "woocommerce" });
    if (cta.external && cta.to.startsWith(SITE.docsUrl)) trackEvent("developer_docs_opened", { source: page });
  };
  return (
    <Button asChild size="lg" variant={variant}>
      {cta.external ? (
        <a href={cta.to} onClick={onClick} target="_blank" rel="noopener noreferrer">
          {cta.label}
          <ArrowUpRight className="h-4 w-4" />
        </a>
      ) : (
        <Link to={cta.to} onClick={onClick}>{cta.label}</Link>
      )}
    </Button>
  );
}

export function LandingPage({ content }: { content: LandingContent }) {
  const faqLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: content.faq.map((f) => ({
      "@type": "Question",
      name: f.q,
      acceptedAnswer: { "@type": "Answer", text: f.a },
    })),
  };
  const crumbs = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: `${SITE.origin}/` },
      { "@type": "ListItem", position: 2, name: content.eyebrow, item: `${SITE.origin}${content.path}` },
    ],
  };
  return (
    <div className="mx-auto max-w-5xl px-4 pb-14 pt-10 md:px-8">
      <PageHero breadcrumb={content.eyebrow} title={content.h1} lede={content.lede} />
      <div className="flex flex-wrap gap-3">
        <CtaLink cta={content.primaryCta} page={content.path} />
        <CtaLink cta={content.secondaryCta} variant="secondary" page={content.path} />
      </div>

      <section className="mt-16 space-y-4">
        <h2 className="text-2xl font-semibold tracking-tight">How it works</h2>
        <ol className="grid gap-4 md:grid-cols-2">
          {content.steps.map((s, i) => (
            <li key={s.title}>
              <PageCard className="h-full">
                <p className="text-xs font-semibold text-emphasis">Step {i + 1}</p>
                <h3 className="mt-1 text-base font-semibold">{s.title}</h3>
                <p className="mt-2 text-sm text-muted-foreground">{s.body}</p>
              </PageCard>
            </li>
          ))}
        </ol>
      </section>

      <section className="mt-16 grid gap-4 md:grid-cols-3">
        {content.points.map((p) => (
          <PageCard key={p.title}>
            <h2 className="text-base font-semibold">{p.title}</h2>
            <p className="mt-2 text-sm text-muted-foreground">{p.body}</p>
          </PageCard>
        ))}
      </section>

      <section className="mt-16 space-y-4">
        <h2 className="text-2xl font-semibold tracking-tight">Questions</h2>
        <dl className="space-y-4">
          {content.faq.map((f) => (
            <div key={f.q}>
              <dt className="text-base font-semibold">{f.q}</dt>
              <dd className="mt-1 text-sm text-muted-foreground">{f.a}</dd>
            </div>
          ))}
        </dl>
        <p className="text-sm text-muted-foreground">
          Rollout status:{" "}
          <a className="underline" href={ROADMAP_URL} target="_blank" rel="noopener noreferrer">
            public roadmap
          </a>
          {" · "}
          <Link className="underline" to="/risks">
            Risks
          </Link>
        </p>
      </section>

      <nav className="mt-16" aria-label="Related">
        <h2 className="text-base font-semibold">Related</h2>
        <ul className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-sm">
          {content.related.map((r) => {
            const label = LANDING_PAGES.find((p) => p.path === r)?.eyebrow ?? r.slice(1).replace(/-/g, " ");
            return (
              <li key={r}>
                <Link className="underline underline-offset-4" to={r}>
                  {label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqLd) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(crumbs) }} />
    </div>
  );
}
