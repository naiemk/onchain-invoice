import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Fingerprint, KeyRound, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { TurnstileWidget, readCaptchaToken, type TurnstileControl } from "@/components/TurnstileWidget";
import { useLocale } from "@/providers/LocaleProvider";
import { fetchWalletConfig } from "@/shared/wallet-api.js";
import {
  createRecoveryChallenge,
  createRecoveryRequest,
  listRecoveryEmailWallets,
  startRecoveryEmailLookup,
  verifyRecoveryEmailLookup,
  type RecoveryEmailWallet,
  type RecoveryExistingOwner,
  type RecoveryRequestPublic,
} from "@/shared/wallet-recovery-api.js";
import { inferDeviceLabel } from "@/shared/passkey-name.js";
import { shortAddress } from "@/shared/wallet-session.js";
import {
  assertPasskeyChallenge,
  createPasskey,
  createSecurityKey,
  formatPasskeyError,
} from "@/shared/webauthn.js";
import { signRecoverTypedData } from "@/shared/eoa-connector.js";
import { enrollPasskeyWithExistingEoa } from "@/shared/wallet-add-signer.js";
import { WalletFrame } from "./WalletFrame";

type SignerKind = "webauthn" | "yubikey" | "eoa";
type EmailStep = "email" | "otp" | "passkey" | "done";

export function RecoverPage() {
  const { t } = useLocale();
  const [siteKey, setSiteKey] = useState<string | null>(null);
  const [timelockHours, setTimelockHours] = useState(24);
  const [chainId, setChainId] = useState("11155111");
  const [emailOpen, setEmailOpen] = useState(false);

  useEffect(() => {
    void fetchWalletConfig()
      .then((cfg) => {
        setSiteKey(cfg.turnstileSiteKey ?? null);
        if (cfg.recoveryTimelockSeconds) {
          setTimelockHours(Math.round(cfg.recoveryTimelockSeconds / 3600));
        }
        if (cfg.chainId) setChainId(cfg.chainId);
      })
      .catch(() => undefined);
  }, []);

  return (
    <WalletFrame
      current="recover"
      showChrome={false}
      title={t("wallet.recoverPageTitle")}
      lede={t("wallet.recoverPageLede")}
    >
      <p className="mb-4 text-xs text-muted-foreground">{t("wallet.recoveryTimelock", { hours: timelockHours })}</p>
      <Tabs defaultValue="email" className="w-full">
        <TabsList>
          <TabsTrigger value="email">{t("wallet.recoverTabWithEmail")}</TabsTrigger>
          <TabsTrigger value="address">{t("wallet.recoverTabWithoutEmail")}</TabsTrigger>
        </TabsList>
        <TabsContent value="email" className="mt-4 space-y-4">
          <EmailRecoverIntro hours={timelockHours} onStart={() => setEmailOpen(true)} />
        </TabsContent>
        <TabsContent value="address" className="mt-4 space-y-4">
          <AddressRecoverIntro hours={timelockHours} />
          <AddressRecoverTab siteKey={siteKey} chainId={chainId} />
        </TabsContent>
      </Tabs>
      <EmailRecoverDialog
        open={emailOpen}
        onOpenChange={setEmailOpen}
        siteKey={siteKey}
        chainId={chainId}
      />
      <p className="mt-6 text-xs text-muted-foreground">
        <Link to="/wallet" className="underline underline-offset-2">
          {t("wallet.backToWallets")}
        </Link>
      </p>
    </WalletFrame>
  );
}

function EmailRecoverIntro({ hours, onStart }: { hours: number; onStart: () => void }) {
  const { t } = useLocale();
  const [acked, setAcked] = useState(false);
  return (
    <div className="space-y-4 rounded-xl border border-border p-4">
      <p className="text-sm text-muted-foreground">
        {t("wallet.recoverEmailCardPairHint")}{" "}
        <Link to="/wallet/pair" className="font-medium text-foreground underline underline-offset-2">
          {t("wallet.recoverEmailCardPairCta")}
        </Link>
      </p>
      <Alert variant="warn">
        <AlertDescription>{t("wallet.recoverEmailCardDisableWarn")}</AlertDescription>
      </Alert>
      <ul className="list-disc space-y-2 pl-5 text-sm">
        <li>{t("wallet.recoverEmailStepVerify")}</li>
        <li>{t("wallet.recoverEmailStepStart")}</li>
        <li>{t("wallet.recoverEmailStepCancel", { hours })}</li>
      </ul>
      <div className="flex items-start gap-3">
        <Checkbox
          id="recover-ack-no-device"
          checked={acked}
          onCheckedChange={(checked) => setAcked(checked === true)}
        />
        <Label htmlFor="recover-ack-no-device" className="text-sm font-normal leading-snug">
          {t("wallet.recoverEmailAckNoDevice")}
        </Label>
      </div>
      <Button type="button" className="w-full" disabled={!acked} onClick={onStart}>
        {t("wallet.recoverEmailStart")}
      </Button>
    </div>
  );
}

function AddressRecoverIntro({ hours }: { hours: number }) {
  const { t } = useLocale();
  return (
    <div className="space-y-2 rounded-xl border border-border p-4">
      <p className="text-sm font-medium">{t("wallet.recoverAddressCardTitle")}</p>
      <ul className="list-disc space-y-1.5 pl-5 text-sm text-muted-foreground">
        <li>{t("wallet.recoverAddressStepEnter")}</li>
        <li>{t("wallet.recoverAddressStepProve")}</li>
        <li>{t("wallet.recoverAddressStepCancel", { hours })}</li>
      </ul>
    </div>
  );
}

function EmailRecoverDialog({
  open,
  onOpenChange,
  siteKey,
  chainId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  siteKey: string | null;
  chainId: string;
}) {
  const { t } = useLocale();
  const captchaRef = useRef<TurnstileControl | null>(null);
  const [step, setStep] = useState<EmailStep>("email");
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [emailSession, setEmailSession] = useState("");
  const [wallets, setWallets] = useState<RecoveryEmailWallet[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<RecoveryRequestPublic[]>([]);
  const [enrolled, setEnrolled] = useState<RecoveryExistingOwner[]>([]);

  const reset = () => {
    setStep("email");
    setEmail("");
    setOtp("");
    setEmailSession("");
    setWallets([]);
    setBusy(false);
    setError(null);
    setCreated([]);
    setEnrolled([]);
  };

  const handleOpenChange = (next: boolean) => {
    if (busy) return;
    if (!next) reset();
    onOpenChange(next);
  };

  const fail = (err: unknown) => {
    const msg = formatPasskeyError(err);
    setError(msg === "threshold_not_one" ? t("wallet.superWalletPairNeedsOneSigner") : msg);
  };

  const sendCode = async () => {
    if (!email.includes("@")) {
      setError(t("wallet.recoverInvalidEmail"));
      return;
    }
    const captchaToken = readCaptchaToken(captchaRef);
    if (siteKey && !captchaToken) {
      setError(t("wallet.recoverCaptchaRequired"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await startRecoveryEmailLookup({ email: email.trim(), captchaToken });
      setStep("otp");
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  const verify = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await verifyRecoveryEmailLookup({
        email: email.trim(),
        code: otp.trim(),
      });
      setEmailSession(result.emailSession);
      const listed = await listRecoveryEmailWallets(result.emailSession);
      setWallets(listed.wallets.filter((w) => !w.activeRecovery));
      setStep("passkey");
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  const createPasskeyAndSubmit = async () => {
    if (!wallets.length) {
      setError(t("wallet.recoverNoWalletsForEmail"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await signAndCreate({
        signer: "webauthn",
        walletAddresses: wallets.map((w) => w.address),
        emailSession,
        chainId,
      });
      setCreated(result.requests);
      setEnrolled(result.existingOwners);
      setStep("done");
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  const title =
    step === "otp"
      ? t("wallet.recoverOtpLabel")
      : step === "passkey"
        ? t("wallet.recoverOnThisDeviceTitle")
        : step === "done"
          ? t("wallet.recoverEmailStartedTitle")
          : t("wallet.recoverEmailModalTitle");
  const lede =
    step === "otp"
      ? t("wallet.recoverOtpSent")
      : step === "passkey"
        ? t("wallet.recoverOnThisDeviceLede")
        : step === "done"
          ? t("wallet.recoverEmailStarted")
          : t("wallet.recoverEmailModalLede");

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-md overflow-visible" data-testid="email-recover-dialog">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{lede}</DialogDescription>
        </DialogHeader>

        {step === "email" ? (
          <div className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="recover-email">{t("wallet.recoverLostEmailLabel")}</Label>
              <Input
                id="recover-email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
              />
            </div>
            <TurnstileWidget siteKey={siteKey} controlRef={captchaRef} className="flex min-h-[65px] justify-center py-2" />
          </div>
        ) : null}

        {step === "otp" ? (
          <div className="space-y-2">
            <Label htmlFor="recover-otp">{t("wallet.recoverOtpLabel")}</Label>
            <Input
              id="recover-otp"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={otp}
              onChange={(e) => setOtp(e.target.value)}
            />
          </div>
        ) : null}

        {step === "passkey" ? (
          <div className="space-y-3">
            {wallets.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("wallet.recoverNoWalletsForEmail")}</p>
            ) : (
              <div className="flex items-start gap-3 rounded-xl border border-border px-4 py-3">
                <Fingerprint className="mt-0.5 h-5 w-5 shrink-0 text-emphasis" aria-hidden />
                <span>
                  <span className="block text-sm font-medium">{t("wallet.recoverSignerPasskey")}</span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    {t("wallet.recoverSignerPasskeyBody")}
                  </span>
                </span>
              </div>
            )}
          </div>
        ) : null}

        {step === "done" ? (
          <div className="space-y-3">
            {enrolled.length > 0 ? <p className="text-sm">{t("wallet.recoverExistingOwnerDone")}</p> : null}
            {enrolled.length > 0 ? (
              <ul className="space-y-1 text-sm text-muted-foreground">
                {enrolled.map((r) => (
                  <li key={r.address} className="font-mono">
                    {shortAddress(r.address)}
                  </li>
                ))}
              </ul>
            ) : null}
            {created.length > 0 ? (
              <ul className="space-y-1 text-sm text-muted-foreground">
                {created.map((r) => (
                  <li key={r.id} className="font-mono">
                    {shortAddress(r.walletAddress)}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}

        {error ? (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        ) : null}

        <DialogFooter>
          {step === "email" ? (
            <Button type="button" className="w-full sm:w-auto" disabled={busy} onClick={() => void sendCode()}>
              {t("wallet.createDisclaimerNext")}
            </Button>
          ) : null}
          {step === "otp" ? (
            <Button
              type="button"
              className="w-full sm:w-auto"
              disabled={busy || otp.trim().length < 6}
              onClick={() => void verify()}
            >
              {t("wallet.createDisclaimerNext")}
            </Button>
          ) : null}
          {step === "passkey" && wallets.length > 0 ? (
            <Button type="button" className="w-full sm:w-auto" disabled={busy} onClick={() => void createPasskeyAndSubmit()}>
              {t("wallet.recoverOnThisDeviceCta")}
            </Button>
          ) : null}
          {step === "done" ? (
            <Button asChild className="w-full sm:w-auto">
              <Link to="/wallet">{t("wallet.backToWallets")}</Link>
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AddressRecoverTab({ siteKey, chainId }: { siteKey: string | null; chainId: string }) {
  const { t } = useLocale();
  const captchaRef = useRef<TurnstileControl | null>(null);
  const [address, setAddress] = useState("");
  const [signer, setSigner] = useState<SignerKind>("webauthn");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<RecoveryRequestPublic[] | null>(null);
  const [enrolled, setEnrolled] = useState<RecoveryExistingOwner[]>([]);

  const initiate = async () => {
    if (!address.trim()) {
      setError(t("wallet.localRecoveryNeedAddress"));
      return;
    }
    const captchaToken = readCaptchaToken(captchaRef);
    if (siteKey && !captchaToken) {
      setError(t("wallet.recoverCaptchaRequired"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await signAndCreate({
        signer,
        walletAddresses: [address.trim()],
        captchaToken,
        chainId,
      });
      setCreated(result.requests);
      setEnrolled(result.existingOwners);
    } catch (err) {
      const msg = formatPasskeyError(err);
      setError(msg === "threshold_not_one" ? t("wallet.superWalletPairNeedsOneSigner") : msg);
    } finally {
      setBusy(false);
    }
  };

  if (created) return <DoneState requests={created} enrolled={enrolled} />;

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="recover-address">{t("wallet.recoverWalletLabel")}</Label>
        <Input id="recover-address" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="0x…" />
      </div>
      <SignerPicker value={signer} onChange={setSigner} />
      <TurnstileWidget siteKey={siteKey} controlRef={captchaRef} className="flex justify-center py-2" />
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <Button type="button" className="w-full" disabled={busy} onClick={() => void initiate()}>
        {t("wallet.recoverStart")}
      </Button>
    </div>
  );
}

function SignerPicker({ value, onChange }: { value: SignerKind; onChange: (v: SignerKind) => void }) {
  const { t } = useLocale();
  const items: Array<{ id: SignerKind; icon: typeof Fingerprint; title: string; body: string }> = [
    { id: "webauthn", icon: Fingerprint, title: t("wallet.recoverSignerPasskey"), body: t("wallet.recoverSignerPasskeyBody") },
    { id: "yubikey", icon: KeyRound, title: t("wallet.recoverSignerYubiKey"), body: t("wallet.recoverSignerYubiKeyBody") },
    { id: "eoa", icon: Wallet, title: t("wallet.recoverSignerEoa"), body: t("wallet.recoverSignerEoaBody") },
  ];
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">{t("wallet.recoverSignerTitle")}</p>
      {items.map(({ id, icon: Icon, title, body }) => (
        <button
          key={id}
          type="button"
          className={`flex w-full items-start gap-3 rounded-xl border px-4 py-3 text-left ${
            value === id ? "border-emphasis bg-muted/40" : "border-border"
          }`}
          onClick={() => onChange(id)}
        >
          <Icon className="mt-0.5 h-5 w-5 shrink-0 text-emphasis" aria-hidden />
          <span>
            <span className="block text-sm font-medium">{title}</span>
            <span className="mt-0.5 block text-xs text-muted-foreground">{body}</span>
          </span>
        </button>
      ))}
    </div>
  );
}

function DoneState({
  requests,
  enrolled,
}: {
  requests: RecoveryRequestPublic[];
  enrolled: RecoveryExistingOwner[];
}) {
  const { t } = useLocale();
  return (
    <div className="space-y-3">
      {enrolled.length > 0 ? <p className="text-sm">{t("wallet.recoverExistingOwnerDone")}</p> : null}
      {enrolled.length > 0 ? (
        <ul className="space-y-1 text-sm text-muted-foreground">
          {enrolled.map((r) => (
            <li key={r.address} className="font-mono">
              {shortAddress(r.address)}
            </li>
          ))}
        </ul>
      ) : null}
      {requests.length > 0 ? <p className="text-sm">{t("wallet.recoverEmailStarted")}</p> : null}
      {requests.length > 0 ? (
        <ul className="space-y-1 text-sm text-muted-foreground">
          {requests.map((r) => (
            <li key={r.id} className="font-mono">
              {shortAddress(r.walletAddress)} · {r.status}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

async function signAndCreate(input: {
  signer: SignerKind;
  walletAddresses: string[];
  emailSession?: string;
  captchaToken?: string | null;
  chainId: string;
}): Promise<{
  request: RecoveryRequestPublic | null;
  requests: RecoveryRequestPublic[];
  existingOwners: RecoveryExistingOwner[];
}> {
  const label = inferDeviceLabel();
  const first = input.walletAddresses[0];
  if (input.signer === "eoa") {
    const requests: RecoveryRequestPublic[] = [];
    const existingOwners: RecoveryExistingOwner[] = [];
    for (const wallet of input.walletAddresses) {
      const ch = await createRecoveryChallenge("recover", wallet);
      const signed = await signRecoverTypedData({
        wallet,
        challenge: ch.challenge,
        chainId: BigInt(input.chainId),
      });
      const result = await createRecoveryRequest({
        walletAddresses: [wallet],
        emailSession: input.emailSession,
        challengeId: ch.challengeId,
        ownerKind: "eoa",
        eoaAddress: signed.address,
        eoaSignature: signed.signature,
        label,
        captchaToken: input.captchaToken,
        chainId: input.chainId,
      });
      if (result.existingOwners?.length) {
        for (const owner of result.existingOwners) {
          await enrollPasskeyWithExistingEoa({
            walletAddress: owner.address,
            chainId: input.chainId,
            eoa: owner.eoa,
            advanced: owner.advanced,
            entityId: owner.entityId,
            keyId: owner.keyId,
          });
          existingOwners.push(owner);
        }
      }
      requests.push(...(result.requests ?? []).filter((r) => r));
    }
    return { request: requests[0] ?? null, requests, existingOwners };
  }
  const ch = await createRecoveryChallenge("recover", first);
  const passkey =
    input.signer === "yubikey"
      ? await createSecurityKey(label, { walletLabel: first ? shortAddress(first) : label })
      : await createPasskey(label, { walletLabel: first ? shortAddress(first) : label, deviceLabel: label });
  const { assertion } = await assertPasskeyChallenge({
    challengeBase64Url: ch.challenge,
    credentialId: passkey.credentialId,
  });
  const result = await createRecoveryRequest({
    walletAddresses: input.walletAddresses,
    emailSession: input.emailSession,
    challengeId: ch.challengeId,
    ownerKind: input.signer,
    ownerQx: passkey.qx,
    ownerQy: passkey.qy,
    credentialId: passkey.credentialId,
    label,
    assertion,
    captchaToken: input.captchaToken,
    chainId: input.chainId,
  });
  return {
    request: result.request,
    requests: result.requests ?? (result.request ? [result.request] : []),
    existingOwners: result.existingOwners ?? [],
  };
}
