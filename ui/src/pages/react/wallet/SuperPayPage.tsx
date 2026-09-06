import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { getAddress, isAddress, isHexString } from "ethers";
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
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { PageCard, PageSplit } from "@/components/PageSplit";
import { StatusBadge } from "@/components/StatusBadge";
import { ExplorerLink } from "@/components/ExplorerLink";
import { useLocale } from "@/providers/LocaleProvider";
import { fetchWalletConfig, waitForUserOp } from "@/shared/wallet-api.js";
import {
  attachProposalTx,
  createProposal,
  executeProposal,
  fetchAdvancedPolicy,
  getProposal,
  listProposals,
  listWalletEntities,
  prepareProposal,
  signProposal,
  type AdvancedPolicy,
} from "@/shared/wallet-advanced-api.js";
import { signProposalUserOp } from "@/shared/advanced-userop-client.js";
import { encodeErc20Transfer, parseUsdcInput } from "../../../../../commerce/shared/userop.js";
import { KEY_EOA } from "../../../../../commerce/shared/advanced-wallet.js";
import { loadWalletSession, type WalletSession } from "@/shared/wallet-session.js";
import { connectEoaWallet, getConnectedEoaAddress, initEoaConnector } from "@/shared/eoa-connector.js";
import type {
  WalletProposalRecord,
  WalletProposalSigRecord,
  WalletPublicConfig,
} from "../../../../../commerce/shared/wallet.js";
import { WalletFrame } from "./WalletFrame";
import { isClosedProposal, isFullySigned, proposalSummary, shortAddr } from "./proposal-display";

type StatusKind = "info" | "error" | "success";
type CreateKind = "transfer" | "call";

export function SuperPayPage() {
  const { t } = useLocale();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [session] = useState<WalletSession | null>(() => loadWalletSession());
  const [config, setConfig] = useState<WalletPublicConfig | null>(null);
  const [policy, setPolicy] = useState<AdvancedPolicy | null>(null);
  const [proposals, setProposals] = useState<WalletProposalRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<{ kind: StatusKind; message: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const [createKind, setCreateKind] = useState<CreateKind>("transfer");
  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("");
  const [callTarget, setCallTarget] = useState("");
  const [callValue, setCallValue] = useState("0");
  const [callData, setCallData] = useState("0x");

  const [detail, setDetail] = useState<{
    proposal: WalletProposalRecord;
    signatures: WalletProposalSigRecord[];
  } | null>(null);

  const closedView = searchParams.get("status") === "closed";
  const openId = searchParams.get("id");

  const loadDetail = useCallback(async (proposalId: string, sess: WalletSession) => {
    try {
      const data = await getProposal(sess.address, proposalId);
      setDetail(data);
      setStatus(null);
    } catch (error) {
      setDetail(null);
      setStatus({
        kind: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }, []);

  const reloadList = useCallback(async (sess: WalletSession) => {
    const list = await listProposals(sess.address).catch(() => []);
    setProposals(list);
    return list;
  }, []);

  useEffect(() => {
    const sess = loadWalletSession();
    if (!sess) {
      navigate("/wallet", { replace: true });
      return;
    }

    let cancelled = false;
    void (async () => {
      setLoading(true);
      try {
        const cfg = await fetchWalletConfig();
        await initEoaConnector(cfg);
        const pol = await fetchAdvancedPolicy(sess.address).catch(() => null);
        if (cancelled) return;
        if (!pol?.advanced) {
          navigate("/wallet/super-wallet", { replace: true });
          return;
        }
        setConfig(cfg);
        setPolicy(pol);
        await reloadList(sess);
        if (cancelled) return;
        if (openId) {
          await loadDetail(openId, sess);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [navigate, openId, loadDetail, reloadList]);

  const visible = useMemo(
    () => proposals.filter((p) => (closedView ? isClosedProposal(p) : !isClosedProposal(p))),
    [proposals, closedView]
  );

  const createTransfer = async () => {
    if (!session || !config) return;
    if (!isAddress(recipient)) {
      setStatus({ kind: "error", message: t("wallet.sendInvalidRecipient") });
      return;
    }
    const chain = config.chains.find((c) => c.chainId === config.chainId);
    if (!chain?.feeTokenAddress) {
      setStatus({ kind: "error", message: t("wallet.sendNotDeployed") });
      return;
    }
    setBusy("create");
    try {
      const sendAmount = parseUsdcInput(amount, config.feeTokenDecimals);
      const data = encodeErc20Transfer(getAddress(recipient), sendAmount);
      const proposal = await createProposal({
        walletAddress: session.address,
        chainId: config.chainId,
        target: chain.feeTokenAddress,
        value: "0",
        data,
      });
      setSearchParams({ id: proposal.id }, { replace: true });
      await reloadList(session);
      await loadDetail(proposal.id, session);
    } catch (error) {
      setStatus({
        kind: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setBusy(null);
    }
  };

  const createCall = async () => {
    if (!session || !config) return;
    if (!isAddress(callTarget)) {
      setStatus({ kind: "error", message: t("wallet.sendInvalidRecipient") });
      return;
    }
    const data = callData.trim() || "0x";
    if (!isHexString(data)) {
      setStatus({ kind: "error", message: t("wallet.proposalsContractData") });
      return;
    }
    let value = callValue.trim() || "0";
    try {
      value = BigInt(value).toString();
    } catch {
      setStatus({ kind: "error", message: t("wallet.proposalsContractValue") });
      return;
    }
    setBusy("create");
    try {
      const proposal = await createProposal({
        walletAddress: session.address,
        chainId: config.chainId,
        target: getAddress(callTarget),
        value,
        data,
      });
      setSearchParams({ id: proposal.id }, { replace: true });
      await reloadList(session);
      await loadDetail(proposal.id, session);
    } catch (error) {
      setStatus({
        kind: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setBusy(null);
    }
  };

  const resolveSigningKey = async (sess: WalletSession) => {
    const roster = await listWalletEntities(sess.address);
    let myKey =
      (sess.keyId ? roster.keys.find((k) => k.keyId === sess.keyId) : null) ??
      roster.keys.find((k) => k.qx === sess.qx && k.qy === sess.qy) ??
      null;
    if (!myKey) {
      const connected = await getConnectedEoaAddress();
      if (connected) {
        myKey =
          roster.keys.find(
            (k) => k.keyType === KEY_EOA && k.eoa?.toLowerCase() === connected.toLowerCase()
          ) ?? null;
      }
    }
    if (!myKey) {
      const connected = await connectEoaWallet().catch(() => null);
      if (connected) {
        myKey =
          roster.keys.find(
            (k) => k.keyType === KEY_EOA && k.eoa?.toLowerCase() === connected.toLowerCase()
          ) ?? null;
      }
    }
    return myKey;
  };

  const signCurrent = async () => {
    if (!session || !config || !detail || !policy) return;
    setBusy("sign");
    setStatus({ kind: "info", message: t("wallet.sendSigning") });
    try {
      const myKey = await resolveSigningKey(session);
      if (!myKey) throw new Error(t("wallet.superWalletNoSigningKey"));
      const prepared = await prepareProposal(session.address, detail.proposal.id);
      const signature = await signProposalUserOp({
        userOpHash: prepared.userOpHash,
        entityId: myKey.entityId,
        keyType: myKey.keyType,
        qx: myKey.qx ?? undefined,
        qy: myKey.qy ?? undefined,
        eoa: myKey.eoa ?? undefined,
        credentialId: session.credentialId,
      });
      await signProposal({
        walletAddress: session.address,
        proposalId: detail.proposal.id,
        entityId: myKey.entityId,
        keyId: myKey.keyId,
        keyType: myKey.keyType,
        signature,
      });
      setStatus({ kind: "info", message: t("wallet.proposalsSigned") });
      await reloadList(session);
      await loadDetail(detail.proposal.id, session);
    } catch (error) {
      setStatus({
        kind: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setBusy(null);
    }
  };

  const executeCurrent = async () => {
    if (!session || !detail) return;
    setBusy("execute");
    setStatus({ kind: "info", message: t("wallet.proposalsExecuting") });
    try {
      const { userOpHash } = await executeProposal(session.address, detail.proposal.id);
      const result = await waitForUserOp(userOpHash);
      if (result.status !== "included") throw new Error(result.rejectReason ?? result.status);
      if (result.txHash) {
        await attachProposalTx(session.address, detail.proposal.id, result.txHash);
      }
      setStatus({ kind: "success", message: t("wallet.proposalsExecuted") });
      await reloadList(session);
      await loadDetail(detail.proposal.id, session);
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

  const threshold = policy?.threshold ?? 1;
  const decimals = config?.feeTokenDecimals ?? 6;

  return (
    <WalletFrame
      current="send"
      title={t("wallet.payTab")}
      lede={policy ? t("wallet.proposalsLede", { threshold: String(policy.threshold) }) : undefined}
    >
      <div data-testid="super-wallet-pay" className="space-y-6">
        {loading ? (
          <div className="space-y-4">
            <Skeleton className="h-8 w-1/2" />
            <Skeleton className="h-24 w-full" />
          </div>
        ) : (
          <PageSplit>
            <div className="space-y-6">
              <PageCard>
                <div className="mb-4 flex flex-wrap gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant={createKind === "transfer" ? "secondary" : "outline"}
                    onClick={() => setCreateKind("transfer")}
                  >
                    {t("wallet.proposalsCreateTransfer")}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant={createKind === "call" ? "secondary" : "outline"}
                    onClick={() => setCreateKind("call")}
                  >
                    {t("wallet.proposalsContractCall")}
                  </Button>
                </div>
                {createKind === "transfer" ? (
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="prop-recipient">{t("wallet.sendRecipient")}</Label>
                      <Input
                        id="prop-recipient"
                        type="text"
                        className="font-mono"
                        placeholder="0x…"
                        value={recipient}
                        onChange={(e) => setRecipient(e.target.value)}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="prop-amount">{t("wallet.sendAmount")}</Label>
                      <Input
                        id="prop-amount"
                        type="text"
                        inputMode="decimal"
                        value={amount}
                        onChange={(e) => setAmount(e.target.value)}
                      />
                    </div>
                    <Button
                      id="create-proposal"
                      type="button"
                      disabled={busy === "create"}
                      onClick={() => void createTransfer()}
                    >
                      {t("wallet.proposalsCreateCta")}
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <h2 className="text-base font-semibold">{t("wallet.proposalsContractCallTitle")}</h2>
                    <div className="space-y-2">
                      <Label htmlFor="prop-call-target">{t("wallet.proposalsContractTarget")}</Label>
                      <Input
                        id="prop-call-target"
                        type="text"
                        className="font-mono"
                        placeholder="0x…"
                        value={callTarget}
                        onChange={(e) => setCallTarget(e.target.value)}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="prop-call-value">{t("wallet.proposalsContractValue")}</Label>
                      <Input
                        id="prop-call-value"
                        type="text"
                        className="font-mono"
                        value={callValue}
                        onChange={(e) => setCallValue(e.target.value)}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="prop-call-data">{t("wallet.proposalsContractData")}</Label>
                      <Input
                        id="prop-call-data"
                        type="text"
                        className="font-mono"
                        value={callData}
                        onChange={(e) => setCallData(e.target.value)}
                      />
                    </div>
                    <Button
                      id="create-call-proposal"
                      type="button"
                      disabled={busy === "create"}
                      onClick={() => void createCall()}
                    >
                      {t("wallet.proposalsCreateCta")}
                    </Button>
                  </div>
                )}
              </PageCard>

              <PageCard>
                <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                  <h2 className="text-base font-semibold">
                    {closedView ? t("wallet.proposalsClosed") : t("wallet.proposalsOpen")}
                  </h2>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    data-testid="proposals-closed-toggle"
                    onClick={() =>
                      setSearchParams(closedView ? {} : { status: "closed" }, { replace: true })
                    }
                  >
                    {closedView ? t("wallet.proposalsOpen") : t("wallet.proposalsClosedCta")}
                  </Button>
                </div>
                {visible.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{t("wallet.proposalsEmpty")}</p>
                ) : (
                  <ul className="divide-y rounded-lg border">
                    {visible.map((p) => {
                      const fully = isFullySigned(p, threshold);
                      return (
                        <li key={p.id} className="flex items-center justify-between gap-4 p-4">
                          <div className="min-w-0 space-y-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <StatusBadge
                                tone={p.status === "executed" ? "verified" : p.status === "cancelled" ? "muted" : "pending"}
                              >
                                {p.status}
                              </StatusBadge>
                              {fully && p.status !== "executed" && p.status !== "cancelled" && (
                                <StatusBadge tone="verified">{t("wallet.proposalsFullySigned")}</StatusBadge>
                              )}
                              {p.status === "executed" && p.txHash && (
                                <ExplorerLink chainId={p.chainId} value={p.txHash} kind="tx" />
                              )}
                            </div>
                            <p className="truncate text-sm">{proposalSummary(p, t, decimals)}</p>
                            <p className="font-mono text-xs text-muted-foreground">
                              {t("wallet.proposalsSigCount", {
                                count: String(p.signatureCount ?? 0),
                                threshold: String(threshold),
                              })}
                            </p>
                          </div>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              setSearchParams(
                                closedView ? { status: "closed", id: p.id } : { id: p.id },
                                { replace: true }
                              );
                              void loadDetail(p.id, session);
                            }}
                          >
                            {t("wallet.proposalsOpenOne")}
                          </Button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </PageCard>

              {status && (
                <p
                  id="proposal-status"
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
          </PageSplit>
        )}
      </div>

      <Dialog
        open={Boolean(detail && policy)}
        onOpenChange={(open) => {
          if (!open) {
            setDetail(null);
            setSearchParams(closedView ? { status: "closed" } : {}, { replace: true });
          }
        }}
      >
        {detail && policy && (
          <DialogContent id="proposal-detail">
            <DialogHeader>
              <DialogTitle>{t("wallet.proposalsDetail")}</DialogTitle>
              <DialogDescription className="font-mono text-xs">
                {shortAddr(detail.proposal.target)} · {detail.proposal.status}
              </DialogDescription>
            </DialogHeader>
            <p className="text-sm">{proposalSummary(detail.proposal, t, decimals)}</p>
            <p className="text-sm">
              {t("wallet.proposalsSigCount", {
                count: String(detail.signatures.length),
                threshold: String(policy.threshold),
              })}
              {isFullySigned(
                { ...detail.proposal, signatureCount: detail.signatures.length },
                policy.threshold
              )
                ? ` · ${t("wallet.proposalsFullySigned")}`
                : ` · ${t("wallet.proposalsAwaitingSignatures")}`}
            </p>
            {detail.proposal.txHash && (
              <div className="flex items-center gap-2 text-sm">
                <span className="font-mono text-xs">{shortAddr(detail.proposal.txHash)}</span>
                <ExplorerLink chainId={detail.proposal.chainId} value={detail.proposal.txHash} kind="tx" />
              </div>
            )}
            <DialogFooter className="flex-col gap-2 sm:flex-row">
              <Button
                id="sign-proposal"
                type="button"
                variant="outline"
                disabled={busy !== null || detail.proposal.status === "executed"}
                onClick={() => void signCurrent()}
              >
                {t("wallet.proposalsSign")}
              </Button>
              <Button
                id="execute-proposal"
                type="button"
                disabled={busy !== null || detail.proposal.status === "executed"}
                onClick={() => void executeCurrent()}
              >
                {t("wallet.proposalsExecute")}
              </Button>
            </DialogFooter>
          </DialogContent>
        )}
      </Dialog>
    </WalletFrame>
  );
}
