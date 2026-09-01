import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { KeyRound, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageCard } from "@/components/PageSplit";
import { useLocale } from "@/providers/LocaleProvider";
import { createCounterfactualWallet } from "@/shared/wallet-create.js";
import { webAuthnSupported } from "@/shared/webauthn.js";
import { copyText } from "@/shared/dom.js";
import { deploymentMode } from "@/shared/networks.js";
import { WalletFrame } from "./WalletFrame";

export function CreatePage() {
  const { t } = useLocale();
  const navigate = useNavigate();
  const [deviceName, setDeviceName] = useState("");
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<{ kind: "info" | "error" | "success"; message: string } | null>(null);
  const [address, setAddress] = useState<string | null>(null);
  const supported = webAuthnSupported();
  const mode = deploymentMode();

  const runCreate = async () => {
    const label = deviceName.trim() || t("wallet.defaultDevice");
    setLoading(true);
    setStatus({ kind: "info", message: t("wallet.creatingPasskey") });
    try {
      const result = await createCounterfactualWallet(label);
      setAddress(result.address);
      setStatus({ kind: "success", message: t("wallet.createdCounterfactual") });
      navigate("/wallet", { replace: true });
    } catch (error) {
      setStatus({
        kind: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <WalletFrame
      current="create"
      breadcrumb={t("wallet.createBreadcrumb", { mode: mode === "testnet" ? t("common.testnet") : t("common.mainnet") })}
      title={t("wallet.createPageTitle")}
      lede={t("wallet.createPageLede")}
      showChrome={false}
    >
      <PageCard className="mx-auto max-w-lg">
        <ol className="space-y-6">
          <li className="flex gap-4">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-secondary text-sm font-semibold">1</span>
            <div className="flex-1">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h2 className="font-semibold">{t("wallet.createStepPasskey")}</h2>
                  <p className="text-sm text-muted-foreground">{t("wallet.createStepPasskeyHint")}</p>
                </div>
                <KeyRound className="h-5 w-5 text-muted-foreground" aria-hidden />
              </div>
            </div>
          </li>
          <li className="flex gap-4">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-secondary text-sm font-semibold">2</span>
            <div className="flex-1 space-y-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h2 className="font-semibold">{t("wallet.createStepWorkspace")}</h2>
                  <p className="text-sm text-muted-foreground">{t("wallet.deviceNameHint")}</p>
                </div>
                <Mail className="h-5 w-5 text-muted-foreground" aria-hidden />
              </div>
              <Input
                id="device-name"
                data-testid="device-name"
                type="text"
                placeholder={t("wallet.deviceNamePlaceholder")}
                value={deviceName}
                onChange={(e) => setDeviceName(e.target.value)}
              />
            </div>
          </li>
        </ol>

        <p className="mt-4 text-xs text-muted-foreground">
          {supported ? t("wallet.webauthnOk") : t("wallet.webauthnNo")}
        </p>

        <Button
          id="wallet-create-btn"
          data-testid="wallet-create-btn"
          type="button"
          className="mt-6 w-full"
          size="lg"
          disabled={loading || !supported}
          onClick={() => void runCreate()}
        >
          {loading ? t("wallet.creatingPasskey") : t("wallet.createTestnetWallet")}
        </Button>

        <details className="mt-4 text-xs text-muted-foreground">
          <summary className="cursor-pointer">{t("wallet.counterfactualShort")}</summary>
          <p className="mt-2">{t("wallet.counterfactualCallout")}</p>
        </details>

        {address && (
          <div id="wallet-create-result" className="mt-6 space-y-3 border-t border-border pt-6">
            <code id="created-address" className="block break-all font-mono text-sm">
              {address}
            </code>
            <div className="flex gap-2">
              <Button type="button" variant="secondary" size="sm" onClick={() => void copyText(address)}>
                {t("wallet.copy")}
              </Button>
              <Button asChild size="sm">
                <Link to="/wallet">{t("wallet.goToWallet")}</Link>
              </Button>
            </div>
          </div>
        )}

        {status && (
          <p
            role="status"
            className={`mt-4 text-sm ${
              status.kind === "error" ? "text-destructive" : status.kind === "success" ? "text-ok" : "text-muted-foreground"
            }`}
          >
            {status.message}
          </p>
        )}
      </PageCard>
    </WalletFrame>
  );
}
