import { useCallback, useEffect, useState } from "react";
import { Html5Qrcode } from "html5-qrcode";
import { useSearchParams } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ExplorerLink } from "@/components/ExplorerLink";
import { useLocale } from "@/providers/LocaleProvider";
import {
  addIdentityMethod,
  fetchIdentityMe,
  loginIdentityPasskey,
  parseIdentityPairPayload,
  type IdentityPairPayload,
} from "@/shared/identity-api.js";
import { signAddMethodAuthorization } from "@/shared/identity-sign.js";
import {
  identityWalletCanPay,
  submitPairAddMethodUserOp,
  resolveIdentityStoreAddress,
} from "@/shared/identity-recover-userop.js";
import { fetchWalletConfig, registerDevice } from "@/shared/wallet-api.js";
import { shortKey } from "@/shared/wallet-ui.js";
import { inferDeviceLabel } from "@/shared/passkey-name.js";
import { loadWalletSession, type WalletSession } from "@/shared/wallet-session.js";

const READER_ID = "pair-scan-reader";

type PairDialogStep = "scan" | "confirm" | "done";

export function PairDeviceDialog({
  open,
  onOpenChange,
  session,
  advanced: _advanced,
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
  const [searchParams, setSearchParams] = useSearchParams();
  const [step, setStep] = useState<PairDialogStep>("scan");
  const [showPaste, setShowPaste] = useState(false);
  const [raw, setRaw] = useState("");
  const [payload, setPayload] = useState<IdentityPairPayload | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scannerError, setScannerError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [chainId, setChainId] = useState<string | null>(null);
  const [onChain, setOnChain] = useState(false);

  const applyPayload = useCallback((next: IdentityPairPayload) => {
    setPayload(next);
    setStep("confirm");
    setError(null);
  }, []);

  const reset = useCallback(() => {
    setStep("scan");
    setShowPaste(false);
    setRaw("");
    setPayload(null);
    setBusy(false);
    setError(null);
    setScannerError(null);
    setTxHash(null);
    setChainId(null);
    setOnChain(false);
  }, []);

  useEffect(() => {
    if (!open) {
      reset();
      return;
    }
    const fromUrl = searchParams.get("pair");
    if (fromUrl) {
      const parsed = parseIdentityPairPayload(
        `${window.location.origin}/wallet/security?pair=${fromUrl}`
      );
      if (parsed) {
        applyPayload(parsed);
        return;
      }
    }
    setStep("scan");
  }, [applyPayload, open, reset, searchParams]);

  useEffect(() => {
    if (!open || step !== "scan") return;
    let cancelled = false;
    let scanner: Html5Qrcode | null = null;
    void (async () => {
      try {
        if (!document.getElementById(READER_ID)) {
          throw new Error("scanner element missing");
        }
        scanner = new Html5Qrcode(READER_ID);
        await scanner.start(
          { facingMode: "environment" },
          { fps: 8, qrbox: { width: 220, height: 220 } },
          (decoded) => {
            const parsed = parseIdentityPairPayload(decoded);
            if (!parsed) {
              setError(t("wallet.pairPayloadHint"));
              return;
            }
            void scanner?.stop().catch(() => undefined);
            applyPayload(parsed);
          },
          () => undefined
        );
      } catch {
        if (!cancelled) {
          setScannerError(t("wallet.scannerUnavailable"));
          setShowPaste(true);
        }
      }
    })();
    return () => {
      cancelled = true;
      void scanner?.stop().catch(() => undefined);
    };
  }, [applyPayload, open, step, t]);

  useEffect(() => {
    if (!open || step !== "confirm") return;
    void identityWalletCanPay(session.address).then((pay) => setOnChain(pay.canPay));
  }, [open, session.address, step]);

  const close = (nextOpen: boolean) => {
    onOpenChange(nextOpen);
    if (!nextOpen && searchParams.has("pair")) {
      const next = new URLSearchParams(searchParams);
      next.delete("pair");
      setSearchParams(next, { replace: true });
    }
  };

  const onPaste = (value: string) => {
    setRaw(value);
    const parsed = parseIdentityPairPayload(value);
    if (parsed) applyPayload(parsed);
  };

  const confirm = async () => {
    if (!payload) {
      setError(t("wallet.pairPayloadHint"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const config = await fetchWalletConfig();
      setChainId(config.chainId);
      const live = loadWalletSession() ?? session;
      if (live.credentialId) {
        await loginIdentityPasskey(live.credentialId).catch(() => undefined);
      }
      const me = await fetchIdentityMe().catch(() => null);
      const identityId = live.identityId ?? me?.identityId;
      const provingCredentialId = live.credentialId;
      const pay = await identityWalletCanPay(live.address);
      const store = pay.store ?? (await resolveIdentityStoreAddress(live.address));
      if (store && pay.canPay) {
        if (!identityId) throw new Error(t("wallet.recoverNeedSession"));
        const signing = { ...live, identityId };
        const authorization = await signAddMethodAuthorization({
          session: signing,
          kind: "webauthn",
          qx: payload.qx,
          qy: payload.qy,
          storeAddress: store,
        });
        const result = await submitPairAddMethodUserOp({
          session: signing,
          qx: payload.qx,
          qy: payload.qy,
          authorization,
          storeAddress: store,
        });
        await addIdentityMethod({
          kind: "webauthn",
          qx: payload.qx,
          qy: payload.qy,
          credentialId: payload.credentialId,
          provingCredentialId,
          pay: "recorded",
        });
        setTxHash(result.txHash);
      } else if (store && identityId) {
        const signing = { ...live, identityId };
        const authorization = await signAddMethodAuthorization({
          session: signing,
          kind: "webauthn",
          qx: payload.qx,
          qy: payload.qy,
          storeAddress: store,
        });
        await addIdentityMethod({
          kind: "webauthn",
          qx: payload.qx,
          qy: payload.qy,
          credentialId: payload.credentialId,
          provingCredentialId,
          authorization,
        });
      } else {
        await addIdentityMethod({
          kind: "webauthn",
          qx: payload.qx,
          qy: payload.qy,
          credentialId: payload.credentialId,
          provingCredentialId,
          pay: store ? "pending" : undefined,
        });
      }
      await registerDevice({
        walletAddress: live.address,
        chainId: live.chainId || config.chainId,
        ownerQx: payload.qx,
        ownerQy: payload.qy,
        label: inferDeviceLabel(),
        credentialId: payload.credentialId,
      }).catch(() => undefined);
      setStep("done");
      onPaired();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      onClosedMessage?.("error", message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-w-md" data-testid="pair-device-dialog">
        <DialogHeader>
          <DialogTitle>{t("wallet.scanPairingQr")}</DialogTitle>
          <DialogDescription>
            {step === "scan"
              ? t("wallet.pairStep1")
              : step === "confirm"
                ? onChain
                  ? t("wallet.pairOnChainHint")
                  : t("wallet.pairOffChainHint")
                : t("wallet.pairDoneReturn")}
          </DialogDescription>
        </DialogHeader>

        <div className={step === "scan" ? "space-y-3" : "hidden"}>
          <div id={READER_ID} className="mx-auto min-h-[120px] w-full max-w-[240px] overflow-hidden rounded-md bg-muted" />
          {scannerError ? <p className="text-sm text-muted-foreground">{scannerError}</p> : null}
          {!showPaste ? (
            <Button type="button" variant="ghost" size="sm" onClick={() => setShowPaste(true)}>
              {t("wallet.pasteUrlInstead")}
            </Button>
          ) : (
            <Input
              data-testid="pair-paste-url"
              value={raw}
              onChange={(e) => onPaste(e.target.value)}
              placeholder={t("wallet.pairPasteUrlPlaceholder")}
            />
          )}
        </div>

        {step === "confirm" && payload ? (
          <div className="space-y-2 text-sm">
            {onChain ? <p className="text-muted-foreground">{t("wallet.pairOnChainSigning")}</p> : null}
            <p>
              <span className="text-muted-foreground">{t("wallet.pairNewKey")}: </span>
              <span className="font-mono text-xs">{shortKey(payload.qx)}</span>
            </p>
          </div>
        ) : null}

        {step === "done" ? (
          <div className="space-y-2 text-sm" data-testid="pair-tx-executed">
            <p className="font-medium">{t("wallet.pairAdded")}</p>
            {txHash ? (
              <p className="flex items-center gap-2">
                <span>{t("wallet.pairTxExecuted")}</span>
                <ExplorerLink chainId={chainId} value={txHash} kind="tx" />
              </p>
            ) : null}
          </div>
        ) : null}

        {error ? (
          <p className="text-sm text-destructive" data-testid="pair-error">
            {error}
          </p>
        ) : null}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => close(false)}>
            {step === "done" ? t("wallet.close") : t("wallet.cancel")}
          </Button>
          {step === "confirm" ? (
            <Button type="button" data-testid="pair-confirm" disabled={busy} onClick={() => void confirm()}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {busy
                ? onChain
                  ? t("wallet.pairSubmitting")
                  : t("wallet.pairAdding")
                : onChain
                  ? t("wallet.confirmAddOwner")
                  : t("wallet.pairConfirmAdd")}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
