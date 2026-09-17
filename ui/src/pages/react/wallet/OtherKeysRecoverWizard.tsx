import { useEffect, useState, type MutableRefObject } from "react";
import { Link } from "react-router-dom";
import { KeyRound, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TurnstileWidget, readCaptchaToken, type TurnstileControl } from "@/components/TurnstileWidget";
import { Stepper } from "@/components/Stepper";
import { useLocale } from "@/providers/LocaleProvider";
import { fetchWalletConfig, fetchWalletBalance } from "@/shared/wallet-api.js";
import {
  fetchIdentityRecoverChallenge,
  fetchRecoverSecurityKeyIds,
  proveIdentityRecover,
  recoverAddIdentityMethod,
  loginIdentityPasskey,
} from "@/shared/identity-api.js";
import type { IdentityRecoverProveResponse } from "../../../../../commerce/shared/identity.js";
import { inferDeviceLabel } from "@/shared/passkey-name.js";
import {
  authenticatePasskey,
  clearPendingPasskey,
  createPasskey,
  formatPasskeyError,
  type PasskeyOwner,
} from "@/shared/webauthn.js";
import { credentialIdsMatch } from "@/shared/credential-id.js";
import {
  connectEoaWallet,
  eoaCanCoverAddMethodGas,
  initEoaConnector,
  sendIdentityAddMethodByEoa,
  signIdentityVerifyTypedData,
} from "@/shared/eoa-connector.js";
import { METHOD_WEBAUTHN } from "../../../../../commerce/shared/identity-store.js";
import { signRecoverAddMethodAuthorization } from "@/shared/identity-sign.js";
import { identityWalletCanPay, submitRecoverAddMethodUserOp } from "@/shared/identity-recover-userop.js";
import {
  listRememberedSecurityKeyIds,
  rememberSecurityKeyCredential,
  saveWalletSession,
} from "@/shared/wallet-session.js";
import { resolveWalletLabel } from "@/shared/wallet-label.js";
import { WalletBalancePreview, type WalletPreviewItem } from "./WalletBalancePreview";

type OtherKeyKind = "yubikey" | "eoa";
type PayMode = "self" | "wallet";
type OtherStep = 1 | 2 | 3 | 4 | 5;

function pinYubiCredentialId(serverIds: string[], remembered: string[]): string | null {
  const matched = remembered.filter((id) => serverIds.some((server) => credentialIdsMatch(server, id)));
  if (matched.length === 1) return matched[0]!;
  if (serverIds.length === 1) return serverIds[0]!;
  return null;
}

export function OtherKeysRecoverWizard({
  siteKey,
  captchaRef,
  onRestoreEnabled,
}: {
  siteKey: string | null;
  captchaRef: MutableRefObject<TurnstileControl | null>;
  onRestoreEnabled?: (enabled: boolean) => void;
}) {
  const { t } = useLocale();
  const [step, setStep] = useState<OtherStep>(1);
  const [kind, setKind] = useState<OtherKeyKind | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [proved, setProved] = useState<IdentityRecoverProveResponse | null>(null);
  const [wallets, setWallets] = useState<WalletPreviewItem[]>([]);
  const [pay, setPay] = useState<PayMode>("wallet");
  const [payer, setPayer] = useState<string | null>(null);
  const [eoaHasGas, setEoaHasGas] = useState(false);
  const [walletCanPay, setWalletCanPay] = useState(false);
  const [feeUsd, setFeeUsd] = useState("");
  const [pendingOwner, setPendingOwner] = useState<PasskeyOwner | null>(null);
  const [pendingAuthorization, setPendingAuthorization] = useState<string | null>(null);

  const steps = [
    { id: 1, label: t("wallet.recoverOtherStepChoose") },
    { id: 2, label: t("wallet.recoverOtherStepProve") },
    { id: 3, label: t("wallet.recoverOtherPayTitle"), hidden: kind !== "eoa" },
    { id: 4, label: t("wallet.recoverOtherStepPasskey") },
    { id: 5, label: t("wallet.recoverOtherStepSubmit") },
  ];

  useEffect(() => {
    void fetchWalletConfig()
      .then((cfg) => {
        setFeeUsd(cfg.bundlerFeeUsd);
        return initEoaConnector(cfg);
      })
      .catch(() => undefined);
  }, []);

  const loadBalances = async (identity: IdentityRecoverProveResponse, chainId: string) => {
    const rows = await Promise.all(
      identity.wallets.map(async (w, index) => {
        let balanceUsd: string | null = null;
        try {
          const b = await fetchWalletBalance(w.address);
          balanceUsd = b.totalUsd;
        } catch {
          balanceUsd = null;
        }
        return {
          address: w.address,
          label: resolveWalletLabel({
            saved: w.label,
            server: w.label,
            index,
            fallback: t("wallet.defaultWalletName"),
          }),
          chainId,
          balanceUsd,
        } satisfies WalletPreviewItem;
      })
    );
    setWallets(rows);
    const flags = await Promise.all(rows.map((row) => identityWalletCanPay(row.address)));
    const funded = rows.find((_, index) => flags[index]?.canPay) ?? rows[0] ?? null;
    setWalletCanPay(flags.some((flag) => flag.canPay));
    setPayer(funded?.address ?? null);
  };

  const prove = async (nextKind: OtherKeyKind) => {
    setBusy(true);
    setError(null);
    try {
      const config = await fetchWalletConfig();
      if (nextKind === "yubikey") {
        const serverIds = await fetchRecoverSecurityKeyIds().catch(() => [] as string[]);
        const pinned = pinYubiCredentialId(serverIds, listRememberedSecurityKeyIds());
        const credentialId =
          pinned ??
          (await authenticatePasskey({ hint: "security-key", credentialIds: serverIds }))?.credentialId;
        if (!credentialId) throw new Error(t("wallet.recoverNeedOtherKey"));
        rememberSecurityKeyCredential(credentialId);
        const identity = await proveIdentityRecover({ kind: "yubikey", credentialId });
        setProved(identity);
        onRestoreEnabled?.(identity.restoreEnabled);
        const owner = await createPasskey(inferDeviceLabel(), {
          purpose: "recover",
          identityId: identity.identityId,
          email: identity.email,
        });
        const proving = {
          kind: "yubikey" as const,
          credentialId: identity.provingMethod.credentialId,
          qx: identity.provingMethod.qx,
          qy: identity.provingMethod.qy,
          eoa: identity.provingMethod.eoa,
        };
        const authorization = await signRecoverAddMethodAuthorization({
          identityId: identity.identityId,
          proving,
          qx: owner.qx,
          qy: owner.qy,
        });
        setPendingOwner(owner);
        setPendingAuthorization(authorization);
        setStep(4);
        return;
      }
      const store = config.identityStoreAddress;
      if (!store) throw new Error(t("wallet.noFactory"));
      await connectEoaWallet();
      const challenge = await fetchIdentityRecoverChallenge();
      const signed = await signIdentityVerifyTypedData({
        store,
        chainId: BigInt(config.chainId),
        message: challenge,
      });
      const identity = await proveIdentityRecover({
        kind: "eoa",
        eoa: signed.address,
        signature: signed.signature,
        challenge,
      });
      setProved(identity);
      onRestoreEnabled?.(identity.restoreEnabled);
      await loadBalances(identity, config.chainId);
      const gasOk = await eoaCanCoverAddMethodGas();
      setEoaHasGas(gasOk);
      setPay(gasOk ? "self" : "wallet");
      setStep(3);
    } catch (err) {
      setError(formatPasskeyError(err));
    } finally {
      setBusy(false);
    }
  };

  const submit = async () => {
    if (!proved || !kind) return;
    setBusy(true);
    setError(null);
    try {
      const config = await fetchWalletConfig();
      const store = config.identityStoreAddress;
      const owner =
        pendingOwner ??
        (await createPasskey(inferDeviceLabel(), {
          purpose: "recover",
          identityId: proved.identityId,
          email: proved.email,
        }));
      const proving = {
        kind: proved.provingMethod.kind === "eoa" ? ("eoa" as const) : ("yubikey" as const),
        credentialId: proved.provingMethod.credentialId,
        qx: proved.provingMethod.qx,
        qy: proved.provingMethod.qy,
        eoa: proved.provingMethod.eoa,
      };
      if (kind === "eoa" && pay === "self") {
        if (!eoaHasGas) throw new Error(t("wallet.connectWalletPaySelfDisabled"));
        if (!store) throw new Error(t("wallet.noFactory"));
        await sendIdentityAddMethodByEoa({
          store,
          identityId: proved.identityId,
          kind: METHOD_WEBAUTHN,
          qx: owner.qx,
          qy: owner.qy,
        });
        await recoverAddIdentityMethod({
          pay: "recorded",
          qx: owner.qx,
          qy: owner.qy,
          credentialId: owner.credentialId,
        });
      } else if (kind === "eoa" && pay === "wallet") {
        if (!payer) throw new Error(t("wallet.recoverSelectWallets"));
        const authorization = await signRecoverAddMethodAuthorization({
          identityId: proved.identityId,
          proving,
          qx: owner.qx,
          qy: owner.qy,
        });
        await submitRecoverAddMethodUserOp({
          identityId: proved.identityId,
          walletAddress: payer,
          proving,
          qx: owner.qx,
          qy: owner.qy,
          authorization,
        });
        await recoverAddIdentityMethod({
          pay: "recorded",
          qx: owner.qx,
          qy: owner.qy,
          credentialId: owner.credentialId,
          authorization,
        });
      } else {
        const captchaToken = readCaptchaToken(captchaRef);
        if (siteKey && !captchaToken) throw new Error(t("wallet.recoverCaptchaRequired"));
        if (!store) throw new Error(t("wallet.noFactory"));
        const authorization =
          pendingAuthorization ??
          (await signRecoverAddMethodAuthorization({
            identityId: proved.identityId,
            proving,
            qx: owner.qx,
            qy: owner.qy,
          }));
        await recoverAddIdentityMethod({
          pay: "relayer",
          qx: owner.qx,
          qy: owner.qy,
          credentialId: owner.credentialId,
          authorization,
          captchaToken,
        });
      }
      clearPendingPasskey(owner.credentialId);
      const login = await loginIdentityPasskey(owner.credentialId);
      const first = login.wallets[0];
      if (first) {
        saveWalletSession({
          address: first.address,
          chainId: config.chainId,
          salt: first.salt,
          qx: owner.qx,
          qy: owner.qy,
          credentialId: owner.credentialId,
          rawId: owner.rawId,
          label: resolveWalletLabel({
            saved: first.label,
            server: first.label,
            index: 0,
            fallback: t("wallet.defaultWalletName"),
          }),
          identityId: login.identityId,
        });
      }
      setStep(5);
    } catch (err) {
      setError(formatPasskeyError(err));
    } finally {
      setBusy(false);
    }
  };

  const eoaNextEnabled = pay === "self" ? eoaHasGas : Boolean(payer);

  return (
    <div className="space-y-4" data-testid="other-keys-recover">
      <Stepper steps={steps} current={step} />
      {step === 1 ? (
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">{t("wallet.recoverOtherChooseLede")}</p>
          <button
            type="button"
            className="flex w-full items-start gap-3 rounded-xl border border-border px-4 py-3 text-left"
            onClick={() => {
              setKind("yubikey");
              setPendingOwner(null);
              setPendingAuthorization(null);
              setStep(2);
            }}
            data-testid="recover-choose-yubikey"
          >
            <KeyRound className="mt-0.5 h-5 w-5 shrink-0 text-emphasis" aria-hidden />
            <span>
              <span className="block text-sm font-medium">{t("wallet.recoverSignerYubiKey")}</span>
              <span className="mt-0.5 block text-xs text-muted-foreground">{t("wallet.recoverOtherYubiKeyBody")}</span>
            </span>
          </button>
          <button
            type="button"
            className="flex w-full items-start gap-3 rounded-xl border border-border px-4 py-3 text-left"
            onClick={() => {
              setKind("eoa");
              setPendingOwner(null);
              setPendingAuthorization(null);
              setStep(2);
            }}
            data-testid="recover-choose-eoa"
          >
            <Wallet className="mt-0.5 h-5 w-5 shrink-0 text-emphasis" aria-hidden />
            <span>
              <span className="block text-sm font-medium">{t("wallet.recoverSignerEoa")}</span>
              <span className="mt-0.5 block text-xs text-muted-foreground">{t("wallet.recoverOtherEoaBody")}</span>
            </span>
          </button>
        </div>
      ) : null}

      {step === 2 && kind ? (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            {kind === "yubikey" ? t("wallet.recoverOtherProveYubiKey") : t("wallet.recoverOtherProveEoa")}
          </p>
          <Button type="button" className="w-full" disabled={busy} onClick={() => void prove(kind)}>
            {t("wallet.recoverOtherProveCta")}
          </Button>
        </div>
      ) : null}

      {step === 3 && proved && kind === "eoa" ? (
        <div className="space-y-4">
          <p className="text-sm">
            {t("wallet.recoverOtherIdentityEmail")}: <span className="font-medium">{proved.email}</span>
          </p>
          <WalletBalancePreview
            wallets={wallets}
            selectedAddress={pay === "wallet" ? payer : null}
            interactive={pay === "wallet"}
            onSelect={setPayer}
          />
          <div className="space-y-2">
            <p className="text-sm font-medium">{t("wallet.recoverOtherPayTitle")}</p>
            <PayOption
              id="self"
              testId="recover-pay-self"
              checked={pay === "self"}
              disabled={!eoaHasGas}
              onChange={() => setPay("self")}
              title={t("wallet.recoverOtherPaySelf")}
              body={eoaHasGas ? t("wallet.recoverOtherPaySelfBody") : t("wallet.connectWalletPaySelfDisabled")}
            />
            <PayOption
              id="wallet"
              testId="recover-pay-wallet"
              checked={pay === "wallet"}
              disabled={!walletCanPay}
              onChange={() => setPay("wallet")}
              title={t("wallet.recoverOtherPayWallet")}
              body={
                walletCanPay
                  ? t("wallet.recoverOtherPayWalletBody")
                  : t("wallet.connectWalletPayBalanceDisabled", { fee: feeUsd })
              }
            />
          </div>
          <Button type="button" className="w-full" disabled={busy || !eoaNextEnabled} onClick={() => setStep(4)}>
            {t("wallet.createDisclaimerNext")}
          </Button>
        </div>
      ) : null}

      {step === 4 ? (
        <div className="space-y-3">
          {proved ? (
            <p className="text-sm">
              {t("wallet.recoverOtherIdentityEmail")}: <span className="font-medium">{proved.email}</span>
            </p>
          ) : null}
          <p className="text-sm text-muted-foreground">{t("wallet.recoverOnThisDeviceLede")}</p>
          {kind === "yubikey" && siteKey ? (
            <TurnstileWidget siteKey={siteKey} controlRef={captchaRef} className="flex justify-center py-2" />
          ) : null}
          <Button type="button" className="w-full" disabled={busy} onClick={() => void submit()}>
            {t("wallet.recoverOnThisDeviceCta")}
          </Button>
        </div>
      ) : null}

      {step === 5 ? (
        <div className="space-y-3">
          <p className="text-sm">{t("wallet.recoverOtherDone")}</p>
          <Button asChild className="w-full">
            <Link to="/wallet">{t("wallet.backToWallets")}</Link>
          </Button>
        </div>
      ) : null}

      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </div>
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
      className={`flex items-start gap-3 rounded-xl border px-4 py-3 ${
        disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer"
      }`}
    >
      <input
        type="radio"
        name="recover-pay"
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
