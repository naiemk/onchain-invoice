import { useCallback, useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { Check, Copy, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { useLocale } from "@/providers/LocaleProvider";
import { copyText } from "@/shared/dom.js";
import { addPasskeySigner } from "@/shared/wallet-add-signer.js";
import {
  consumePairing,
  createPairing,
  pairingDeepLink,
  pairingQrPayload,
  pollPairing,
  rejectPairing,
} from "@/shared/wallet-api.js";
import { KEY_WEBAUTHN } from "../../../../../commerce/shared/advanced-wallet.js";
import type { WalletSession } from "@/shared/wallet-session.js";

type Phase = "loading" | "share" | "approve" | "error";

type ApprovedPairing = {
  newOwnerQx: string;
  newOwnerQy: string;
  deviceLabel: string;
};

export function PairDeviceDialog({
  open,
  onOpenChange,
  session,
  advanced,
  onPaired,
  onClosedMessage,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  session: WalletSession;
  advanced: boolean;
  onPaired: () => void;
  onClosedMessage?: (kind: "info" | "error", message: string) => void;
}) {
  const { t } = useLocale();
  const [phase, setPhase] = useState<Phase>("loading");
  const [qrUrl, setQrUrl] = useState("");
  const [deepLink, setDeepLink] = useState("");
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  const [linkExpanded, setLinkExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [approved, setApproved] = useState<ApprovedPairing | null>(null);
  const [confirming, setConfirming] = useState(false);

  const nonceRef = useRef<string | null>(null);
  const doneRef = useRef(false);
  const expiresAtRef = useRef(0);

  const rejectAndClose = useCallback(
    async (message: string, kind: "info" | "error" = "error") => {
      const nonce = nonceRef.current;
      if (doneRef.current) return;
      doneRef.current = true;
      nonceRef.current = null;
      if (nonce) {
        try {
          await rejectPairing(nonce);
        } catch {
          /* ignore */
        }
      }
      onClosedMessage?.(kind, message);
      onOpenChange(false);
    },
    [onOpenChange, onClosedMessage]
  );

  useEffect(() => {
    if (!open) {
      setPhase("loading");
      setQrUrl("");
      setDeepLink("");
      setSecondsLeft(null);
      setLinkExpanded(false);
      setCopied(false);
      setError(null);
      setApproved(null);
      setConfirming(false);
      nonceRef.current = null;
      doneRef.current = false;
      expiresAtRef.current = 0;
      return;
    }

    let cancelled = false;
    doneRef.current = false;
    setPhase("loading");
    setError(null);

    void (async () => {
      try {
        const created = await createPairing(session.address, session.chainId);
        if (cancelled) {
          try {
            await rejectPairing(created.pairing.nonce);
          } catch {
            /* ignore */
          }
          return;
        }
        const payload = pairingQrPayload({
          walletAddress: session.address,
          chainId: session.chainId,
          nonce: created.pairing.nonce,
          rpId: window.location.hostname,
        });
        const link = pairingDeepLink(payload);
        let qr = "";
        try {
          qr = await QRCode.toDataURL(link, {
            margin: 1,
            width: 200,
            color: { dark: "#0a2540", light: "#ffffff" },
          });
        } catch {
          qr = "";
        }
        if (cancelled) {
          try {
            await rejectPairing(created.pairing.nonce);
          } catch {
            /* ignore */
          }
          return;
        }
        nonceRef.current = created.pairing.nonce;
        expiresAtRef.current = new Date(created.pairing.expiresAt).getTime();
        setDeepLink(link);
        setQrUrl(qr);
        setPhase("share");
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
        setPhase("error");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, session.address, session.chainId]);

  useEffect(() => {
    if (!open || phase !== "share" || !nonceRef.current) return;
    const tick = () => {
      const left = Math.max(0, Math.floor((expiresAtRef.current - Date.now()) / 1000));
      setSecondsLeft(left);
      if (left <= 0) {
        void rejectAndClose(t("wallet.pairExpired"));
      }
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [open, phase, rejectAndClose, t]);

  useEffect(() => {
    if (!open || phase !== "share") return;
    const nonce = nonceRef.current;
    if (!nonce) return;
    const poll = async () => {
      if (doneRef.current) return;
      try {
        const { pairing: p } = await pollPairing(nonce);
        if (doneRef.current) return;
        if (p.status === "expired") {
          await rejectAndClose(t("wallet.pairExpired"));
          return;
        }
        if (p.status === "consumed") {
          doneRef.current = true;
          nonceRef.current = null;
          onOpenChange(false);
          onPaired();
          return;
        }
        if (p.status === "approved" && p.newOwnerQx && p.newOwnerQy) {
          setApproved({
            newOwnerQx: p.newOwnerQx,
            newOwnerQy: p.newOwnerQy,
            deviceLabel: p.deviceLabel ?? t("wallet.defaultDevice"),
          });
          setPhase("approve");
        }
      } catch {
        /* keep polling */
      }
    };
    void poll();
    const id = window.setInterval(() => void poll(), 2000);
    return () => window.clearInterval(id);
  }, [open, phase, onOpenChange, onPaired, rejectAndClose, t]);

  const handleOpenChange = (next: boolean) => {
    if (next) {
      onOpenChange(true);
      return;
    }
    if (doneRef.current) {
      onOpenChange(false);
      return;
    }
    void rejectAndClose(t("wallet.pairRejected"), "info");
  };

  const copyLink = async () => {
    if (!deepLink) return;
    await copyText(deepLink);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };

  const confirmPairing = async () => {
    const nonce = nonceRef.current;
    if (!approved || !nonce || confirming) return;
    setConfirming(true);
    setError(null);
    try {
      await addPasskeySigner({
        session,
        advanced,
        qx: approved.newOwnerQx,
        qy: approved.newOwnerQy,
        credentialId: null,
        label: approved.deviceLabel,
        keyType: KEY_WEBAUTHN,
      });
      await consumePairing(nonce);
      doneRef.current = true;
      nonceRef.current = null;
      onOpenChange(false);
      onPaired();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setConfirming(false);
    }
  };

  const stepIndex = phase === "approve" ? 2 : 1;
  const steps = [
    t("wallet.pairWizardShare"),
    t("wallet.pairWizardWaiting"),
    t("wallet.pairWizardApprove"),
  ];

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md" data-testid="pair-device-dialog">
        <DialogHeader>
          <DialogTitle>{t("wallet.addDevice")}</DialogTitle>
          <DialogDescription>
            {phase === "approve"
              ? t("wallet.approvePairing", { label: approved?.deviceLabel ?? t("wallet.defaultDevice") })
              : t("wallet.scanOnNewDevice")}
          </DialogDescription>
        </DialogHeader>

        <ol className="flex items-center justify-between gap-1 text-xs" aria-label={t("wallet.pairStepsTitle")}>
          {steps.map((label, i) => {
            const state = i < stepIndex ? "done" : i === stepIndex ? "current" : "upcoming";
            return (
              <li key={label} className="flex min-w-0 flex-1 items-center gap-1.5">
                <span
                  className={cn(
                    "flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-[11px] font-medium",
                    state === "done" && "border-primary bg-primary text-primary-foreground",
                    state === "current" && "border-primary text-primary",
                    state === "upcoming" && "border-muted-foreground/30 text-muted-foreground"
                  )}
                >
                  {state === "done" ? <Check className="h-3 w-3" /> : i + 1}
                </span>
                <span
                  className={cn(
                    "truncate",
                    state === "current" ? "font-medium text-foreground" : "text-muted-foreground"
                  )}
                >
                  {label}
                </span>
              </li>
            );
          })}
        </ol>

        {phase === "loading" && (
          <div className="flex flex-col items-center gap-3 py-8 text-sm text-muted-foreground">
            <Loader2 className="h-6 w-6 animate-spin" />
            {t("wallet.balanceLoading")}
          </div>
        )}

        {phase === "share" && (
          <div className="space-y-4">
            <div className="flex justify-center">
              {qrUrl ? (
                <img
                  src={qrUrl}
                  alt={t("wallet.qrAlt")}
                  width={200}
                  height={200}
                  data-testid="pair-qr"
                  className="h-[200px] w-[200px] rounded-lg bg-white p-2"
                />
              ) : (
                <div className="flex h-[200px] w-[200px] items-center justify-center rounded-lg bg-muted" />
              )}
            </div>
            <p className="text-center text-sm text-muted-foreground">{t("wallet.pairWizardWaitingHint")}</p>
            <div className="space-y-1.5">
              <div className="flex items-center gap-2 rounded-lg border bg-muted/40 px-2 py-1.5">
                <code className="min-w-0 flex-1 truncate font-mono text-xs" dir="ltr" title={deepLink}>
                  {deepLink}
                </code>
                <Button type="button" size="sm" variant="secondary" data-testid="pair-copy-link" onClick={() => void copyLink()}>
                  {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                  {copied ? t("wallet.copied") : t("wallet.copy")}
                </Button>
              </div>
              <button
                type="button"
                className="text-xs text-muted-foreground underline-offset-4 hover:underline"
                onClick={() => setLinkExpanded((v) => !v)}
              >
                {linkExpanded ? t("wallet.pairLinkHide") : t("wallet.pairLinkShow")}
              </button>
              {linkExpanded ? (
                <p className="break-all font-mono text-[11px] leading-relaxed text-muted-foreground" dir="ltr">
                  {deepLink}
                </p>
              ) : null}
            </div>
            <p className="text-center text-xs text-muted-foreground">
              {secondsLeft == null
                ? t("wallet.pairingExpires")
                : t("wallet.pairingCountdown", { seconds: secondsLeft })}
            </p>
          </div>
        )}

        {phase === "error" || error ? (
          <p className="text-sm text-destructive" role="status">
            {error}
          </p>
        ) : null}

        <DialogFooter className="gap-2 sm:justify-between">
          <Button
            type="button"
            variant="outline"
            onClick={() => void rejectAndClose(t("wallet.pairRejected"), "info")}
            disabled={confirming}
          >
            {t("wallet.pairReject")}
          </Button>
          {phase === "approve" ? (
            <Button type="button" data-testid="pair-confirm" disabled={confirming} onClick={() => void confirmPairing()}>
              {confirming ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {confirming ? t("wallet.sendSigning") : t("wallet.confirmAddOwner")}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
