import { FileText, List, QrCode } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ActionTile } from "@/components/ActionTile";
import { useLocale } from "@/providers/LocaleProvider";
import { saveWalletMode } from "@/shared/wallet-mode.js";
import { useNavigate } from "react-router-dom";

export function GetPaidPage() {
  const { t } = useLocale();
  const navigate = useNavigate();

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 md:px-8">
      <header className="mb-8 space-y-1.5">
        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{t("getPaid.eyebrow")}</p>
        <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">{t("getPaid.title")}</h1>
        <p className="text-sm text-muted-foreground">{t("getPaid.lede")}</p>
      </header>
      <div className="grid gap-3 md:grid-cols-3">
        <ActionTile
          href="/create"
          icon={<FileText className="h-5 w-5" />}
          title={t("getPaid.createTitle")}
          description={t("getPaid.createBody")}
          cta={t("getPaid.createCta")}
        />
        <ActionTile
          href="/merchant"
          icon={<List className="h-5 w-5" />}
          title={t("getPaid.listTitle")}
          description={t("getPaid.listBody")}
          cta={t("getPaid.listCta")}
        />
        <ActionTile
          href="/wallet/receive"
          icon={<QrCode className="h-5 w-5" />}
          title={t("getPaid.receiveTitle")}
          description={t("getPaid.receiveBody")}
          cta={t("getPaid.receiveCta")}
        />
      </div>
      <p className="mt-6 text-sm text-muted-foreground">
        {t("getPaid.advancedHint")}{" "}
        <Button
          variant="link"
          className="h-auto p-0 text-sm"
          onClick={() => {
            saveWalletMode("advanced");
            navigate("/merchant");
          }}
        >
          {t("getPaid.switchAdvanced")}
        </Button>
      </p>
    </div>
  );
}
