import { useCallback, useEffect, useState } from "react";
import { ChevronRight, KeyRound, Loader2, Smartphone, Wallet } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { PageCard } from "@/components/PageSplit";
import { useLocale } from "@/providers/LocaleProvider";
import { addConnectedEoaSigner, addPasskeySigner } from "@/shared/wallet-add-signer.js";
import {
  deleteDevice,
  fetchWalletConfig,
  listDevices,
  waitForUserOp,
} from "@/shared/wallet-api.js";
import { formatDeviceFingerprint, shortKey } from "@/shared/wallet-ui.js";
import { createSecurityKey, isYubiKeyPinRequiredError } from "@/shared/webauthn.js";
import { loadWalletSession, upsertWalletSession, type WalletSession } from "@/shared/wallet-session.js";
import { buildSignedRemoveOwnerUserOp, submitSignedUserOp } from "@/shared/userop-client.js";
import { resolveCurrentWalletPasskey } from "@/shared/current-wallet-passkey.js";
import { KEY_YUBIKEY } from "../../../../../commerce/shared/advanced-wallet.js";
import type { WalletDeviceRecord } from "../../../../../commerce/shared/wallet.js";
import { PairDeviceDialog } from "./PairDeviceDialog";

export function DevicesCard({
  session,
  advanced,
}: {
  session: WalletSession;
  advanced: boolean;
}) {
  const { t } = useLocale();
  const [devices, setDevices] = useState<WalletDeviceRecord[] | null>(null);
  const [pairOpen, setPairOpen] = useState(false);
  const [yubiBusy, setYubiBusy] = useState(false);
  const [eoaBusy, setEoaBusy] = useState(false);
  const [yubiHelp, setYubiHelp] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const [status, setStatus] = useState<{ kind: "error" | "info"; message: string } | null>(null);

  const refresh = useCallback(async () => {
    try {
      const list = await listDevices(session.address, session.chainId);
      setDevices(list);
    } catch {
      setDevices([]);
    }
  }, [session.address, session.chainId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const current =
    devices?.find((d) => d.credentialId && d.credentialId === session.credentialId) ??
    devices?.find((d) => d.ownerQx === session.qx && d.ownerQy === session.qy) ??
    null;
  const others = (devices ?? []).filter((d) => d !== current);

  const onPaired = useCallback(() => {
    setStatus({ kind: "info", message: t("wallet.pairConsumed") });
    void refresh();
  }, [refresh, t]);

  const onClosedMessage = useCallback((kind: "info" | "error", message: string) => {
    setStatus({ kind, message });
  }, []);

  const addYubiKey = async () => {
    setYubiBusy(true);
    setYubiHelp(false);
    setStatus({ kind: "info", message: t("wallet.superWalletEnrollYubiKey") });
    try {
      const key = await createSecurityKey(session.label, { walletLabel: session.label });
      setStatus({ kind: "info", message: t("wallet.sendSigning") });
      await addPasskeySigner({
        session,
        advanced,
        qx: key.qx,
        qy: key.qy,
        credentialId: key.credentialId,
        label: t("wallet.superWalletKeyYubiKey"),
        keyType: KEY_YUBIKEY,
      });
      upsertWalletSession({ ...session, securityKeyCredentialId: key.credentialId });
      setStatus(null);
      await refresh();
    } catch (error) {
      if (isYubiKeyPinRequiredError(error)) {
        setYubiHelp(true);
        setStatus({ kind: "error", message: t("wallet.yubikeyPinRequiredTitle") });
      } else {
        setStatus({ kind: "error", message: error instanceof Error ? error.message : String(error) });
      }
    } finally {
      setYubiBusy(false);
    }
  };

  const addEoa = async () => {
    setEoaBusy(true);
    setStatus({ kind: "info", message: t("wallet.superWalletConnectWalletHint") });
    try {
      await addConnectedEoaSigner(session);
      setStatus(null);
      await refresh();
    } catch (error) {
      setStatus({ kind: "error", message: error instanceof Error ? error.message : String(error) });
    } finally {
      setEoaBusy(false);
    }
  };

  const removeDevice = async (device: WalletDeviceRecord) => {
    if (!window.confirm(t("wallet.removeConfirm"))) return;
    const id = `${device.ownerQx}|${device.ownerQy}`;
    setRemoving(id);
    setStatus({ kind: "info", message: t("wallet.sendSigning") });
    try {
      const cfg = await fetchWalletConfig();
      const fee = BigInt(cfg.bundlerFeeUsdc || "0");
      const live = loadWalletSession() ?? session;
      const passkey = await resolveCurrentWalletPasskey(live, "remove-key");
      const { userOp, userOpHash } = await buildSignedRemoveOwnerUserOp({
        config: cfg,
        passkey,
        qx: device.ownerQx,
        qy: device.ownerQy,
        feeAmount: fee,
      });
      await submitSignedUserOp({ config: cfg, userOp, userOpHash, walletAddress: live.address });
      const result = await waitForUserOp(userOpHash);
      if (result.status !== "included") throw new Error(result.rejectReason ?? result.status);
      await deleteDevice(live.address, live.chainId, device.ownerQx, device.ownerQy);
      setStatus(null);
      await refresh();
    } catch (error) {
      setStatus({ kind: "error", message: error instanceof Error ? error.message : String(error) });
    } finally {
      setRemoving(null);
    }
  };

  const addActions = [
    {
      id: "pair",
      icon: Smartphone,
      title: t("wallet.addDevice"),
      body: t("wallet.pairStep1"),
      busy: false,
      disabled: yubiBusy || eoaBusy,
      onClick: () => setPairOpen(true),
    },
    {
      id: "yubi",
      icon: KeyRound,
      title: t("wallet.addSecurityKey"),
      body: t("wallet.addSecurityKeyHint"),
      busy: yubiBusy,
      disabled: yubiBusy || eoaBusy,
      onClick: () => void addYubiKey(),
    },
    {
      id: "eoa",
      icon: Wallet,
      title: t("wallet.superWalletConnectWallet"),
      body: t("wallet.superWalletConnectWalletHint"),
      busy: eoaBusy,
      disabled: yubiBusy || eoaBusy,
      onClick: () => void addEoa(),
    },
  ] as const;

  return (
    <PageCard className="space-y-6" id="devices" data-testid="devices-card">
      <div>
        <h2 className="text-base font-semibold">{t("wallet.passkeys")}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{t("wallet.otherDevicesHint")}</p>
      </div>

      <div className="rounded-lg border bg-muted/30 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
              <Smartphone className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-sm font-medium">{t("wallet.thisDeviceTitle")}</h3>
                <Badge variant="secondary">{t("wallet.thisDeviceBadge")}</Badge>
              </div>
              <p className="mt-1 truncate text-sm">{current?.label ?? session.label}</p>
              <p className="font-mono text-xs text-muted-foreground">{shortKey(session.qx)}</p>
            </div>
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
        {devices == null ? (
          <Skeleton className="mt-3 h-12 w-full" />
        ) : others.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">{t("wallet.otherDevicesEmpty")}</p>
        ) : (
          <ul className="mt-3 divide-y rounded-lg border">
            {others.map((d) => {
              const id = `${d.ownerQx}|${d.ownerQy}`;
              return (
                <li key={id} className="flex items-center justify-between gap-3 px-3 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{d.label}</p>
                    <p className="font-mono text-xs text-muted-foreground">
                      {formatDeviceFingerprint(d)}
                    </p>
                  </div>
                  {advanced ? null : (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={removing === id}
                      onClick={() => void removeDevice(d)}
                    >
                      {removing === id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                      {t("wallet.remove")}
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="space-y-2">
        {(devices?.length ?? 1) <= 1 ? (
          <p className="text-sm text-muted-foreground" data-testid="identity-backup-hint">
            {t("wallet.identityBackupHint")}
          </p>
        ) : null}
        <div className="space-y-2">
          {addActions.map(({ id, icon: Icon, title, body, busy, disabled, onClick }) => (
            <button
              key={id}
              type="button"
              disabled={disabled}
              className="flex w-full items-center gap-3 rounded-xl border border-border bg-card px-4 py-3 text-left hover:bg-muted/40 disabled:pointer-events-none disabled:opacity-60"
              onClick={onClick}
            >
              {busy ? (
                <Loader2 className="h-5 w-5 shrink-0 animate-spin text-emphasis" aria-hidden />
              ) : (
                <Icon className="h-5 w-5 shrink-0 text-emphasis" aria-hidden />
              )}
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium">{title}</span>
                <span className="mt-0.5 block text-xs text-muted-foreground">{body}</span>
              </span>
              <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
            </button>
          ))}
        </div>
      </div>

      {yubiHelp ? (
        <Alert variant="warn">
          <AlertDescription className="space-y-1">
            <p className="font-medium">{t("wallet.yubikeyPinRequiredTitle")}</p>
            <p>{t("wallet.yubikeyPinRequiredWhy")}</p>
            <p>{t("wallet.yubikeyPinSetupSteps")}</p>
            <p>{t("wallet.yubikeyPinNeverStored")}</p>
          </AlertDescription>
        </Alert>
      ) : null}

      {status ? (
        <p
          role="status"
          className={status.kind === "error" ? "text-sm text-destructive" : "text-sm text-muted-foreground"}
        >
          {status.message}
        </p>
      ) : null}

      <PairDeviceDialog
        open={pairOpen}
        onOpenChange={setPairOpen}
        session={session}
        advanced={advanced}
        onPaired={onPaired}
        onClosedMessage={onClosedMessage}
      />
    </PageCard>
  );
}
