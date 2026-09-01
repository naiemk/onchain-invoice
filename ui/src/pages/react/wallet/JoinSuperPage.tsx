import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getAddress, zeroPadValue } from "ethers";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { PageCard, PageSplit } from "@/components/PageSplit";
import { useLocale } from "@/providers/LocaleProvider";
import { fetchWalletConfig, parseSuperJoinFromUrl } from "@/shared/wallet-api.js";
import {
  createKeyEnrollmentRequest,
  fetchAdvancedPolicy,
  getKeyEnrollmentRequest,
  listWalletEntities,
} from "@/shared/wallet-advanced-api.js";
import {
  computeKeyId,
  hashEntityEmail,
  KEY_EOA,
  KEY_WEBAUTHN,
  KEY_YUBIKEY,
} from "../../../../../commerce/shared/advanced-wallet.js";
import { passkeyToKeyFields } from "@/shared/advanced-userop-client.js";
import { saveMemberWalletSession } from "@/shared/wallet-session.js";
import {
  createPasskey,
  createSecurityKey,
  isYubiKeyPinRequiredError,
} from "@/shared/webauthn.js";
import { connectEoaWallet, initEoaConnector } from "@/shared/eoa-connector.js";
import { WalletFrame } from "./WalletFrame";

const POLL_MS = 2500;

type StatusKind = "info" | "error" | "success";

export function JoinSuperPage() {
  const { t } = useLocale();
  const navigate = useNavigate();
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [chainId, setChainId] = useState<string>("");
  const [notAdvanced, setNotAdvanced] = useState(false);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState("");
  const [waiting, setWaiting] = useState(false);
  const [showYubiHelp, setShowYubiHelp] = useState(false);
  const [status, setStatus] = useState<{ kind: StatusKind; message: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const join = parseSuperJoinFromUrl();
    if (!join) {
      navigate("/wallet", { replace: true });
      return;
    }
    let addr: string;
    try {
      addr = getAddress(join.walletAddress);
    } catch {
      navigate("/wallet", { replace: true });
      return;
    }
    setWalletAddress(addr);
    setChainId(join.chainId);

    let cancelled = false;
    void (async () => {
      try {
        const cfg = await fetchWalletConfig();
        await initEoaConnector(cfg);
        const policy = await fetchAdvancedPolicy(addr).catch(() => null);
        if (cancelled) return;
        setNotAdvanced(!policy?.advanced);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      if (pollRef.current) clearTimeout(pollRef.current);
    };
  }, [navigate]);

  const pollUntilApproved = async (
    requestId: string,
    material: {
      entityId: string;
      keyType: number;
      qx: string;
      qy: string;
      eoa: string;
      credentialId?: string;
      rawId?: string;
      label: string;
    }
  ) => {
    if (!walletAddress) return;
    setWaiting(true);
    const deadline = Date.now() + 15 * 60 * 1000;

    const tick = async (): Promise<void> => {
      try {
        const request = await getKeyEnrollmentRequest(walletAddress, requestId);
        if (request.status === "approved") {
          const keyId = computeKeyId(material.entityId, material.keyType, material.qx, material.qy, material.eoa);
          saveMemberWalletSession({
            address: walletAddress,
            chainId,
            entityId: material.entityId,
            keyId,
            keyType: material.keyType,
            qx: material.qx,
            qy: material.qy,
            credentialId: material.credentialId ?? "",
            rawId: material.rawId ?? "",
            label: material.label,
            eoa: material.keyType === KEY_EOA ? material.eoa : undefined,
          });
          setWaiting(false);
          setStatus({ kind: "success", message: t("wallet.joinSuperApproved") });
          navigate("/wallet", { replace: true });
          return;
        }
        if (request.status === "rejected" || request.status === "expired") {
          setWaiting(false);
          setStatus({ kind: "error", message: t("wallet.joinSuperRejected") });
          return;
        }
        if (Date.now() >= deadline) {
          setWaiting(false);
          setStatus({ kind: "error", message: t("wallet.joinSuperTimeout") });
          return;
        }
        pollRef.current = setTimeout(() => void tick(), POLL_MS);
      } catch (error) {
        setWaiting(false);
        setStatus({
          kind: "error",
          message: error instanceof Error ? error.message : String(error),
        });
      }
    };

    await tick();
  };

  const enroll = async (
    keyType: number,
    material: {
      qx: string;
      qy: string;
      eoa: string;
      credentialId?: string;
      rawId?: string;
    }
  ) => {
    if (!walletAddress) return;
    const trimmed = email.trim();
    if (!trimmed) {
      setStatus({ kind: "error", message: t("wallet.superWalletEmailRequired") });
      return;
    }
    const entityId = hashEntityEmail(trimmed);
    const roster = await listWalletEntities(walletAddress);
    if (!roster.entities.some((e) => e.entityId === entityId)) {
      setStatus({ kind: "error", message: t("wallet.joinSuperEntityMissing") });
      return;
    }
    setStatus({ kind: "info", message: t("wallet.joinSuperSubmitting") });
    const request = await createKeyEnrollmentRequest({
      walletAddress,
      entityId,
      keyType,
      qx: material.qx,
      qy: material.qy,
      eoa: material.eoa,
      credentialId: material.credentialId ?? null,
      label: trimmed,
    });
    await pollUntilApproved(request.id, {
      entityId,
      keyType,
      ...material,
      label: trimmed,
    });
  };

  if (loading) {
    return (
      <WalletFrame current="pair" title={t("wallet.joinSuperTitle")} lede={t("wallet.joinSuperLede")}>
        <Skeleton className="h-24 w-full" />
      </WalletFrame>
    );
  }

  if (notAdvanced) {
    return (
      <WalletFrame current="pair" title={t("wallet.joinSuperTitle")} lede={t("wallet.joinSuperNotAdvanced")}>
        <p className="text-sm text-muted-foreground">{t("wallet.joinSuperNotAdvancedHint")}</p>
      </WalletFrame>
    );
  }

  return (
    <WalletFrame current="pair" title={t("wallet.joinSuperTitle")} lede={t("wallet.joinSuperLede")}>
      <PageSplit>
        <PageCard>
          <div className="space-y-6">
            {walletAddress && (
              <p className="font-mono text-xs text-muted-foreground">{walletAddress}</p>
            )}

            <div className="space-y-2">
              <Label htmlFor="join-email">{t("wallet.joinSuperEmail")}</Label>
              <Input
                id="join-email"
                type="email"
                autoComplete="email"
                placeholder="you@company.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={waiting}
              />
            </div>

            <div className="flex flex-wrap gap-2">
              <Button
                id="join-passkey"
                type="button"
                disabled={waiting || busy !== null}
                onClick={async () => {
                  setBusy("passkey");
                  try {
                    const passkey = await createPasskey(t("wallet.joinSuperPasskeyLabel"), { attachment: "platform" });
                    const fields = passkeyToKeyFields(passkey);
                    await enroll(KEY_WEBAUTHN, {
                      qx: fields.qx,
                      qy: fields.qy,
                      eoa: zeroPadValue("0x00", 20),
                      credentialId: fields.credentialId,
                      rawId: passkey.rawId,
                    });
                  } catch (error) {
                    setStatus({
                      kind: "error",
                      message: error instanceof Error ? error.message : String(error),
                    });
                  } finally {
                    setBusy(null);
                  }
                }}
              >
                {t("wallet.joinSuperPasskey")}
              </Button>
              <Button
                id="join-yubikey"
                type="button"
                variant="outline"
                disabled={waiting || busy !== null}
                onClick={async () => {
                  setBusy("yubikey");
                  try {
                    const passkey = await createSecurityKey(t("wallet.joinSuperYubiKeyLabel"));
                    const fields = passkeyToKeyFields(passkey);
                    await enroll(KEY_YUBIKEY, {
                      qx: fields.qx,
                      qy: fields.qy,
                      eoa: zeroPadValue("0x00", 20),
                      credentialId: fields.credentialId,
                      rawId: passkey.rawId,
                    });
                  } catch (error) {
                    if (isYubiKeyPinRequiredError(error)) {
                      setShowYubiHelp(true);
                      setStatus({ kind: "error", message: t("wallet.yubikeyPinRequiredTitle") });
                    } else {
                      setStatus({
                        kind: "error",
                        message: error instanceof Error ? error.message : String(error),
                      });
                    }
                  } finally {
                    setBusy(null);
                  }
                }}
              >
                {t("wallet.joinSuperYubiKey")}
              </Button>
              <Button
                id="join-eoa"
                type="button"
                variant="outline"
                disabled={waiting || busy !== null}
                onClick={async () => {
                  setBusy("eoa");
                  try {
                    const eoa = getAddress(await connectEoaWallet());
                    await enroll(KEY_EOA, {
                      qx: zeroPadValue("0x00", 32),
                      qy: zeroPadValue("0x00", 32),
                      eoa,
                      credentialId: "",
                      rawId: "",
                    });
                  } catch (error) {
                    setStatus({
                      kind: "error",
                      message: error instanceof Error ? error.message : String(error),
                    });
                  } finally {
                    setBusy(null);
                  }
                }}
              >
                {t("wallet.joinSuperEoa")}
              </Button>
            </div>

            {showYubiHelp && (
              <Alert variant="warn">
                <AlertDescription>{t("wallet.yubikeyPinRequiredWhy")}</AlertDescription>
              </Alert>
            )}

            {waiting && (
              <p id="join-wait" className="text-sm text-muted-foreground">
                {t("wallet.joinSuperWaiting")}
              </p>
            )}

            {status && (
              <p
                id="join-status"
                role="status"
                className={
                  status.kind === "error"
                    ? "text-sm text-destructive"
                    : status.kind === "success"
                      ? "text-sm text-ok"
                      : "text-sm text-muted-foreground"
                }
              >
                {status.message}
              </p>
            )}
          </div>
        </PageCard>

        <PageCard>
          <h2 className="text-base font-semibold">{t("wallet.superWalletTeamJoinTitle")}</h2>
          <p className="mt-2 text-sm text-muted-foreground">{t("wallet.superWalletTeamJoinIntro")}</p>
          <ol className="mt-4 space-y-4">
            {[t("wallet.superWalletTeamJoinStep1"), t("wallet.superWalletTeamJoinStep2"), t("wallet.superWalletTeamJoinStep3")].map(
              (step, i) => (
                <li key={step} className="flex gap-3 text-sm">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
                    {i + 1}
                  </span>
                  <span className="text-muted-foreground">{step}</span>
                </li>
              )
            )}
          </ol>
        </PageCard>
      </PageSplit>
    </WalletFrame>
  );
}
