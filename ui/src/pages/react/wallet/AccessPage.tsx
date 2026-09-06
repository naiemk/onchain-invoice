import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { getAddress, zeroPadValue } from "ethers";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { PageCard, PageSplit } from "@/components/PageSplit";
import { StatusBadge } from "@/components/StatusBadge";
import { TrustNotice } from "@/components/TrustNotice";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useLocale } from "@/providers/LocaleProvider";
import { fetchWalletBalance, fetchWalletConfig, waitForUserOp } from "@/shared/wallet-api.js";
import { subscribePageVisible } from "@/shared/page-visibility.js";
import {
  approveKeyEnrollmentRequest,
  listKeyEnrollmentRequests,
  listWalletEntities,
  registerWalletEntity,
  rejectKeyEnrollmentRequest,
  resolveAdvancedPolicy,
  type AdvancedPolicy,
} from "@/shared/wallet-advanced-api.js";
import { hashEntityEmail, KEY_WEBAUTHN } from "../../../../../commerce/shared/advanced-wallet.js";
import {
  buildSignedAddEntityUserOp,
  buildSignedConfigureMultisigUserOp,
  passkeyToKeyFields,
} from "@/shared/advanced-userop-client.js";
import { submitSignedUserOp } from "@/shared/userop-client.js";
import { loadWalletSession, saveWalletSession, type WalletSession } from "@/shared/wallet-session.js";
import { healSuperWalletFromEmail, healWalletSession } from "@/shared/wallet-session-heal.js";
import { useWalletPolicy } from "./wallet-policy";
import {
  createPasskey,
  createSecurityKey,
  isYubiKeyPinRequiredError,
} from "@/shared/webauthn.js";
import { connectEoaWallet, initEoaConnector } from "@/shared/eoa-connector.js";
import type {
  WalletEntityKeyRecord,
  WalletEntityRecord,
  WalletKeyEnrollmentRequestRecord,
  WalletPublicConfig,
} from "../../../../../commerce/shared/wallet.js";
import { WalletFrame } from "./WalletFrame";
import {
  KEY_EOA,
  KEY_YUBIKEY,
  keyTypeLabel,
  shortEntity,
  shortKeyDisplay,
  shortKeyDisplayFromRequest,
  submitAddKey,
  submitRemoveEntity,
  submitRemoveKey,
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

export function AccessPage() {
  const { t } = useLocale();
  const navigate = useNavigate();
  const { refreshPolicy } = useWalletPolicy();
  const [session, setSession] = useState<WalletSession | null>(() => loadWalletSession());
  const [config, setConfig] = useState<WalletPublicConfig | null>(null);
  const [policy, setPolicy] = useState<AdvancedPolicy | null>(null);
  const [entities, setEntities] = useState<WalletEntityRecord[]>([]);
  const [keys, setKeys] = useState<WalletEntityKeyRecord[]>([]);
  const [pendingEnrollments, setPendingEnrollments] = useState<WalletKeyEnrollmentRequestRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<{ kind: StatusKind; message: string } | null>(null);

  const [entityEmail, setEntityEmail] = useState("");
  const [threshold, setThreshold] = useState(1);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [policyOpen, setPolicyOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [restoreEmail, setRestoreEmail] = useState("");
  const [needsSigningRestore, setNeedsSigningRestore] = useState(false);
  const [onChainReady, setOnChainReady] = useState(false);

  const adminEntity = entities[0] ?? null;

  const refresh = useCallback(async (sess: WalletSession, _cfg: WalletPublicConfig) => {
    const balance = await fetchWalletBalance(sess.address).catch(() => null);
    const deployed = balance?.chains.some((c) => c.deployed) ?? false;
    setOnChainReady(deployed);
    const pol = await resolveAdvancedPolicy(sess.address, deployed);

    setPolicy(pol);
    setThreshold(pol.threshold);

    if (pol.advanced) {
      const roster = await listWalletEntities(sess.address).catch(() => ({ entities: [], keys: [] }));
      setEntities(roster.entities);
      setKeys(roster.keys);
      const pending = await listKeyEnrollmentRequests(sess.address, "pending").catch(() => []);
      setPendingEnrollments(pending);

      if (!sess.entityId && roster.keys.length > 0) {
        const mine =
          roster.keys.find((k) => k.credentialId && k.credentialId === sess.credentialId) ??
          roster.keys.find((k) => k.qx === sess.qx && k.qy === sess.qy);
        if (mine) {
          const healed: WalletSession = {
            ...sess,
            entityId: mine.entityId,
            keyId: mine.keyId,
            keyType: mine.keyType,
            ...(mine.credentialId && !sess.credentialId?.trim()
              ? { credentialId: mine.credentialId }
              : {}),
          };
          saveWalletSession(healed);
          setSession(healed);
        }
      } else if (!sess.credentialId?.trim() && roster.keys.length > 0) {
        const mine = roster.keys.find((k) => k.qx === sess.qx && k.qy === sess.qy && k.credentialId);
        if (mine?.credentialId) {
          const healed = { ...sess, credentialId: mine.credentialId };
          saveWalletSession(healed);
          setSession(healed);
        }
      }
    } else {
      setEntities([]);
      setKeys([]);
      setPendingEnrollments([]);
      navigate("/wallet/super-wallet", { replace: true });
    }
  }, [navigate]);

  useEffect(() => {
    const sess = loadWalletSession();
    if (!sess) {
      navigate("/wallet", { replace: true });
      return;
    }
    setSession(sess);

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
        if (healed.session !== sess) {
          setSession(healed.session);
          await refresh(healed.session, cfg);
        } else {
          await refresh(sess, cfg);
        }
        setNeedsSigningRestore(healed.needsSuperWalletEmail ?? false);
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

  const restoreSigning = () => {
    if (!session) return;
    const email = restoreEmail.trim();
    if (!email) {
      setStatus({ kind: "error", message: t("wallet.superWalletEmailRequired") });
      return;
    }
    const next = healSuperWalletFromEmail(session, email);
    setSession(next);
    setNeedsSigningRestore(false);
    setStatus({ kind: "success", message: t("wallet.superWalletRestoreEmailCta") });
  };

  const applyThreshold = async () => {
    if (!session || !config || !adminEntity) return;
    if (!Number.isFinite(threshold) || threshold < 1) return;
    setBusy("threshold");
    setStatus({ kind: "info", message: t("wallet.sendSigning") });
    try {
      const fee = BigInt(config.bundlerFeeUsdc || "0");
      const entityIds = entities.map((e) => e.entityId);
      const entityIdsForKeys = keys.map((k) => k.entityId);
      const keyTypes = keys.map((k) => k.keyType);
      const qx = keys.map((k) => k.qx ?? zeroPadValue("0x00", 32));
      const qy = keys.map((k) => k.qy ?? zeroPadValue("0x00", 32));
      const eoa = keys.map((k) => k.eoa ?? zeroPadValue("0x00", 20));
      const { userOp, userOpHash } = await buildSignedConfigureMultisigUserOp({
        config,
        walletAddress: session.address,
        adminEntityId: adminEntity.entityId,
        adminQx: session.qx,
        adminQy: session.qy,
        adminCredentialId: session.credentialId,
        removeKeyIds: [],
        entityIds,
        entityIdsForKeys,
        keyTypes,
        qx,
        qy,
        eoa,
        threshold,
        vetoEntityIds: [],
        feeAmount: fee,
      });
      await submitSignedUserOp({ config, userOp, userOpHash, walletAddress: session.address });
      const result = await waitForUserOp(userOpHash);
      if (result.status !== "included") throw new Error(result.rejectReason ?? result.status);
      setStatus(null);
      await runRefresh();
    } catch (error) {
      setStatus({
        kind: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setBusy(null);
    }
  };

  const addEntity = async () => {
    if (!session || !config || !adminEntity) return;
    const email = entityEmail.trim();
    if (!email) {
      setStatus({ kind: "error", message: t("wallet.superWalletEmailRequired") });
      return;
    }
    setBusy("add-entity");
    setStatus({ kind: "info", message: t("wallet.sendSigning") });
    try {
      const entityId = hashEntityEmail(email);
      const fee = BigInt(config.bundlerFeeUsdc || "0");
      const { userOp, userOpHash } = await buildSignedAddEntityUserOp({
        config,
        walletAddress: session.address,
        adminEntityId: adminEntity.entityId,
        entityId,
        qx: session.qx,
        qy: session.qy,
        feeAmount: fee,
        credentialId: session.credentialId,
      });
      await submitSignedUserOp({ config, userOp, userOpHash, walletAddress: session.address });
      const result = await waitForUserOp(userOpHash);
      if (result.status !== "included") throw new Error(result.rejectReason ?? result.status);
      await registerWalletEntity({ walletAddress: session.address, entityId, label: email });
      setEntityEmail("");
      setStatus(null);
      await runRefresh();
    } catch (error) {
      setStatus({
        kind: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setBusy(null);
    }
  };

  const approveEnrollment = async (requestId: string) => {
    if (!session || !config || !adminEntity) return;
    setBusy(`approve-${requestId}`);
    try {
      const requests = await listKeyEnrollmentRequests(session.address, "pending");
      const req = requests.find((r) => r.id === requestId);
      if (!req) throw new Error("request_not_found");
      await submitAddKey({
        session,
        config,
        adminEntity,
        targetEntityId: req.entityId,
        keyType: req.keyType,
        qx: req.qx ?? zeroPadValue("0x00", 32),
        qy: req.qy ?? zeroPadValue("0x00", 32),
        eoa: req.eoa ?? zeroPadValue("0x00", 20),
        credentialId: req.credentialId ?? undefined,
      });
      await approveKeyEnrollmentRequest(session.address, requestId);
      setStatus(null);
      await runRefresh();
    } catch (error) {
      setStatus({
        kind: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setBusy(null);
    }
  };

  const rejectEnrollment = async (requestId: string) => {
    if (!session) return;
    setBusy(`reject-${requestId}`);
    try {
      await rejectKeyEnrollmentRequest(session.address, requestId);
      await runRefresh();
    } catch (error) {
      setStatus({
        kind: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setBusy(null);
    }
  };

  const addPasskey = async (entityId: string) => {
    if (!session || !config || !adminEntity) return;
    setBusy(`passkey-${entityId}`);
    setStatus({ kind: "info", message: t("wallet.superWalletEnrollPasskey") });
    try {
      const passkey = await createPasskey("Super Wallet key", { attachment: "platform" });
      const fields = passkeyToKeyFields(passkey);
      await submitAddKey({
        session,
        config,
        adminEntity,
        targetEntityId: entityId,
        keyType: KEY_WEBAUTHN,
        qx: fields.qx,
        qy: fields.qy,
        eoa: zeroPadValue("0x00", 20),
        credentialId: fields.credentialId,
      });
      setStatus(null);
      await runRefresh();
    } catch (error) {
      setStatus({
        kind: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setBusy(null);
    }
  };

  const addYubiKey = async (entityId: string) => {
    if (!session || !config || !adminEntity) return;
    setBusy(`yubikey-${entityId}`);
    setStatus({ kind: "info", message: t("wallet.superWalletEnrollYubiKey") });
    try {
      const passkey = await createSecurityKey("Security key");
      const fields = passkeyToKeyFields(passkey);
      await submitAddKey({
        session,
        config,
        adminEntity,
        targetEntityId: entityId,
        keyType: KEY_YUBIKEY,
        qx: fields.qx,
        qy: fields.qy,
        eoa: zeroPadValue("0x00", 20),
        credentialId: fields.credentialId,
      });
      setStatus(null);
      await runRefresh();
    } catch (error) {
      setStatus({
        kind: "error",
        message: isYubiKeyPinRequiredError(error)
          ? t("wallet.yubikeyPinRequiredTitle")
          : error instanceof Error
            ? error.message
            : String(error),
      });
    } finally {
      setBusy(null);
    }
  };

  const addEoa = async (entityId: string) => {
    if (!session || !config || !adminEntity) return;
    setBusy(`eoa-${entityId}`);
    setStatus({ kind: "info", message: t("wallet.superWalletConnectWalletHint") });
    try {
      const eoa = getAddress(await connectEoaWallet());
      await submitAddKey({
        session,
        config,
        adminEntity,
        targetEntityId: entityId,
        keyType: KEY_EOA,
        qx: zeroPadValue("0x00", 32),
        qy: zeroPadValue("0x00", 32),
        eoa,
      });
      setStatus(null);
      await runRefresh();
    } catch (error) {
      setStatus({
        kind: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setBusy(null);
    }
  };

  const removeEntity = async (entityId: string) => {
    if (!session || !config || !adminEntity) return;
    if (!window.confirm(t("wallet.superWalletRemoveEntityConfirm"))) return;
    setBusy(`remove-entity-${entityId}`);
    try {
      await submitRemoveEntity({ session, config, adminEntity, entityId });
      await runRefresh();
      await refreshPolicy();
    } catch (error) {
      setStatus({ kind: "error", message: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy(null);
    }
  };

  const removeKey = async (entityId: string, keyId: string) => {
    if (!session || !config || !adminEntity) return;
    if (!window.confirm(t("wallet.superWalletRemoveKeyConfirm"))) return;
    setBusy(`remove-key-${keyId}`);
    try {
      await submitRemoveKey({ session, config, adminEntity, entityId, keyId });
      await runRefresh();
      await refreshPolicy();
    } catch (error) {
      setStatus({ kind: "error", message: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy(null);
    }
  };

  if (!session) return null;

  return (
    <WalletFrame current="access" title={t("wallet.accessPageTitle")} lede={t("wallet.accessPageLede")}>
      <div data-testid="access-page">
      {status && <StatusMessage kind={status.kind} message={status.message} />}
      {needsSigningRestore && (
        <Alert className="mb-4 border-warn/40 bg-warn/10">
          <AlertDescription className="space-y-3">
            <p>{t("wallet.superWalletRestoreEmailHint")}</p>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                type="email"
                value={restoreEmail}
                onChange={(e) => setRestoreEmail(e.target.value)}
                placeholder="you@company.com"
                autoComplete="email"
              />
              <Button type="button" onClick={restoreSigning}>
                {t("wallet.superWalletRestoreEmailCta")}
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      )}
      {loading || !policy?.advanced ? (
        <div className="space-y-4">
          <Skeleton className="h-8 w-2/3" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-10 w-40" />
        </div>
      ) : (
        <ManageSection
          t={t}
          policy={policy}
          entities={entities}
          keys={keys}
          adminEntityId={adminEntity?.entityId ?? null}
          pendingEnrollments={pendingEnrollments}
          threshold={threshold}
          onThresholdChange={setThreshold}
          entityEmail={entityEmail}
          onEntityEmailChange={setEntityEmail}
          onApplyThreshold={() => void applyThreshold()}
          onAddEntity={() => void addEntity()}
          onOpenInvite={() => setInviteOpen(true)}
          onOpenPolicy={() => setPolicyOpen(true)}
          onApprove={(id) => void approveEnrollment(id)}
          onReject={(id) => void rejectEnrollment(id)}
          onAddPasskey={(id) => void addPasskey(id)}
          onAddYubiKey={(id) => void addYubiKey(id)}
          onAddEoa={(id) => void addEoa(id)}
          onRemoveEntity={(id) => void removeEntity(id)}
          onRemoveKey={(entityId, keyId) => void removeKey(entityId, keyId)}
          busy={busy}
        />
      )}
      </div>

      <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("wallet.superWalletAddEntity")}</DialogTitle>
            <DialogDescription>{t("wallet.inviteTeammateHint")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="entity-email-dialog">{t("wallet.superWalletEntityEmail")}</Label>
            <Input
              id="entity-email-dialog"
              type="email"
              placeholder="teammate@company.com"
              value={entityEmail}
              onChange={(e) => setEntityEmail(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setInviteOpen(false)}>
              {t("wallet.cancel")}
            </Button>
            <Button
              type="button"
              disabled={busy !== null}
              onClick={() => {
                void addEntity();
                setInviteOpen(false);
              }}
            >
              {t("wallet.superWalletAddEntity")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={policyOpen} onOpenChange={setPolicyOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("wallet.superWalletPolicyTitle")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="policy-threshold-dialog">{t("wallet.superWalletThreshold")}</Label>
            <Input
              id="policy-threshold-dialog"
              type="number"
              min={1}
              max={Math.max(1, entities.length)}
              value={threshold}
              onChange={(e) => setThreshold(Number(e.target.value))}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setPolicyOpen(false)}>
              {t("wallet.cancel")}
            </Button>
            <Button
              type="button"
              disabled={busy !== null}
              onClick={() => {
                void applyThreshold();
                setPolicyOpen(false);
              }}
            >
              {t("wallet.superWalletApplyPolicy")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </WalletFrame>
  );
}

function ManageSection({
  t,
  policy,
  entities,
  keys,
  adminEntityId,
  pendingEnrollments,
  threshold,
  onThresholdChange,
  entityEmail,
  onEntityEmailChange,
  onApplyThreshold,
  onAddEntity,
  onOpenInvite,
  onOpenPolicy,
  onApprove,
  onReject,
  onAddPasskey,
  onAddYubiKey,
  onAddEoa,
  onRemoveEntity,
  onRemoveKey,
  busy,
}: {
  t: (k: string) => string;
  policy: AdvancedPolicy;
  entities: WalletEntityRecord[];
  keys: WalletEntityKeyRecord[];
  adminEntityId: string | null;
  pendingEnrollments: WalletKeyEnrollmentRequestRecord[];
  threshold: number;
  onThresholdChange: (v: number) => void;
  entityEmail: string;
  onEntityEmailChange: (v: string) => void;
  onApplyThreshold: () => void;
  onAddEntity: () => void;
  onOpenInvite: () => void;
  onOpenPolicy: () => void;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
  onAddPasskey: (entityId: string) => void;
  onAddYubiKey: (entityId: string) => void;
  onAddEoa: (entityId: string) => void;
  onRemoveEntity: (entityId: string) => void;
  onRemoveKey: (entityId: string, keyId: string) => void;
  busy: string | null;
}) {
  return (
    <PageSplit>
      <div className="space-y-6">
        <PageCard>
          <p className="text-sm text-muted-foreground">
            {t("wallet.superWalletActive", {
              threshold: String(policy.threshold),
              entities: String(policy.entityCount),
            })}
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button type="button" id="add-entity" size="sm" variant="secondary" onClick={onOpenInvite}>
              {t("wallet.superWalletAddEntity")}
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={onOpenPolicy}>
              {t("wallet.superWalletPolicyTitle")}
            </Button>
            <Button asChild size="sm" variant="outline">
              <Link to="/wallet/send">{t("wallet.proposalsOpen")}</Link>
            </Button>
          </div>
        </PageCard>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold">{t("wallet.enrollmentPendingTitle")}</h2>
        {pendingEnrollments.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("wallet.enrollmentPendingEmpty")}</p>
        ) : (
          <ul className="divide-y rounded-lg border">
            {pendingEnrollments.map((r) => (
              <li key={r.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="space-y-1">
                  <strong className="text-sm">{r.label ?? shortEntity(r.entityId)}</strong>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="secondary">{keyTypeLabel(r.keyType, t)}</Badge>
                    <span className="font-mono text-xs text-muted-foreground">
                      {shortKeyDisplayFromRequest(r)}
                    </span>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    size="sm"
                    disabled={busy !== null}
                    onClick={() => onApprove(r.id)}
                  >
                    {t("wallet.enrollmentApprove")}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={busy !== null}
                    onClick={() => onReject(r.id)}
                  >
                    {t("wallet.enrollmentReject")}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">{t("wallet.superWalletEntitiesTitle")}</h2>
        {entities.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("wallet.superWalletEntitiesEmpty")}</p>
        ) : (
          <ul className="divide-y rounded-lg border">
            {entities.map((e) => {
              const entityKeys = keys.filter((k) => k.entityId === e.entityId);
              const isAdmin = adminEntityId && e.entityId === adminEntityId;
              return (
                <li key={e.entityId} className="space-y-3 p-4" data-entity-id={e.entityId}>
                  <div>
                    <strong className="text-sm">{e.label ?? shortEntity(e.entityId)}</strong>
                    <ul className="mt-2 space-y-1">
                      {entityKeys.map((k) => (
                        <li key={k.keyId} className="flex flex-wrap items-center gap-2 text-sm">
                          <Badge variant="outline">{keyTypeLabel(k.keyType, t)}</Badge>
                          <span className="font-mono text-xs text-muted-foreground">{shortKeyDisplay(k)}</span>
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            disabled={busy !== null}
                            onClick={() => onRemoveKey(e.entityId, k.keyId)}
                          >
                            {t("wallet.superWalletRemoveKey")}
                          </Button>
                        </li>
                      ))}
                    </ul>
                  </div>
                  {isAdmin ? (
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        data-add-passkey={e.entityId}
                        disabled={busy !== null}
                        onClick={() => onAddPasskey(e.entityId)}
                      >
                        {t("wallet.superWalletAddPasskey")}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        data-add-yubikey={e.entityId}
                        disabled={busy !== null}
                        onClick={() => onAddYubiKey(e.entityId)}
                      >
                        {t("wallet.superWalletAddYubiKey")}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        data-add-eoa={e.entityId}
                        disabled={busy !== null}
                        onClick={() => onAddEoa(e.entityId)}
                      >
                        {t("wallet.superWalletConnectWallet")}
                      </Button>
                    </div>
                  ) : (
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm text-muted-foreground">{t("wallet.inviteTeammateHint")}</p>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        disabled={busy !== null}
                        onClick={() => onRemoveEntity(e.entityId)}
                      >
                        {t("wallet.superWalletRemoveEntity")}
                      </Button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
      </div>

      <PageCard>
        <h2 className="text-base font-semibold">{t("wallet.superWalletMapTitle")}</h2>
        <ul className="mt-4 space-y-3 text-sm">
          <li className="flex items-center justify-between gap-2">
            <span>{t("wallet.superWalletThreshold")}</span>
            <StatusBadge tone="active">{String(policy.threshold)}</StatusBadge>
          </li>
          <li className="flex items-center justify-between gap-2">
            <span>{t("wallet.superWalletEntitiesTitle")}</span>
            <StatusBadge tone="verified">{String(entities.length)}</StatusBadge>
          </li>
          <li className="flex items-center justify-between gap-2">
            <span>{t("wallet.enrollmentPendingTitle")}</span>
            <StatusBadge tone={pendingEnrollments.length ? "pending" : "muted"}>
              {String(pendingEnrollments.length)}
            </StatusBadge>
          </li>
        </ul>
        <TrustNotice className="mt-6 border-0 bg-muted/40 p-0 text-xs">
          {t("wallet.superWalletMapHint")}
        </TrustNotice>
      </PageCard>
    </PageSplit>
  );
}
