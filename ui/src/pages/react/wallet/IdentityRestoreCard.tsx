import { useCallback, useEffect, useState } from "react";
import { BrowserProvider, Contract } from "ethers";
import { Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useLocale } from "@/providers/LocaleProvider";
import { fetchIdentityMe } from "@/shared/identity-api.js";
import { fetchWalletConfig } from "@/shared/wallet-api.js";
import { subscribePageVisible } from "@/shared/page-visibility.js";
import type { WalletSession } from "@/shared/wallet-session.js";

const STORE_ABI = ["function disableRestore(bytes32 identityId)"];

export function IdentityRestoreCard({ session }: { session: WalletSession }) {
  const { t } = useLocale();
  const [me, setMe] = useState<Awaited<ReturnType<typeof fetchIdentityMe>>>(null);
  const [store, setStore] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const [cfg, profile] = await Promise.all([
      fetchWalletConfig().catch(() => null),
      fetchIdentityMe().catch(() => null),
    ]);
    setStore(cfg?.identityStoreAddress ?? null);
    setMe(profile);
    setLoaded(true);
  }, []);

  useEffect(() => {
    void reload();
  }, [reload, session.address]);

  useEffect(() => {
    return subscribePageVisible(() => {
      void reload();
    });
  }, [reload]);

  useEffect(() => {
    if ((me?.methods.eoa ?? 0) > 0) return;
    const id = window.setInterval(() => {
      void reload();
    }, 2_000);
    return () => window.clearInterval(id);
  }, [me?.methods.eoa, reload]);

  const disable = async () => {
    const identityId = session.identityId ?? me?.identityId;
    if (!identityId) return;
    setBusy(true);
    setError(null);
    try {
      if (!store) throw new Error(t("wallet.removeNeedStore"));
      const eth = (window as unknown as { ethereum?: object }).ethereum;
      if (!eth) throw new Error(t("wallet.identityRestoreNeedEoa"));
      const provider = new BrowserProvider(eth as ConstructorParameters<typeof BrowserProvider>[0]);
      const signer = await provider.getSigner();
      const contract = new Contract(store, STORE_ABI, signer);
      const tx = await contract.disableRestore(identityId);
      await tx.wait();
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const email = me?.email;
  const restoreOn = me?.restoreEnabled !== false;
  const hasEoa = (me?.methods.eoa ?? 0) > 0;

  return (
    <Alert className="mb-4" data-testid="identity-recovery-email-card">
      <Mail className="h-4 w-4" />
      <AlertDescription className="flex flex-col gap-3">
        <div>
          <p className="font-medium">{t("wallet.identityRecoveryEmailTitle")}</p>
          {email ? (
            <p className="mt-1 text-sm">{t("wallet.identityRecoveryEmailBody", { email })}</p>
          ) : (
            <p className="mt-1 text-sm text-muted-foreground">
              {loaded ? t("wallet.identityRecoveryEmailFallback") : t("wallet.recoverEmailLoading")}
            </p>
          )}
        </div>
        {restoreOn ? (
          store ? (
            <>
              <p className="text-sm text-muted-foreground">{t("wallet.identityRestoreOnHint")}</p>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  data-testid="identity-restore-turn-off"
                  disabled={!hasEoa || busy}
                  onClick={() => void disable()}
                >
                  {t("wallet.identityRestoreTurnOff")}
                </Button>
                {!hasEoa ? (
                  <p className="text-xs text-muted-foreground">{t("wallet.identityRestoreNeedEoa")}</p>
                ) : null}
              </div>
            </>
          ) : null
        ) : (
          <p className="text-sm text-muted-foreground">{t("wallet.identityRestoreOff")}</p>
        )}
        {error ? <span className="text-sm text-destructive">{error}</span> : null}
      </AlertDescription>
    </Alert>
  );
}
