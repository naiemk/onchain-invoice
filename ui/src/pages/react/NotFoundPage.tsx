import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { PageHero } from "@/components/PageHero";
import { useLocale } from "@/providers/LocaleProvider";

export function NotFoundPage() {
  const { t } = useLocale();
  return (
    <div className="mx-auto max-w-5xl px-4 py-10 md:px-8">
      <PageHero breadcrumb="404" title={t("notFound.title")} lede={t("notFound.lede")} />
      <Button asChild size="lg">
        <Link to="/">{t("notFound.home")}</Link>
      </Button>
    </div>
  );
}
