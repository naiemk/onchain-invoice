import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Fingerprint, KeyRound, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageCard } from "@/components/PageSplit";
import { TurnstileWidget, type TurnstileControl } from "@/components/TurnstileWidget";
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
type EmailStep = "email" | "otp" | "wallets" | "done";

export function RecoverPage() {
  const { t } = useLocale();
  const [siteKey, setSiteKey] = useState<string | null>(null);
  const [timelockHours, setTimelockHours] = useState(24);
  const [chainId, setChainId] = useState("11155111");

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
      <PageCard className="mx-auto max-w-lg">
        <p className="mb-4 text-xs text-muted-foreground">{t("wallet.recoveryTimelock", { hours: timelockHours })}</p>
        <Tabs defaultValue="email">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="email">{t("wallet.recoverTabWithEmail")}</TabsTrigger>
            <TabsTrigger value="address">{t("wallet.recoverTabWithoutEmail")}</TabsTrigger>
          </TabsList>
          <TabsContent value="email" className="mt-4">
            <EmailRecoverTab siteKey={siteKey} chainId={chainId} />
          </TabsContent>
          <TabsContent value="address" className="mt-4">
            <AddressRecoverTab siteKey={siteKey} chainId={chainId} />
          </TabsContent>
        </Tabs>
        <p className="mt-6 text-xs text-muted-foreground">
          <Link to="/wallet" className="underline underline-offset-2">
            {t("wallet.backToWallets")}
          </Link>
        </p>
      </PageCard>
    </WalletFrame>
  );
}

function EmailRecoverTab({ siteKey, chainId }: { siteKey: string | null; chainId: string }) {
  const { t } = useLocale();
  const captchaRef = useRef<TurnstileControl | null>(null);
  const [step, setStep] = useState<EmailStep>("email");
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [emailSession, setEmailSession] = useState("");
  const [wallets, setWallets] = useState<RecoveryEmailWallet[]>([]);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [signer, setSigner] = useState<SignerKind>("webauthn");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<RecoveryRequestPublic[]>([]);
  const [enrolled, setEnrolled] = useState<RecoveryExistingOwner[]>([]);

  const requireCaptcha = (): string | null => {
    const token = captchaRef.current?.getToken() ?? null;
    if (siteKey && !token) {
      setError(t("wallet.recoverCaptchaRequired"));
      return null;
    }
    return token;
  };

  const sendCode = async () => {
    if (!email.includes("@")) {
      setError(t("wallet.recoverInvalidEmail"));
      return;
    }
    const captchaToken = requireCaptcha();
    if (siteKey && captchaToken === null) return;
    setBusy(true);
    setError(null);
    try {
      await startRecoveryEmailLookup({ email: email.trim(), captchaToken });
      setStep("otp");
      captchaRef.current?.reset();
    } catch (err) {
      const msg = formatPasskeyError(err);
      setError(msg === "threshold_not_one" ? t("wallet.superWalletPairNeedsOneSigner") : msg);
    } finally {
      setBusy(false);
    }
  };

  const verify = async () => {
    const captchaToken = requireCaptcha();
    if (siteKey && captchaToken === null) return;
    setBusy(true);
    setError(null);
    try {
      const result = await verifyRecoveryEmailLookup({
        email: email.trim(),
        code: otp.trim(),
        captchaToken,
      });
      setEmailSession(result.emailSession);
      const listed = await listRecoveryEmailWallets(result.emailSession);
      setWallets(listed.wallets);
      setSelected(Object.fromEntries(listed.wallets.filter((w) => !w.activeRecovery).map((w) => [w.address, true])));
      setStep("wallets");
      captchaRef.current?.reset();
    } catch (err) {
      const msg = formatPasskeyError(err);
      setError(msg === "threshold_not_one" ? t("wallet.superWalletPairNeedsOneSigner") : msg);
    } finally {
      setBusy(false);
    }
  };

  const initiate = async () => {
    const addresses = wallets.filter((w) => selected[w.address]).map((w) => w.address);
    if (!addresses.length) {
      setError(t("wallet.recoverSelectWallets"));
      return;
    }
    const captchaToken = requireCaptcha();
    if (siteKey && captchaToken === null) return;
    setBusy(true);
    setError(null);
    try {
      const result = await signAndCreate({
        signer,
        walletAddresses: addresses,
        emailSession,
        captchaToken,
        chainId,
      });
      setCreated(result.requests);
      setEnrolled(result.existingOwners);
      setStep("done");
    } catch (err) {
      const msg = formatPasskeyError(err);
      setError(msg === "threshold_not_one" ? t("wallet.superWalletPairNeedsOneSigner") : msg);
    } finally {
      setBusy(false);
    }
  };

  if (step === "done") {
    return <DoneState requests={created} enrolled={enrolled} />;
  }

  return (
    <div className="space-y-4">
      {step === "email" && (
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
      )}
      {step === "otp" && (
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">{t("wallet.recoverOtpSent")}</p>
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
      )}
      {step === "wallets" && (
        <div className="space-y-3">
          {wallets.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("wallet.recoverNoWalletsForEmail")}</p>
          ) : (
            wallets.map((w) => (
              <label key={w.address} className="flex items-start gap-3 rounded-xl border border-border px-3 py-3">
                <Checkbox
                  checked={Boolean(selected[w.address])}
                  disabled={w.activeRecovery}
                  onCheckedChange={(v) => setSelected((prev) => ({ ...prev, [w.address]: v === true }))}
                />
                <span className="min-w-0">
                  <span className="block font-mono text-sm">{shortAddress(w.address)}</span>
                  {w.activeRecovery ? (
                    <span className="text-xs text-muted-foreground">{t("wallet.recoverAlreadyActive")}</span>
                  ) : null}
                </span>
              </label>
            ))
          )}
          <SignerPicker value={signer} onChange={setSigner} />
        </div>
      )}
      <TurnstileWidget siteKey={siteKey} controlRef={captchaRef} />
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {step === "email" && (
        <Button type="button" disabled={busy} onClick={() => void sendCode()}>
          {t("wallet.emailWizardSend")}
        </Button>
      )}
      {step === "otp" && (
        <Button type="button" disabled={busy || otp.trim().length < 6} onClick={() => void verify()}>
          {t("wallet.recoverVerifyOtp")}
        </Button>
      )}
      {step === "wallets" && wallets.length > 0 && (
        <Button type="button" disabled={busy} onClick={() => void initiate()}>
          {t("wallet.recoverStart")}
        </Button>
      )}
    </div>
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
    const captchaToken = captchaRef.current?.getToken() ?? null;
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
      <TurnstileWidget siteKey={siteKey} controlRef={captchaRef} />
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <Button type="button" disabled={busy} onClick={() => void initiate()}>
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
      {requests.length > 0 ? <p className="text-sm">{t("wallet.recoverSubmitted")}</p> : null}
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
