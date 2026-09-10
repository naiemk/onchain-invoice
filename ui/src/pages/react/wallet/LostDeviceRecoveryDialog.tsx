import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { TurnstileWidget, type TurnstileControl } from "@/components/TurnstileWidget";
import { useLocale } from "@/providers/LocaleProvider";
import {
  cancelRecoveryRequest,
  createRecoveryChallenge,
  fetchWalletRecovery,
} from "@/shared/wallet-recovery-api.js";
import { fetchWalletConfig } from "@/shared/wallet-api.js";
import { loadWalletSession, type WalletSession } from "@/shared/wallet-session.js";
import { assertPasskeyChallenge, formatPasskeyError } from "@/shared/webauthn.js";

export function LostDeviceRecoveryDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useLocale();
  const session = loadWalletSession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [siteKey, setSiteKey] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const captchaRef = useRef<TurnstileControl | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setStatus(null);
    void (async () => {
      const cfg = await fetchWalletConfig().catch(() => null);
      setSiteKey(cfg?.turnstileSiteKey ?? null);
      const hint = session?.address;
      if (!hint) return;
      const rec = await fetchWalletRecovery(hint).catch(() => null);
      setActiveId(rec?.request?.id ?? null);
    })();
  }, [open, session?.address]);

  const cancelRequest = async () => {
    const live = loadWalletSession() as WalletSession | null;
    if (!live || !activeId) {
      setError(t("wallet.recoverNeedSession"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const captchaToken = captchaRef.current?.getToken() ?? null;
      if (siteKey && !captchaToken) {
        setError(t("wallet.recoverCaptchaRequired"));
        return;
      }
      const ch = await createRecoveryChallenge("cancel", live.address);
      const { assertion } = await assertPasskeyChallenge({
        challengeBase64Url: ch.challenge,
        credentialId: live.credentialId,
      });
      await cancelRecoveryRequest({
        requestId: activeId,
        challengeId: ch.challengeId,
        ownerQx: live.qx,
        ownerQy: live.qy,
        credentialId: live.credentialId,
        assertion,
        captchaToken,
      });
      setStatus(t("wallet.recoverCancelled"));
      setActiveId(null);
    } catch (err) {
      setError(formatPasskeyError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("wallet.recoverMenuCancelTitle")}</DialogTitle>
          <DialogDescription>{t("wallet.recoverMenuCancelBody")}</DialogDescription>
        </DialogHeader>
        <TurnstileWidget siteKey={siteKey} controlRef={captchaRef} />
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        {status ? <p className="text-sm text-muted-foreground">{status}</p> : null}
        <DialogFooter>
          <Button type="button" disabled={busy || !activeId} onClick={() => void cancelRequest()}>
            {t("wallet.recoverCancel")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
