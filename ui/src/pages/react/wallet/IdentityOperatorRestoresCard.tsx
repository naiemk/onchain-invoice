import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useLocale } from "@/providers/LocaleProvider";
import {
  fetchOperatorRestores,
  markOperatorRestoreInitiated,
  signOperatorRestore,
  type IdentityOperatorRestore,
} from "@/shared/identity-api.js";
import { fetchWalletConfig } from "@/shared/wallet-api.js";
import { loadWalletSession } from "@/shared/wallet-session.js";
import { resolveCurrentWalletPasskey, signWithCurrentWalletPasskey } from "@/shared/current-wallet-passkey.js";
import {
  buildInitiateRestoreUserOp,
  submitSignedIdentityUserOp,
} from "@/shared/identity-recover-userop.js";
import { METHOD_WEBAUTHN } from "../../../../../commerce/shared/identity-store.js";

type Payload = { userOpHash?: string; userOp?: unknown; blobs?: Record<string, string> };

export function IdentityOperatorRestoresCard() {
  const { t } = useLocale();
  const [requests, setRequests] = useState<IdentityOperatorRestore[]>([]);
  const [threshold, setThreshold] = useState(2);
  const [operator, setOperator] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const body = await fetchOperatorRestores();
    setOperator(body.operator);
    setThreshold(body.threshold || 2);
    setRequests(body.requests);
  }, []);

  useEffect(() => {
    void reload().catch(() => undefined);
  }, [reload]);

  if (!operator) return null;
  const actionable = requests.filter((r) => r.status === "awaiting_guardian" || r.status === "queued");
  if (actionable.length === 0) return null;

  const signRestore = async (row: IdentityOperatorRestore) => {
    const session = loadWalletSession();
    if (!session?.identityId) return;
    setBusy(row.id);
    setError(null);
    try {
      const config = await fetchWalletConfig();
      const store = config.identityStoreAddress;
      if (!store) throw new Error(t("wallet.removeNeedStore"));
      const identityId = row.identityId;
      if (!identityId) throw new Error(t("wallet.recoverNeedSession"));
      let payload: Payload = {};
      if (row.operatorPayload) {
        try {
          payload = JSON.parse(row.operatorPayload) as Payload;
        } catch {
          payload = {};
        }
      }
      const operatorWallet = operator;
      let userOp = payload.userOp;
      let userOpHash = payload.userOpHash;
      if (!userOp || !userOpHash) {
        const built = await buildInitiateRestoreUserOp({
          operatorWallet,
          storeAddress: store,
          identityId,
          kind: METHOD_WEBAUTHN,
          qx: row.newQx,
          qy: row.newQy,
        });
        userOp = built.userOp;
        userOpHash = built.userOpHash;
      }
      const passkey = await resolveCurrentWalletPasskey(session, "enable-advanced");
      const blob = await signWithCurrentWalletPasskey(userOpHash, passkey, { path: "enable-advanced" });
      const signed = await signOperatorRestore({
        requestId: row.id,
        signature: blob,
        userOpHash,
        userOp,
      });
      const blobs = Object.values(signed.payload.blobs ?? {});
      if (blobs.length >= threshold && signed.payload.userOp && signed.payload.userOpHash) {
        await submitSignedIdentityUserOp({
          walletAddress: operatorWallet,
          userOp: signed.payload.userOp as Parameters<typeof submitSignedIdentityUserOp>[0]["userOp"],
          userOpHash: signed.payload.userOpHash,
          blobs,
        });
        await markOperatorRestoreInitiated(row.id);
      }
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Alert data-testid="identity-operator-restores" className="mb-4">
      <AlertDescription className="flex flex-col gap-3">
        <p className="font-medium">{t("wallet.superWalletRestoreInboxTitle")}</p>
        <p className="text-sm text-muted-foreground">{t("wallet.superWalletRestoreInboxHint")}</p>
        <ul className="space-y-2">
          {actionable.map((row) => (
            <li key={row.id} className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm">{row.email}</span>
              <Button
                type="button"
                size="sm"
                data-testid="sign-identity-restore"
                disabled={busy === row.id}
                onClick={() => void signRestore(row)}
              >
                {t("wallet.superWalletRestoreSign")}
              </Button>
            </li>
          ))}
        </ul>
        {error ? <span className="text-sm text-destructive">{error}</span> : null}
      </AlertDescription>
    </Alert>
  );
}
