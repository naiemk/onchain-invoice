import { useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useLocale } from "@/providers/LocaleProvider";
import { createCounterfactualWallet } from "@/shared/wallet-create.js";
import { webAuthnSupported } from "@/shared/webauthn.js";
import { copyText } from "@/shared/dom.js";
import { WalletFrame } from "./WalletFrame";

export function CreatePage() {
  const { t } = useLocale();
  const [deviceName, setDeviceName] = useState("");
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<{ kind: "info" | "error" | "success"; message: string } | null>(null);
  const [address, setAddress] = useState<string | null>(null);
  const supported = webAuthnSupported();

  const runCreate = async () => {
    const label = deviceName.trim() || t("wallet.defaultDevice");
    setLoading(true);
    setStatus({ kind: "info", message: t("wallet.creatingPasskey") });
    try {
      const result = await createCounterfactualWallet(label);
      setAddress(result.address);
      setStatus({ kind: "success", message: t("wallet.createdCounterfactual") });
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
    <WalletFrame current="create" title={t("wallet.createTitle")} lede={t("wallet.createLede")}>
      <Alert className="mb-6">
        <AlertDescription>{t("wallet.counterfactualCallout")}</AlertDescription>
      </Alert>
      <div className="space-y-2">
        <Label htmlFor="device-name">{t("wallet.deviceName")}</Label>
        <p className="text-sm text-muted-foreground">{t("wallet.deviceNameHint")}</p>
        <Input
          id="device-name"
          data-testid="device-name"
          type="text"
          placeholder={t("wallet.deviceNamePlaceholder")}
          value={deviceName}
          onChange={(e) => setDeviceName(e.target.value)}
        />
      </div>
      <p className="mt-4 text-sm text-muted-foreground">
        {supported ? t("wallet.webauthnOk") : t("wallet.webauthnNo")}
      </p>
      <div className="mt-6 flex flex-wrap gap-3">
        <Button
          id="wallet-create-btn"
          data-testid="wallet-create-btn"
          type="button"
          disabled={loading}
          onClick={() => void runCreate()}
        >
          {loading ? t("wallet.creatingPasskey") : t("wallet.createPasskey")}
        </Button>
        <Button asChild variant="outline">
          <Link to="/wallet">{t("wallet.cancel")}</Link>
        </Button>
      </div>
      {address && (
        <div id="wallet-create-result" className="mt-8 space-y-4">
          <h2 className="text-lg font-semibold">{t("wallet.yourAddress")}</h2>
          <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/40 p-3">
            <code id="created-address" className="break-all font-mono text-sm">
              {address}
            </code>
            <Button type="button" variant="outline" size="sm" onClick={() => void copyText(address)}>
              {t("wallet.copy")}
            </Button>
          </div>
          <Button asChild>
            <Link to="/wallet">{t("wallet.goToWallet")}</Link>
          </Button>
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
    </WalletFrame>
  );
}
