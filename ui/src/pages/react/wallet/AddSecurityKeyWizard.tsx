import { useCallback, useEffect, useState } from "react";
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
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ExplorerLink } from "@/components/ExplorerLink";
import { Stepper } from "@/components/Stepper";
import { useLocale } from "@/providers/LocaleProvider";
import { addIdentityMethod, loginIdentityPasskey } from "@/shared/identity-api.js";
import { signAddMethodAuthorization } from "@/shared/identity-sign.js";
import { identityWalletCanPay, submitPairAddMethodUserOp } from "@/shared/identity-recover-userop.js";
import { fetchWalletConfig, registerDevice } from "@/shared/wallet-api.js";
import {
  clearPendingPasskey,
  createSecurityKey,
  formatPasskeyError,
  isYubiKeyPinRequiredError,
  type PasskeyOwner,
} from "@/shared/webauthn.js";
import { upsertWalletSession, type WalletSession } from "@/shared/wallet-session.js";

type YubiStep = 1 | 2 | 3;

export function AddSecurityKeyWizard({
  open,
  onOpenChange,
  session,
  onAdded,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  session: WalletSession;
  onAdded: () => void;
}) {
  const { t } = useLocale();
  const [step, setStep] = useState<YubiStep>(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pinHelp, setPinHelp] = useState(false);
  const [key, setKey] = useState<PasskeyOwner | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [succeeded, setSucceeded] = useState(false);
  const [chainId, setChainId] = useState<string | null>(null);
  const [canPay, setCanPay] = useState<boolean | null>(null);
  const [feeUsd, setFeeUsd] = useState("");

  const reset = useCallback(() => {
    setStep(1);
    setBusy(false);
    setError(null);
    setPinHelp(false);
    setKey(null);
    setTxHash(null);
    setSucceeded(false);
    setChainId(null);
    setCanPay(null);
    setFeeUsd("");
  }, []);

  const close = (next: boolean) => {
    if (!next) reset();
    onOpenChange(next);
  };

  useEffect(() => {
    if (!open || step !== 2) return;
    let cancelled = false;
    void (async () => {
      const [pay, config] = await Promise.all([identityWalletCanPay(session.address), fetchWalletConfig()]);
      if (cancelled) return;
      setCanPay(pay.canPay);
      setFeeUsd(config.bundlerFeeUsd);
      setChainId(session.chainId || config.chainId);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, step, session.address, session.chainId]);

  const enroll = async () => {
    setBusy(true);
    setPinHelp(false);
    setError(null);
    try {
      const next = await createSecurityKey(session.label, {
        walletLabel: session.label,
        purpose: "add-yubikey",
        identityId: session.identityId,
        reusePending: false,
      });
      setKey(next);
    } catch (err) {
      if (isYubiKeyPinRequiredError(err)) {
        setPinHelp(true);
        setError(t("wallet.yubikeyPinRequiredTitle"));
      } else {
        setError(formatPasskeyError(err));
      }
    } finally {
      setBusy(false);
    }
  };

  const register = async () => {
    if (!key || !session.identityId) return;
    setBusy(true);
    setError(null);
    setTxHash(null);
    setSucceeded(false);
    setStep(3);
    try {
      if (session.credentialId) {
        await loginIdentityPasskey(session.credentialId, { qx: session.qx, qy: session.qy }).catch(() => undefined);
      }
      const pay = await identityWalletCanPay(session.address);
      if (!pay.store || !pay.canPay) {
        throw new Error(t("wallet.addYubiNeedFunds", { fee: feeUsd }));
      }
      const signing = { ...session, identityId: session.identityId };
      const authorization = await signAddMethodAuthorization({
        session: signing,
        kind: "yubikey",
        qx: key.qx,
        qy: key.qy,
        storeAddress: pay.store,
      });
      const result = await submitPairAddMethodUserOp({
        session: signing,
        qx: key.qx,
        qy: key.qy,
        authorization,
        storeAddress: pay.store,
        kind: "yubikey",
      });
      await addIdentityMethod({
        kind: "yubikey",
        qx: key.qx,
        qy: key.qy,
        credentialId: key.credentialId,
        pay: "recorded",
      });
      await registerDevice({
        walletAddress: session.address,
        chainId: session.chainId,
        ownerQx: key.qx,
        ownerQy: key.qy,
        label: t("wallet.superWalletKeyYubiKey"),
        credentialId: key.credentialId,
      }).catch(() => undefined);
      clearPendingPasskey(key.credentialId);
      upsertWalletSession({ ...session, securityKeyCredentialId: key.credentialId });
      setTxHash(result.txHash);
      setSucceeded(true);
      onAdded();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const steps = [
    { id: 1, label: t("wallet.addYubiStepPin") },
    { id: 2, label: t("wallet.addYubiStepRegister") },
    { id: 3, label: t("wallet.addYubiStepDone") },
  ];

  const description =
    step === 1
      ? t("wallet.addYubiPinLede")
      : step === 2
        ? t("wallet.addYubiRegisterLede")
        : busy
          ? t("wallet.addYubiRegistering")
          : succeeded
            ? t("wallet.addYubiAdded")
            : t("wallet.addYubiFailed");

  return (
    <Dialog open={open} onOpenChange={close} modal={false}>
      <DialogContent
        className="max-w-md"
        data-testid="add-security-key-wizard"
        overlayClassName="pointer-events-none bg-black/40"
        onPointerDownOutside={(event) => busy && event.preventDefault()}
        onInteractOutside={(event) => busy && event.preventDefault()}
        onFocusOutside={(event) => busy && event.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>{t("wallet.addSecurityKey")}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <Stepper steps={steps} current={step} className="mb-1" />

        {step === 1 ? (
          <div className="space-y-3">
            {key ? <p className="text-sm">{t("wallet.addYubiEnrolled")}</p> : null}
            {pinHelp ? (
              <Alert variant="warn">
                <AlertDescription className="space-y-1">
                  <p className="font-medium">{t("wallet.yubikeyPinRequiredTitle")}</p>
                  <p>{t("wallet.yubikeyPinRequiredWhy")}</p>
                  <p>{t("wallet.yubikeyPinSetupSteps")}</p>
                  <p>{t("wallet.yubikeyPinNeverStored")}</p>
                </AlertDescription>
              </Alert>
            ) : null}
          </div>
        ) : null}

        {step === 2 ? (
          <div className="space-y-3">
            {canPay === false ? (
              <p className="text-sm text-muted-foreground">{t("wallet.addYubiNeedFunds", { fee: feeUsd })}</p>
            ) : (
              <p className="text-sm text-muted-foreground">{t("wallet.pairOnChainSigning")}</p>
            )}
          </div>
        ) : null}

        {step === 3 ? (
          <div className="space-y-2 text-sm" data-testid={succeeded ? "yubi-tx-executed" : busy ? "yubi-submitting" : "yubi-failed"}>
            <p className="font-medium">
              {busy ? t("wallet.addYubiRegistering") : succeeded ? t("wallet.addYubiAdded") : t("wallet.addYubiFailed")}
            </p>
            {succeeded && txHash ? (
              <p className="flex items-center gap-2">
                <span>{t("wallet.pairTxExecuted")}</span>
                <ExplorerLink chainId={chainId} value={txHash} kind="tx" />
              </p>
            ) : null}
          </div>
        ) : null}

        {error ? (
          <p className="text-sm text-destructive" data-testid="yubi-error">
            {error}
          </p>
        ) : null}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => close(false)}>
            {step === 3 && succeeded ? t("wallet.close") : t("wallet.cancel")}
          </Button>
          {step === 1 && !key ? (
            <Button type="button" data-testid="yubi-enroll" disabled={busy} onClick={() => void enroll()}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {busy ? t("wallet.superWalletEnrollYubiKey") : t("wallet.addYubiEnrollCta")}
            </Button>
          ) : null}
          {step === 1 && key ? (
            <Button type="button" data-testid="yubi-continue" onClick={() => setStep(2)}>
              {t("wallet.addYubiContinue")}
            </Button>
          ) : null}
          {step === 2 ? (
            <Button
              type="button"
              data-testid="yubi-register"
              disabled={busy || canPay === false || canPay == null}
              onClick={() => void register()}
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {busy ? t("wallet.addYubiRegistering") : t("wallet.addYubiRegisterCta")}
            </Button>
          ) : null}
          {step === 3 && !succeeded ? (
            <Button type="button" data-testid="yubi-retry" disabled={busy} onClick={() => void register()}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {t("wallet.retry")}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
