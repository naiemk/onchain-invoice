import { AppKitButton } from "@reown/appkit/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { ZeroHash } from "ethers";
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
import { ExplorerLink } from "@/components/ExplorerLink";
import { Stepper } from "@/components/Stepper";
import { cn } from "@/lib/utils";
import { useLocale } from "@/providers/LocaleProvider";
import { addIdentityMethod, loginIdentityPasskey } from "@/shared/identity-api.js";
import { signAddMethodAuthorization } from "@/shared/identity-sign.js";
import { identityWalletCanPay, submitPairAddMethodUserOp } from "@/shared/identity-recover-userop.js";
import {
  connectEoaWallet,
  eoaCanCoverAddMethodGas,
  hasWalletConnect,
  initEoaConnector,
  sendIdentityAddMethod,
  signIdentityAddMethodTypedData,
  subscribeEoaAccount,
} from "@/shared/eoa-connector.js";
import { fetchWalletConfig, registerDevice } from "@/shared/wallet-api.js";
import { shortAddress, type WalletSession } from "@/shared/wallet-session.js";
import { eoaCredentialId, eoaOwnerCoords } from "../../../../../commerce/shared/wallet-eip712.js";
import { METHOD_EOA } from "../../../../../commerce/shared/identity-store.js";

type ConnectStep = 1 | 2 | 3 | 4;
type PayMode = "self" | "wallet";

export function ConnectWalletWizard({
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
  const [step, setStep] = useState<ConnectStep>(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [eoa, setEoa] = useState<string | null>(null);
  const [pay, setPay] = useState<PayMode>("self");
  const [selfOk, setSelfOk] = useState(false);
  const [walletOk, setWalletOk] = useState(false);
  const [feeUsd, setFeeUsd] = useState("");
  const [txHash, setTxHash] = useState<string | null>(null);
  const [succeeded, setSucceeded] = useState(false);
  const [chainId, setChainId] = useState<string | null>(null);
  const [payReady, setPayReady] = useState(false);
  const [appKit, setAppKit] = useState(false);
  const finishing = useRef<string | null>(null);

  const reset = useCallback(() => {
    setStep(1);
    setBusy(false);
    setError(null);
    setEoa(null);
    setPay("self");
    setSelfOk(false);
    setWalletOk(false);
    setFeeUsd("");
    setTxHash(null);
    setSucceeded(false);
    setChainId(null);
    setPayReady(false);
    setAppKit(false);
    finishing.current = null;
  }, []);

  const close = (next: boolean) => {
    if (!next) reset();
    onOpenChange(next);
  };

  useEffect(() => {
    if (!open) return;
    void fetchWalletConfig()
      .then((cfg) => {
        setFeeUsd(cfg.bundlerFeeUsd);
        setChainId(session.chainId || cfg.chainId);
        return initEoaConnector(cfg);
      })
      .then(() => setAppKit(hasWalletConnect()))
      .catch(() => undefined);
  }, [open, session.chainId]);

  const loadPayOptions = async () => {
    const [gasOk, canPay] = await Promise.all([eoaCanCoverAddMethodGas(), identityWalletCanPay(session.address)]);
    setSelfOk(gasOk);
    setWalletOk(canPay.canPay);
    setPay(gasOk ? "self" : canPay.canPay ? "wallet" : "self");
    setPayReady(true);
  };

  const afterConnect = async (address: string) => {
    if (finishing.current === address) return;
    finishing.current = address;
    const config = await fetchWalletConfig();
    const store = config.identityStoreAddress;
    if (!store || !session.identityId) throw new Error(t("wallet.removeNeedStore"));
    await signIdentityAddMethodTypedData({
      store,
      chainId: BigInt(session.chainId || config.chainId || "0"),
      identityId: session.identityId,
      kind: METHOD_EOA,
      qx: ZeroHash,
      qy: ZeroHash,
      eoa: address,
    });
    setEoa(address);
    await loadPayOptions();
    setStep(2);
  };

  const connect = async () => {
    setBusy(true);
    setError(null);
    try {
      const address = await connectEoaWallet();
      await afterConnect(address);
    } catch (err) {
      finishing.current = null;
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (!open || step !== 1 || !appKit) return;
    return subscribeEoaAccount((address) => {
      if (!address || busy) return;
      setBusy(true);
      setError(null);
      void afterConnect(address)
        .catch((err) => {
          finishing.current = null;
          setError(err instanceof Error ? err.message : String(err));
        })
        .finally(() => setBusy(false));
    });
  }, [open, step, appKit, busy]);

  const submit = async () => {
    if (!eoa || !session.identityId) return;
    setBusy(true);
    setError(null);
    setTxHash(null);
    setSucceeded(false);
    setStep(4);
    try {
      if (session.credentialId) {
        await loginIdentityPasskey(session.credentialId, { qx: session.qx, qy: session.qy }).catch(() => undefined);
      }
      const config = await fetchWalletConfig();
      const payInfo = await identityWalletCanPay(session.address);
      const store = payInfo.store ?? config.identityStoreAddress;
      if (!store) throw new Error(t("wallet.removeNeedStore"));
      const signing = { ...session, identityId: session.identityId };
      const authorization = await signAddMethodAuthorization({
        session: signing,
        kind: "eoa",
        eoa,
        storeAddress: store,
      });
      let hash: string | null = null;
      if (pay === "self") {
        hash = await sendIdentityAddMethod({
          store,
          identityId: session.identityId,
          kind: METHOD_EOA,
          qx: ZeroHash,
          qy: ZeroHash,
          eoa,
          authorization,
        });
      } else {
        if (!payInfo.canPay) throw new Error(t("wallet.connectWalletPayBalanceDisabled", { fee: feeUsd }));
        const result = await submitPairAddMethodUserOp({
          session: signing,
          qx: ZeroHash,
          qy: ZeroHash,
          authorization,
          storeAddress: store,
          kind: "eoa",
          eoa,
        });
        hash = result.txHash;
      }
      const coords = eoaOwnerCoords(eoa);
      await addIdentityMethod({
        kind: "eoa",
        eoa,
        credentialId: eoaCredentialId(eoa),
        pay: "recorded",
      });
      await registerDevice({
        walletAddress: session.address,
        chainId: session.chainId,
        ownerQx: coords.qx,
        ownerQy: coords.qy,
        label: t("wallet.superWalletKeyEoa"),
        credentialId: eoaCredentialId(eoa),
      }).catch(() => undefined);
      setTxHash(hash);
      setSucceeded(true);
      onAdded();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const selectedDisabled = (pay === "self" && !selfOk) || (pay === "wallet" && !walletOk);
  const steps = [
    { id: 1, label: t("wallet.connectWalletStepConnect") },
    { id: 2, label: t("wallet.connectWalletStepPay") },
    { id: 3, label: t("wallet.connectWalletStepSign") },
    { id: 4, label: t("wallet.connectWalletStepDone") },
  ];

  const description =
    step === 1
      ? t("wallet.connectWalletPickWallet")
      : step === 2
        ? t("wallet.connectWalletStepPay")
        : step === 3
          ? pay === "self"
            ? t("wallet.connectWalletSignHint")
            : t("wallet.connectWalletSignHintUserOp")
          : busy
            ? t("wallet.connectWalletSubmitting")
            : succeeded
              ? t("wallet.connectWalletAdded")
              : t("wallet.connectWalletFailed");

  return (
    <Dialog open={open} onOpenChange={close} modal={false}>
      <DialogContent
        className="max-w-md"
        data-testid="connect-wallet-wizard"
        overlayClassName="pointer-events-none bg-black/40"
        onPointerDownOutside={(event) => event.preventDefault()}
        onInteractOutside={(event) => event.preventDefault()}
        onFocusOutside={(event) => event.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>{t("wallet.superWalletConnectWallet")}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <Stepper steps={steps} current={step} className="mb-1" />

        {step === 1 ? (
          <div className="space-y-3">
            {appKit ? (
              <div className="flex flex-col items-center gap-3 py-2" data-testid="connect-wallet-appkit">
                <AppKitButton size="md" />
              </div>
            ) : null}
            <Button
              type="button"
              className={appKit ? "sr-only" : "w-full"}
              data-testid="connect-wallet-connect"
              disabled={busy}
              onClick={() => void connect()}
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {t("wallet.connectWalletConnectCta")}
            </Button>
            {eoa ? (
              <p className="font-mono text-sm">{t("wallet.connectWalletConnected", { address: shortAddress(eoa) })}</p>
            ) : null}
            <p className="text-xs text-muted-foreground">{t("wallet.connectWalletSignEip712")}</p>
          </div>
        ) : null}

        {step === 2 && eoa ? (
          <div className="space-y-2">
            <p className="font-mono text-xs text-muted-foreground">{eoa}</p>
            <PayOption
              id="self"
              testId="connect-wallet-pay-self"
              checked={pay === "self"}
              disabled={!selfOk}
              onChange={() => setPay("self")}
              title={t("wallet.connectWalletPaySelf")}
              body={selfOk ? t("wallet.connectWalletPaySelfHint") : t("wallet.connectWalletPaySelfDisabled")}
            />
            <PayOption
              id="wallet"
              testId="connect-wallet-pay-wallet"
              checked={pay === "wallet"}
              disabled={!walletOk}
              onChange={() => setPay("wallet")}
              title={t("wallet.connectWalletPayBalance")}
              body={
                walletOk
                  ? t("wallet.connectWalletPayBalanceHint", { fee: feeUsd })
                  : t("wallet.connectWalletPayBalanceDisabled", { fee: feeUsd })
              }
            />
          </div>
        ) : null}

        {step === 3 && eoa ? (
          <p className="font-mono text-xs text-muted-foreground">{eoa}</p>
        ) : null}

        {step === 4 ? (
          <div
            className="space-y-2 text-sm"
            data-testid={succeeded ? "connect-wallet-tx-executed" : busy ? "connect-wallet-submitting" : "connect-wallet-failed"}
          >
            <p className="font-medium">
              {busy
                ? t("wallet.connectWalletSubmitting")
                : succeeded
                  ? t("wallet.connectWalletAdded")
                  : t("wallet.connectWalletFailed")}
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
          <p className="text-sm text-destructive" data-testid="connect-wallet-error">
            {error}
          </p>
        ) : null}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => close(false)}>
            {step === 4 && succeeded ? t("wallet.close") : t("wallet.cancel")}
          </Button>
          {step === 2 ? (
            <Button
              type="button"
              data-testid="connect-wallet-next"
              disabled={!payReady || selectedDisabled}
              onClick={() => setStep(3)}
            >
              {t("wallet.createDisclaimerNext")}
            </Button>
          ) : null}
          {step === 3 ? (
            <Button type="button" data-testid="connect-wallet-submit" disabled={busy} onClick={() => void submit()}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {busy ? t("wallet.connectWalletSubmitting") : t("wallet.connectWalletSubmitCta")}
            </Button>
          ) : null}
          {step === 4 && !succeeded ? (
            <Button type="button" data-testid="connect-wallet-retry" disabled={busy} onClick={() => void submit()}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {t("wallet.retry")}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PayOption({
  id,
  testId,
  checked,
  disabled,
  onChange,
  title,
  body,
}: {
  id: string;
  testId: string;
  checked: boolean;
  disabled?: boolean;
  onChange: () => void;
  title: string;
  body: string;
}) {
  return (
    <label
      className={cn(
        "flex items-start gap-3 rounded-xl border px-4 py-3",
        disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer"
      )}
    >
      <input
        type="radio"
        name="connect-pay"
        className="mt-1"
        value={id}
        checked={checked}
        disabled={disabled}
        data-testid={testId}
        onChange={onChange}
      />
      <span>
        <span className="block text-sm font-medium">{title}</span>
        <span className="mt-0.5 block text-xs text-muted-foreground">{body}</span>
      </span>
    </label>
  );
}
