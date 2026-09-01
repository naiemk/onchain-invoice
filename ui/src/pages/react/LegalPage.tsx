import { Link } from "react-router-dom";
import { PageHero } from "@/components/PageHero";
import { useLocale } from "@/providers/LocaleProvider";
import { LEGAL_DOCUMENTS, legalDocPath, type LegalDocId } from "@/legal/documents.js";

export function LegalPage({ docId }: { docId: LegalDocId }) {
  const { t } = useLocale();
  const doc = LEGAL_DOCUMENTS[docId];

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 md:px-8">
      <PageHero breadcrumb={t("legal.breadcrumb")} title={doc.title} lede={doc.lede} />

      <p className="mb-6 text-sm text-muted-foreground">
        {t("legal.lastUpdated")}: {doc.lastUpdated}. {t("legal.englishNotice")}
      </p>

      <article className="prose prose-neutral dark:prose-invert max-w-none space-y-8">
        {doc.sections.map((section) => (
          <section key={section.heading}>
            <h2 className="text-lg font-semibold">{section.heading}</h2>
            {section.paragraphs.map((paragraph) => (
              <p key={paragraph.slice(0, 48)} className="mt-3 text-sm leading-relaxed text-muted-foreground">
                {paragraph}
              </p>
            ))}
            {section.bullets && (
              <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-muted-foreground">
                {section.bullets.map((item) => (
                  <li key={item.slice(0, 48)}>{item}</li>
                ))}
              </ul>
            )}
          </section>
        ))}
      </article>

      <p className="mt-10 text-sm text-muted-foreground">
        <Link to="/legal" className="font-medium text-foreground hover:underline">
          {t("legal.hubLink")}
        </Link>
      </p>
    </div>
  );
}

export function LegalHubPage() {
  const { t } = useLocale();

  const links: {
    id: LegalDocId;
    labelKey: "footer.terms" | "footer.privacy" | "footer.cookies" | "footer.risks" | "footer.securityChecks";
  }[] = [
    { id: "terms", labelKey: "footer.terms" },
    { id: "privacy", labelKey: "footer.privacy" },
    { id: "cookies", labelKey: "footer.cookies" },
    { id: "risks", labelKey: "footer.risks" },
    { id: "security-checks", labelKey: "footer.securityChecks" },
  ];

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 md:px-8">
      <PageHero breadcrumb={t("legal.breadcrumb")} title={t("legal.hubTitle")} lede={t("legal.hubLede")} />

      <ul className="space-y-4">
        {links.map(({ id, labelKey }) => (
          <li key={id}>
            <Link
              to={legalDocPath(id)}
              className="block rounded-lg border border-border bg-card px-4 py-3 font-medium hover:bg-accent"
            >
              {t(labelKey)}
            </Link>
            <p className="mt-1 px-1 text-sm text-muted-foreground">{LEGAL_DOCUMENTS[id].lede}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}
