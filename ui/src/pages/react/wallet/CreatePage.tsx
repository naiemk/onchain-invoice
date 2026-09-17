import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageCard } from "@/components/PageSplit";
import { useLocale } from "@/providers/LocaleProvider";
import { createAnotherIdentityWallet } from "@/shared/wallet-create.js";
import { fetchIdentityMe, loginIdentityPasskey } from "@/shared/identity-api.js";
import { listWalletRegistry, loadWalletSession } from "@/shared/webauthn.js";
import { copyText } from "@/shared/dom.js";
import { deploymentMode } from "@/shared/networks.js";
import { WalletFrame } from "./WalletFrame";

export function CreatePage() {
  const { t } = useLocale();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [canCreate, setCanCreate] = useState(false);
  const [status, setStatus] = useState<{ kind: "info" | "error" | "success"; message: string } | null>(null);
  const [address, setAddress] = useState<string | null>(null);
  const mode = deploymentMode();
  const session = loadWalletSession();

  useEffect(() => {
    void (async () => {
      try {
        const credentialId =
          loadWalletSession()?.credentialId?.trim() ||
          listWalletRegistry().find((w) => w.credentialId?.trim())?.credentialId?.trim();
        if (credentialId) setCanCreate(true);
        if (credentialId) {
          await loginIdentityPasskey(credentialId).catch(() => undefined);
        }
        const me = await fetchIdentityMe();
        if (!me && !credentialId) {
          setStatus({ kind: "error", message: t("wallet.createNeedSignIn") });
          return;
        }
        if (me && me.methods.webauthn < 1) {
          setStatus({ kind: "error", message: t("wallet.createNeedPasskey") });
          return;
        }
        setCanCreate(true);
      } catch (error) {
        setStatus({
          kind: "error",
          message: error instanceof Error ? error.message : String(error),
        });
      }
    })();
  }, [t]);

  const runCreate = async () => {
    const label = name.trim() || t("wallet.defaultWalletName");
    setLoading(true);
    setStatus({ kind: "info", message: t("wallet.creatingWallet") });
    try {
      const result = await createAnotherIdentityWallet(label);
      setAddress(result.address);
      setStatus({ kind: "success", message: t("wallet.createdCounterfactual") });
      navigate("/wallet", { replace: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStatus({ kind: "error", message });
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
      showChrome={Boolean(session)}
    >
      <PageCard className="mx-auto max-w-lg">
        <div className="space-y-2">
          <Label htmlFor="device-name">{t("wallet.walletName")}</Label>
          <p className="text-sm text-muted-foreground">{t("wallet.walletNameHint")}</p>
          <Input
            id="device-name"
            data-testid="device-name"
            type="text"
            placeholder={t("wallet.walletNamePlaceholder")}
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={!canCreate || loading}
          />
        </div>

        <Button
          id="wallet-create-btn"
          data-testid="wallet-create-btn"
          type="button"
          className="mt-6 w-full"
          size="lg"
          disabled={!canCreate || loading}
          onClick={() => void runCreate()}
        >
          {loading ? t("wallet.creatingWallet") : t("wallet.createWallet")}
        </Button>

        <p className="mt-4 text-xs text-muted-foreground">
          {t("wallet.createOtherOptions")}{" "}
          <Link to="/wallet" className="underline underline-offset-2">
            {t("wallet.cancel")}
          </Link>
        </p>

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
