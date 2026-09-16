import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ChevronRight, KeyRound, Loader2, Smartphone, Wallet } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { PageCard } from "@/components/PageSplit";
import { useLocale } from "@/providers/LocaleProvider";
import { deleteIdentityMethod, fetchIdentityMe } from "@/shared/identity-api.js";
import { signRemoveMethodAuthorization } from "@/shared/identity-sign.js";
import { credentialIdsMatch } from "@/shared/credential-id.js";
import { deleteDevice, fetchWalletConfig, listDevices } from "@/shared/wallet-api.js";
import { formatDeviceFingerprint, shortKey } from "@/shared/wallet-ui.js";
import { loadWalletSession, type WalletSession } from "@/shared/wallet-session.js";
import type { WalletDeviceRecord } from "../../../../../commerce/shared/wallet.js";
import type { IdentityMethodRecord } from "../../../../../commerce/shared/identity.js";
import { PairDeviceDialog } from "./PairDeviceDialog";
import { AddSecurityKeyWizard } from "./AddSecurityKeyWizard";
import { ConnectWalletWizard } from "./ConnectWalletWizard";
import {
  hashRemoveMethodOnChain,
  identityWalletCanPay,
  resolveIdentityStoreAddress,
  submitPairRemoveMethodUserOp,
} from "@/shared/identity-recover-userop.js";

export function DevicesCard({ session }: { session: WalletSession; advanced?: boolean }) {
  const { t } = useLocale();
  const [searchParams] = useSearchParams();
  const [devices, setDevices] = useState<WalletDeviceRecord[]>([]);
  const [identityKeys, setIdentityKeys] = useState<IdentityMethodRecord[] | null>(null);
  const [pairOpen, setPairOpen] = useState(() => searchParams.has("pair"));
  const [yubiOpen, setYubiOpen] = useState(false);
  const [eoaOpen, setEoaOpen] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const [status, setStatus] = useState<{ kind: "error" | "info"; message: string } | null>(null);

  const refresh = useCallback(async () => {
    const list = await listDevices(session.address, session.chainId).catch(() => []);
    setDevices(list);
    const me = await fetchIdentityMe().catch(() => null);
    setIdentityKeys(me?.keys ?? []);
  }, [session.address, session.chainId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (searchParams.has("pair")) setPairOpen(true);
  }, [searchParams]);

  const identityCurrent =
    identityKeys?.find((k) => k.credentialId && credentialIdsMatch(k.credentialId, session.credentialId)) ??
    identityKeys?.find(
      (k) =>
        k.qx &&
        k.qy &&
        k.qx.toLowerCase() === session.qx.toLowerCase() &&
        k.qy.toLowerCase() === session.qy.toLowerCase()
    ) ??
    null;
  const identityOthers = (identityKeys ?? []).filter((k) => k !== identityCurrent);

  const identityKeyLabel = (method: IdentityMethodRecord) => {
    const device = devices.find(
      (d) =>
        (method.credentialId && d.credentialId && credentialIdsMatch(d.credentialId, method.credentialId)) ||
        (method.qx &&
          method.qy &&
          d.ownerQx.toLowerCase() === method.qx.toLowerCase() &&
          d.ownerQy.toLowerCase() === method.qy.toLowerCase())
    );
    if (device?.label) return device.label;
    if (method.kind === "yubikey") return t("wallet.superWalletKeyYubiKey");
    if (method.kind === "eoa") return t("wallet.superWalletKeyEoa");
    return t("wallet.passkeys");
  };

  const removeIdentityKey = async (method: IdentityMethodRecord) => {
    const live = loadWalletSession() ?? session;
    const identityId = live.identityId;
    if (!identityId) return;
    const cfg = await fetchWalletConfig();
    if ((identityKeys?.length ?? 0) <= 1) {
      setStatus({ kind: "error", message: t("wallet.superWalletRemoveLastKeyBlocked") });
      return;
    }
    if (!window.confirm(t("wallet.removeConfirm"))) return;
    setRemoving(method.id);
    setStatus(null);
    try {
      const store = await resolveIdentityStoreAddress(live.address);
      if (store) {
        setStatus({ kind: "info", message: t("wallet.sendSigning") });
        let digest: string | undefined;
        try {
          digest = await hashRemoveMethodOnChain(store, identityId, method.id);
        } catch {
          digest = undefined;
        }
        const authorization = await signRemoveMethodAuthorization({
          session: { ...live, identityId },
          methodId: method.id,
          storeAddress: store,
          digest,
        });
        try {
          await deleteIdentityMethod({ methodId: method.id, authorization });
        } catch (error) {
          const code = error instanceof Error ? error.message : String(error);
          if (code === "last_method" || /LastMethod/i.test(code)) throw new Error("last_method");
          if (code === "invalid_signature") throw error;
          if (code !== "remove_need_funds" && code !== "method_not_found") throw error;
          const pay = await identityWalletCanPay(live.address);
          if (!pay.canPay) throw new Error(code === "remove_need_funds" ? "remove_need_funds" : code);
          await submitPairRemoveMethodUserOp({
            session: { ...live, identityId },
            methodId: method.id,
            authorization,
            storeAddress: store,
          });
          await deleteIdentityMethod({ methodId: method.id }).catch(() => undefined);
        }
      } else {
        await deleteIdentityMethod({ methodId: method.id });
      }
      if (method.qx && method.qy) {
        await deleteDevice(live.address, live.chainId, method.qx, method.qy).catch(() => undefined);
      }
      setStatus(null);
      await refresh();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStatus({
        kind: "error",
        message:
          message === "last_method"
            ? t("wallet.superWalletRemoveLastKeyBlocked")
            : message === "remove_need_funds"
              ? t("wallet.removeNeedFunds", { fee: cfg.bundlerFeeUsd })
              : message === "invalid_signature"
                ? t("wallet.removeAuthInvalid")
                : message,
      });
    } finally {
      setRemoving(null);
    }
  };

  const addActions = [
    {
      id: "pair",
      icon: Smartphone,
      title: t("wallet.scanPairingQr"),
      body: t("wallet.pairStep1"),
      onClick: () => setPairOpen(true),
    },
    {
      id: "yubi",
      icon: KeyRound,
      title: t("wallet.addSecurityKey"),
      body: t("wallet.addSecurityKeyHint"),
      onClick: () => setYubiOpen(true),
    },
    {
      id: "eoa",
      icon: Wallet,
      title: t("wallet.superWalletConnectWallet"),
      body: t("wallet.superWalletConnectWalletHint"),
      onClick: () => setEoaOpen(true),
    },
  ] as const;

  return (
    <PageCard className="space-y-6" id="devices" data-testid="devices-card">
      <div>
        <h2 className="text-base font-semibold">{t("wallet.passkeys")}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{t("wallet.otherDevicesHint")}</p>
      </div>

      <div className="rounded-lg border bg-muted/30 p-4">
        <div className="flex min-w-0 items-start gap-3">
          <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
            <Smartphone className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-medium">{t("wallet.thisDeviceTitle")}</h3>
              <Badge variant="secondary">{t("wallet.thisDeviceBadge")}</Badge>
            </div>
            <p className="mt-1 truncate text-sm">
              {identityCurrent ? identityKeyLabel(identityCurrent) : session.label}
            </p>
            <p className="font-mono text-xs text-muted-foreground">{shortKey(session.qx)}</p>
          </div>
        </div>
        <details className="mt-3 text-xs text-muted-foreground">
          <summary className="cursor-pointer select-none">{t("wallet.keyPublicAdvanced")}</summary>
          <p className="mt-2">{t("wallet.keyPublicHint")}</p>
          <p className="mt-1 break-all font-mono">qx: {session.qx}</p>
          <p className="break-all font-mono">qy: {session.qy}</p>
        </details>
      </div>

      <div>
        <h3 className="text-sm font-medium">{t("wallet.otherDevicesTitle")}</h3>
        {identityKeys == null ? (
          <Skeleton className="mt-3 h-12 w-full" />
        ) : identityOthers.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">{t("wallet.otherDevicesEmpty")}</p>
        ) : (
          <ul className="mt-3 divide-y rounded-lg border">
            {identityOthers.map((method) => (
              <li key={method.id} className="flex items-center justify-between gap-3 px-3 py-2.5">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{identityKeyLabel(method)}</p>
                  <p className="font-mono text-xs text-muted-foreground">
                    {formatDeviceFingerprint({
                      ownerQx: method.qx ?? session.qx,
                      ownerQy: method.qy ?? session.qy,
                      credentialId: method.credentialId,
                    })}
                  </p>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  data-testid="remove-device"
                  disabled={removing === method.id}
                  onClick={() => void removeIdentityKey(method)}
                >
                  {removing === method.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                  {t("wallet.remove")}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="space-y-2">
        {(identityKeys?.length ?? 1) <= 1 ? (
          <p className="text-sm text-muted-foreground" data-testid="identity-backup-hint">
            {t("wallet.identityBackupHint")}
          </p>
        ) : null}
        <div className="space-y-2">
          {addActions.map(({ id, icon: Icon, title, body, onClick }) => (
            <button
              key={id}
              type="button"
              className="flex w-full items-center gap-3 rounded-xl border border-border bg-card px-4 py-3 text-left hover:bg-muted/40"
              onClick={onClick}
            >
              <Icon className="h-5 w-5 shrink-0 text-emphasis" aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium">{title}</span>
                <span className="mt-0.5 block text-xs text-muted-foreground">{body}</span>
              </span>
              <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
            </button>
          ))}
        </div>
      </div>

      {status ? (
        <Alert variant={status.kind === "error" ? "destructive" : "default"} data-testid="devices-status">
          <AlertDescription>{status.message}</AlertDescription>
        </Alert>
      ) : null}

      <PairDeviceDialog
        open={pairOpen}
        onOpenChange={setPairOpen}
        session={session}
        advanced={false}
        onPaired={() => {
          setStatus({ kind: "info", message: t("wallet.pairConsumed") });
          void refresh();
        }}
        onClosedMessage={(kind, message) => setStatus({ kind, message })}
      />
      <AddSecurityKeyWizard
        open={yubiOpen}
        onOpenChange={setYubiOpen}
        session={session}
        onAdded={() => void refresh()}
      />
      <ConnectWalletWizard
        open={eoaOpen}
        onOpenChange={setEoaOpen}
        session={session}
        onAdded={() => void refresh()}
      />
    </PageCard>
  );
}
