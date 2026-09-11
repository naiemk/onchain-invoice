import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useLocale } from "@/providers/LocaleProvider";
import { fetchWalletBalance, fetchWalletConfig, waitForUserOp, walletChainIsFunded } from "@/shared/wallet-api.js";
import { subscribePageVisible } from "@/shared/page-visibility.js";
import {
  registerWalletEntity,
  resolveAdvancedPolicy,
  type AdvancedPolicy,
} from "@/shared/wallet-advanced-api.js";
import { hashEntityEmail } from "../../../../../commerce/shared/advanced-wallet.js";
import { buildSignedEnableAdvancedUserOp } from "@/shared/advanced-userop-client.js";
import { submitSignedUserOp } from "@/shared/userop-client.js";
import { resolveCurrentWalletPasskey } from "@/shared/current-wallet-passkey.js";
import { loadWalletSession, walletSessionsEquivalent, type WalletSession } from "@/shared/wallet-session.js";
import { healWalletSession } from "@/shared/wallet-session-heal.js";
import { saveWalletMode } from "@/shared/wallet-mode.js";
import { initEoaConnector } from "@/shared/eoa-connector.js";
import type { WalletPublicConfig } from "../../../../../commerce/shared/wallet.js";
import { WalletFrame } from "./WalletFrame";
import { useWalletPolicy } from "./wallet-policy";
import {
  assertUpgradePreflight,
  confirmAdvancedUpgrade,
  formatUserOpRejectReason,
  persistSessionAfterUpgrade,
  registerAdminEntityPasskeys,
} from "./super-wallet-helpers";

type StatusKind = "info" | "error" | "success";

function StatusMessage({ kind, message }: { kind: StatusKind; message: string }) {
  return (
    <p
      id="super-status"
      role="status"
      className={
        kind === "error"
          ? "text-sm text-destructive"
          : kind === "success"
            ? "text-sm text-ok"
            : "text-sm text-muted-foreground"
      }
    >
      {message}
    </p>
  );
}

export function SuperWalletPage() {
  const { t } = useLocale();
  const navigate = useNavigate();
  const { refreshPolicy } = useWalletPolicy();
  const [session, setSession] = useState<WalletSession | null>(() => loadWalletSession());
  const [config, setConfig] = useState<WalletPublicConfig | null>(null);
  const [policy, setPolicy] = useState<AdvancedPolicy | null>(null);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<{ kind: StatusKind; message: string } | null>(null);

  const [adminEmail, setAdminEmail] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [emailSpellingChecked, setEmailSpellingChecked] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [onChainReady, setOnChainReady] = useState(false);
  const [funded, setFunded] = useState(false);

  const refresh = useCallback(
    async (sess: WalletSession, _cfg: WalletPublicConfig) => {
      const balance = await fetchWalletBalance(sess.address).catch(() => null);
      const deployed = balance?.chains.some((c) => c.deployed) ?? false;
      setOnChainReady(deployed);
      setFunded(balance?.chains.some((c) => walletChainIsFunded(c.balance)) ?? false);
      const pol = await resolveAdvancedPolicy(sess.address, deployed);
      setPolicy(pol);
      if (pol.advanced) {
        navigate("/wallet", { replace: true });
      }
    },
    [navigate]
  );

  useEffect(() => {
    const sess = loadWalletSession();
    if (!sess) {
      navigate("/wallet", { replace: true });
      return;
    }
    setSession(sess);
    saveWalletMode("advanced");

    let cancelled = false;
    void (async () => {
      setLoading(true);
      try {
        const cfg = await fetchWalletConfig();
        await initEoaConnector(cfg);
        if (cancelled) return;
        setConfig(cfg);
        const healed = await healWalletSession(sess);
        if (cancelled) return;
        if (!walletSessionsEquivalent(healed.session, sess)) {
          setSession(healed.session);
          await refresh(healed.session, cfg);
        } else {
          await refresh(sess, cfg);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [navigate, refresh]);

  useEffect(() => {
    if (!session || !config) return;
    return subscribePageVisible(() => {
      void refresh(session, config);
    });
  }, [session, config, refresh]);

  useEffect(() => {
    if (!session || !config || onChainReady || policy?.advanced) return;
    const id = window.setInterval(() => {
      void refresh(session, config);
    }, 3_000);
    return () => window.clearInterval(id);
  }, [session, config, onChainReady, policy?.advanced, refresh]);

  const runRefresh = async () => {
    if (!session || !config) return;
    await refresh(session, config);
  };

  const requestUpgrade = () => {
    if (!adminEmail.trim()) {
      setStatus({ kind: "error", message: t("wallet.superWalletEmailRequired") });
      return;
    }
    setEmailSpellingChecked(false);
    setConfirmOpen(true);
  };

  const runUpgrade = async () => {
    if (!session || !config) return;
    setConfirmOpen(false);
    setBusy("upgrade");
    setStatus({ kind: "info", message: t("wallet.sendSigning") });
    try {
      await assertUpgradePreflight(session, config);
      const passkey = await resolveCurrentWalletPasskey(session, "enable-advanced");
      const signingSession = { ...session, qx: passkey.qx, qy: passkey.qy, credentialId: passkey.credentialId };
      if (signingSession !== session) setSession(signingSession);
      const email = adminEmail.trim();
      const adminEntityId = hashEntityEmail(email);
      const fee = BigInt(config.bundlerFeeUsdc || "0");
      const { userOp, userOpHash } = await buildSignedEnableAdvancedUserOp({
        config,
        passkey,
        adminEntityId,
        feeAmount: fee,
      });
      await submitSignedUserOp({ config, userOp, userOpHash, walletAddress: session.address });
      const result = await waitForUserOp(userOpHash);
      if (result.status !== "included") {
        throw new Error(formatUserOpRejectReason(result.rejectReason ?? result.status));
      }
      await confirmAdvancedUpgrade(session.address);
      await registerWalletEntity({ walletAddress: session.address, entityId: adminEntityId, label: email });
      await registerAdminEntityPasskeys({
        walletAddress: signingSession.address,
        chainId: config.chainId,
        adminEntityId,
        qx: signingSession.qx,
        qy: signingSession.qy,
        credentialId: signingSession.credentialId ?? null,
      });
      persistSessionAfterUpgrade(signingSession, adminEntityId, email);
      await refreshPolicy();
      navigate("/wallet", { replace: true });
    } catch (error) {
      setStatus({
        kind: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setBusy(null);
    }
  };

  if (!session) return null;

  const canUpgrade = Boolean(policy?.supportsAdvanced !== false);

  return (
    <WalletFrame current="superWallet" title={t("wallet.superWalletPageTitle")} lede={t("wallet.superWalletPageLede")}>
      {status && <StatusMessage kind={status.kind} message={status.message} />}
      {loading ? (
        <div className="space-y-4">
          <Skeleton className="h-8 w-2/3" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-10 w-40" />
        </div>
      ) : !policy?.advanced && !canUpgrade ? (
        <UnsupportedSection t={t} />
      ) : (
        <UpgradeSection
          t={t}
          adminEmail={adminEmail}
          onAdminEmailChange={setAdminEmail}
          onConvert={requestUpgrade}
          busy={busy === "upgrade"}
          onChainReady={onChainReady}
          funded={funded}
          onRefresh={() => void runRefresh()}
        />
      )}

      <Dialog
        open={confirmOpen}
        onOpenChange={(open) => {
          setConfirmOpen(open);
          if (!open) setEmailSpellingChecked(false);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("wallet.superWalletUpgradeConfirmEmailTitle")}</DialogTitle>
            <DialogDescription>{t("wallet.superWalletUpgradeConfirmNoVerify")}</DialogDescription>
          </DialogHeader>
          <p
            data-testid="super-wallet-confirm-email"
            className="break-all rounded-md border bg-muted/50 px-3 py-2 font-mono text-sm font-medium"
          >
            {adminEmail.trim()}
          </p>
          <p className="text-sm font-medium">{t("wallet.superWalletUpgradeConfirmSpelling")}</p>
          <p className="text-sm text-muted-foreground">{t("wallet.superWalletUpgradeConfirm")}</p>
          <div className="flex items-start gap-2">
            <Checkbox
              id="super-wallet-spelling-check"
              data-testid="super-wallet-spelling-check"
              checked={emailSpellingChecked}
              onCheckedChange={(checked) => setEmailSpellingChecked(checked === true)}
            />
            <Label htmlFor="super-wallet-spelling-check" className="text-sm font-normal leading-snug">
              {t("wallet.superWalletUpgradeConfirmSpellingCheck")}
            </Label>
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="outline" onClick={() => setConfirmOpen(false)}>
              {t("wallet.cancel")}
            </Button>
            <Button
              type="button"
              disabled={busy === "upgrade" || !emailSpellingChecked}
              onClick={() => void runUpgrade()}
            >
              {t("wallet.superWalletUpgradeConfirmSpellingCta")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </WalletFrame>
  );
}

function UpgradeSection({
  t,
  adminEmail,
  onAdminEmailChange,
  onConvert,
  busy,
  onChainReady,
  funded,
  onRefresh,
}: {
  t: (k: string) => string;
  adminEmail: string;
  onAdminEmailChange: (v: string) => void;
  onConvert: () => void;
  busy: boolean;
  onChainReady: boolean;
  funded: boolean;
  onRefresh: () => void;
}) {
  const features = [
    t("wallet.superWalletFeatureMultisig"),
    t("wallet.superWalletFeatureMixedKeys"),
    t("wallet.superWalletFeatureProposals"),
    t("wallet.superWalletFeatureIrreversible"),
  ];

  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">{t("wallet.superWalletUpgradeTitle")}</h2>
        <div>
          <h3 className="text-sm font-medium">{t("wallet.superWalletFeaturesTitle")}</h3>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
            {features.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
        </div>
      </section>

      {funded && !onChainReady && (
        <Alert variant="warn">
          <AlertDescription className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <span>{t("wallet.userOpAccountNotDeployed")}</span>
            <Button type="button" size="sm" variant="secondary" className="gap-2 self-start" onClick={onRefresh}>
              <RefreshCw className="h-4 w-4" />
              {t("wallet.refresh")}
            </Button>
          </AlertDescription>
        </Alert>
      )}
      <Alert variant="warn">
        <AlertDescription>{t("wallet.superWalletUpgradeWarning")}</AlertDescription>
      </Alert>
      <p className="text-sm text-muted-foreground">{t("wallet.superWalletUpgradeNeedFunds")}</p>

      <section className="space-y-3">
        <div>
          <h3 className="text-sm font-medium">{t("wallet.superWalletEmailWhyTitle")}</h3>
          <p className="mt-1 text-sm text-muted-foreground">{t("wallet.superWalletEmailWhy")}</p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="admin-email">{t("wallet.superWalletAdminEmail")}</Label>
          <Input
            id="admin-email"
            type="email"
            autoComplete="email"
            placeholder="you@company.com"
            value={adminEmail}
            onChange={(e) => onAdminEmailChange(e.target.value)}
          />
        </div>
      </section>

      <Button id="enable-advanced" type="button" disabled={busy} onClick={onConvert}>
        {busy ? t("wallet.sendSigning") : t("wallet.superWalletConvertCta")}
      </Button>
    </div>
  );
}

function UnsupportedSection({ t }: { t: (k: string) => string }) {
  return (
    <div className="space-y-6">
      <h2 className="text-lg font-semibold">{t("wallet.superWalletUnsupportedTitle")}</h2>
      <Alert variant="warn">
        <AlertDescription>{t("wallet.superWalletUnsupportedBody")}</AlertDescription>
      </Alert>
      <Button asChild>
        <Link to="/wallet/create">{t("wallet.createAnother")}</Link>
      </Button>
    </div>
  );
}
