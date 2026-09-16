import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import QRCode from "qrcode";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageCard } from "@/components/PageSplit";
import { Stepper } from "@/components/Stepper";
import { useLocale } from "@/providers/LocaleProvider";
import { copyText } from "@/shared/dom.js";
import {
  encodeIdentityPairLink,
  fetchIdentityMe,
  fetchIdentityPairReady,
  loginIdentityPasskey,
  parseIdentityIdParam,
  type IdentityPairPayload,
} from "@/shared/identity-api.js";
import { formatPairPasskeyName, inferDeviceLabel } from "@/shared/passkey-name.js";
import {
  clearPendingPasskey,
  createPasskey,
  formatPasskeyError,
  type PasskeyOwner,
} from "@/shared/webauthn.js";
import { fetchWalletConfig, registerDevice } from "@/shared/wallet-api.js";
import { resolveWalletLabel } from "@/shared/wallet-label.js";
import { listWalletRegistry, saveWalletSession } from "@/shared/wallet-session.js";
import { WalletFrame } from "./WalletFrame";

type PairStep = 1 | 2 | 3;

const PAIR_DRAFT_KEY = "tc-identity-pair-draft";

type PairDraft = {
  identityId: string;
  email: string;
  deviceName: string;
  owner: PasskeyOwner;
  pairUrl: string;
};

function readPairDraft(): PairDraft | null {
  try {
    const raw = sessionStorage.getItem(PAIR_DRAFT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PairDraft>;
    if (!parsed.identityId || !parsed.owner?.credentialId || !parsed.owner.qx || !parsed.owner.qy || !parsed.pairUrl) {
      return null;
    }
    return parsed as PairDraft;
  } catch {
    return null;
  }
}

function writePairDraft(draft: PairDraft): void {
  sessionStorage.setItem(PAIR_DRAFT_KEY, JSON.stringify(draft));
}

function clearPairDraft(): void {
  sessionStorage.removeItem(PAIR_DRAFT_KEY);
}

function isNotPairedYet(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /not_found|identity_not_found|not found|404/i.test(message);
}

export function PairPage() {
  const { t } = useLocale();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [draft] = useState(() => readPairDraft());
  const [step, setStep] = useState<PairStep>(() => (draft ? 2 : 1));
  const [deviceName, setDeviceName] = useState(() => draft?.deviceName || inferDeviceLabel());
  const [identityId, setIdentityId] = useState<string | undefined>(() =>
    draft?.identityId ?? parseIdentityIdParam(searchParams.get("identityId"))
  );
  const [email, setEmail] = useState(() => draft?.email || searchParams.get("email")?.trim() || "");
  const [owner, setOwner] = useState<PasskeyOwner | null>(() => draft?.owner ?? null);
  const [pairUrl, setPairUrl] = useState<string | null>(() => draft?.pairUrl ?? null);
  const [qrSrc, setQrSrc] = useState<string | null>(null);
  const [showLink, setShowLink] = useState(false);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [waitingLong, setWaitingLong] = useState(false);
  const pollFailsRef = useRef(0);

  const steps = useMemo(
    () => [
      { id: 1, label: t("wallet.pairWizardWhat") },
      { id: 2, label: t("wallet.pairWizardShare") },
      { id: 3, label: t("wallet.pairWizardPaired") },
    ],
    [t]
  );

  useEffect(() => {
    void (async () => {
      const me = await fetchIdentityMe().catch(() => null);
      if (me?.identityId) setIdentityId(me.identityId);
      if (me?.email) setEmail(me.email);
    })();
  }, []);

  const buildShare = useCallback(
    async (next: PasskeyOwner, nextIdentityId: string, nextEmail: string, nextDeviceName: string) => {
      const payload: IdentityPairPayload = {
        v: 2,
        identityId: nextIdentityId,
        qx: next.qx,
        qy: next.qy,
        credentialId: next.credentialId,
      };
      const url = encodeIdentityPairLink(window.location.origin, payload);
      writePairDraft({
        identityId: nextIdentityId,
        email: nextEmail,
        deviceName: nextDeviceName,
        owner: next,
        pairUrl: url,
      });
      setPairUrl(url);
      setQrSrc(await QRCode.toDataURL(url, { margin: 1, width: 200 }));
      setOwner(next);
      setStep(2);
    },
    []
  );

  useEffect(() => {
    if (!pairUrl) return;
    let cancelled = false;
    void QRCode.toDataURL(pairUrl, { margin: 1, width: 200 }).then((src) => {
      if (!cancelled) setQrSrc(src);
    });
    return () => {
      cancelled = true;
    };
  }, [pairUrl]);

  const createPairPasskey = async () => {
    setBusy(true);
    setError(null);
    try {
      const me = await fetchIdentityMe().catch(() => null);
      const nextIdentityId =
        me?.identityId ?? parseIdentityIdParam(searchParams.get("identityId")) ?? identityId;
      if (!nextIdentityId) throw new Error(t("wallet.pairNeedIdentity"));
      const nextEmail = me?.email ?? email;
      const label = deviceName.trim() || inferDeviceLabel();
      const walletLabel = formatPairPasskeyName(nextEmail, label);
      const created = await createPasskey(label, {
        purpose: "pair",
        identityId: nextIdentityId,
        email: nextEmail || undefined,
        walletLabel,
        deviceLabel: label,
      });
      setIdentityId(nextIdentityId);
      if (nextEmail) setEmail(nextEmail);
      await buildShare(created, nextIdentityId, nextEmail, label);
    } catch (err) {
      setError(formatPasskeyError(err));
    } finally {
      setBusy(false);
    }
  };

  const markPaired = useCallback(() => {
    setWaitingLong(false);
    setError(null);
    setStep(3);
  }, []);

  const pairingComplete = useCallback(async (next: PasskeyOwner): Promise<boolean> => {
    try {
      const ready = await fetchIdentityPairReady({
        credentialId: next.credentialId,
        qx: next.qx,
        qy: next.qy,
      });
      if (!ready) return false;
      await loginIdentityPasskey(next.credentialId, { qx: next.qx, qy: next.qy });
      return true;
    } catch (err) {
      if (isNotPairedYet(err)) return false;
      throw err;
    }
  }, []);

  useEffect(() => {
    if (step !== 2 || !owner?.credentialId) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const ready = await pairingComplete(owner);
        if (cancelled) return;
        pollFailsRef.current = 0;
        if (ready) markPaired();
      } catch (err) {
        if (cancelled) return;
        if (isNotPairedYet(err)) return;
        pollFailsRef.current += 1;
        if (pollFailsRef.current >= 3) {
          setError(err instanceof Error ? err.message : String(err));
        }
      }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 1500);
    const longWait = window.setTimeout(() => {
      if (!cancelled) setWaitingLong(true);
    }, 12_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.clearTimeout(longWait);
    };
  }, [markPaired, owner, pairingComplete, step]);

  const checkNow = async () => {
    if (!owner) return;
    setChecking(true);
    setError(null);
    try {
      const ready = await pairingComplete(owner);
      if (ready) markPaired();
      else setError(t("wallet.pairNotReady"));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setChecking(false);
    }
  };

  const copyLink = async () => {
    if (!pairUrl) return;
    await copyText(pairUrl);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };

  const openWallet = async () => {
    if (!owner) return;
    setBusy(true);
    setError(null);
    try {
      const login = await loginIdentityPasskey(owner.credentialId, { qx: owner.qx, qy: owner.qy });
      const config = await fetchWalletConfig();
      const registry = listWalletRegistry();
      const first = login.wallets[0];
      if (!first) throw new Error(t("wallet.unlockNotFound"));
      for (const [index, w] of login.wallets.entries()) {
        const existing = registry.find((row) => row.address.toLowerCase() === w.address.toLowerCase());
        const label = resolveWalletLabel({
          saved: existing?.label,
          server: w.label,
          index,
          fallback: t("wallet.defaultWalletName"),
        });
        saveWalletSession({
          address: w.address,
          chainId: config.chainId,
          salt: w.salt,
          qx: owner.qx || w.ownerQx,
          qy: owner.qy || w.ownerQy,
          credentialId: owner.credentialId,
          rawId: owner.rawId,
          label,
          identityId: login.identityId,
        });
      }
      await registerDevice({
        walletAddress: first.address,
        chainId: config.chainId,
        ownerQx: owner.qx || first.ownerQx,
        ownerQy: owner.qy || first.ownerQy,
        label: deviceName.trim() || inferDeviceLabel(),
        credentialId: owner.credentialId,
      }).catch(() => undefined);
      clearPendingPasskey(owner.credentialId);
      clearPairDraft();
      navigate("/wallet");
    } catch (err) {
      setError(formatPasskeyError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <WalletFrame current="pair" title={t("wallet.pairPageTitle")} lede={t("wallet.pairPageLede")} showChrome={false}>
      <PageCard className="mx-auto max-w-lg space-y-4">
        <Stepper steps={steps} current={step} />

        {step === 1 ? (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">{t("wallet.pairFromNewDeviceLede")}</p>
            <div className="space-y-2">
              <Label htmlFor="pair-device-name">{t("wallet.deviceName")}</Label>
              <p className="text-xs text-muted-foreground">{t("wallet.deviceNameHint")}</p>
              <Input
                id="pair-device-name"
                value={deviceName}
                onChange={(e) => setDeviceName(e.target.value)}
                placeholder={t("wallet.deviceNamePlaceholder")}
              />
            </div>
            <Button
              type="button"
              id="pair-submit"
              className="w-full"
              disabled={busy}
              onClick={() => void createPairPasskey()}
            >
              {busy ? t("wallet.creatingPasskey") : t("wallet.pairSubmit")}
            </Button>
          </div>
        ) : null}

        {step === 2 ? (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">{t("wallet.pairScanOnExisting")}</p>
            <div>
              <p className="text-sm font-medium">{t("wallet.pairShareHowTitle")}</p>
              <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-sm text-muted-foreground">
                <li>{t("wallet.pairShareStep1")}</li>
                <li>{t("wallet.pairShareStep2")}</li>
                <li>{t("wallet.pairShareStep3")}</li>
                <li>{t("wallet.pairShareStep4")}</li>
                <li>{t("wallet.pairShareStep5")}</li>
              </ol>
            </div>
            <div className="flex justify-center">
              {qrSrc ? (
                <img id="pair-qr" src={qrSrc} alt={t("wallet.qrAlt")} width={200} height={200} />
              ) : (
                <div id="pair-qr" className="h-[200px] w-[200px] rounded-md bg-muted" />
              )}
            </div>
            <div className="space-y-2">
              <Button type="button" variant="ghost" size="sm" onClick={() => setShowLink((v) => !v)}>
                {showLink ? t("wallet.pairLinkHide") : t("wallet.pairLinkShow")}
              </Button>
              {showLink && pairUrl ? (
                <div className="space-y-2">
                  <code
                    data-testid="pair-link-url"
                    className="block break-all rounded-md bg-muted px-2 py-2 text-xs"
                  >
                    {pairUrl}
                  </code>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    data-testid="pair-copy-link"
                    data-url={pairUrl}
                    onClick={() => void copyLink()}
                  >
                    {copied ? t("wallet.copied") : t("wallet.pairLinkCopy")}
                  </Button>
                </div>
              ) : null}
            </div>
            <p className="text-sm text-muted-foreground">{t("wallet.pairWaiting")}</p>
            {waitingLong ? <p className="text-sm text-muted-foreground">{t("wallet.pairStillWaiting")}</p> : null}
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button
                type="button"
                variant="outline"
                className="flex-1"
                disabled={checking || busy}
                onClick={() => void checkNow()}
              >
                {checking ? t("wallet.pairChecking") : t("wallet.pairCheckNow")}
              </Button>
              {waitingLong ? (
                <Button type="button" className="flex-1" disabled={busy} onClick={() => navigate("/wallet")}>
                  {t("wallet.pairOpenWallet")}
                </Button>
              ) : null}
            </div>
          </div>
        ) : null}

        {step === 3 ? (
          <div className="space-y-4">
            <p className="text-sm font-medium">{t("wallet.youArePaired")}</p>
            <p className="text-sm text-muted-foreground">{t("wallet.pairLoginHint")}</p>
            <Button type="button" className="w-full" disabled={busy} onClick={() => void openWallet()}>
              {busy ? t("wallet.pairLoggingIn") : t("wallet.pairOpenWallet")}
            </Button>
          </div>
        ) : null}

        {error ? (
          <p className="text-sm text-destructive" role="status">
            {error}
          </p>
        ) : null}
      </PageCard>
    </WalletFrame>
  );
}
