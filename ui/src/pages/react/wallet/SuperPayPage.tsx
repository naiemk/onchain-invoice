import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Contract, JsonRpcProvider, formatUnits, getAddress, isAddress, isHexString } from "ethers";
import { ArrowUpRight, Loader2, Shield } from "lucide-react";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { PageCard, PageSplit } from "@/components/PageSplit";
import { StatusBadge } from "@/components/StatusBadge";
import { SendScanButton } from "@/components/SendScanDialog";
import { useLocale } from "@/providers/LocaleProvider";
import { fetchWalletConfig, primaryChain, waitForUserOp } from "@/shared/wallet-api.js";
import { formatSendRejectReason } from "@/shared/userop-errors.js";
import {
  attachProposalTx,
  createProposal,
  executeProposal,
  fetchAdvancedPolicy,
  getProposal,
  listProposals,
  prepareProposal,
  signProposal,
  type AdvancedPolicy,
} from "@/shared/wallet-advanced-api.js";
import { signProposalUserOp } from "@/shared/advanced-userop-client.js";
import { asAdvancedKeyType, resolveSessionSigningKey } from "@/shared/advanced-signing-key.js";
import { ERC20_ABI, encodeErc20Transfer, parseUsdcInput } from "../../../../../commerce/shared/userop.js";
import { loadWalletSession, type WalletSession } from "@/shared/wallet-session.js";
import { initEoaConnector } from "@/shared/eoa-connector.js";
import type {
  WalletProposalRecord,
  WalletProposalSigRecord,
  WalletPublicConfig,
} from "../../../../../commerce/shared/wallet.js";
import { WalletFrame } from "./WalletFrame";
import { isClosedProposal, isFullySigned, proposalSignatureCount, ProposalSummaryLine } from "./proposal-display";
import { TxHistory } from "./TxHistory";

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
  const [note, setNote] = useState("");
  const [selectedTokenSymbol, setSelectedTokenSymbol] = useState("USDC");
  const [tokenBalances, setTokenBalances] = useState<Record<string, bigint>>({});
  const [reviewOpen, setReviewOpen] = useState(false);
  const [historyKey, setHistoryKey] = useState(0);
  const [callTarget, setCallTarget] = useState("");
  const [callValue, setCallValue] = useState("0");
  const [callData, setCallData] = useState("0x");

  const [detail, setDetail] = useState<{
    proposal: WalletProposalRecord;
    signatures: WalletProposalSigRecord[];
  } | null>(null);

  const closedView = searchParams.get("status") === "closed";
  const openId = searchParams.get("id");

  const loadDetail = useCallback(async (proposalId: string, sess: WalletSession, opts?: { keepStatus?: boolean }) => {
    try {
      const data = await getProposal(sess.address, proposalId);
      setDetail(data);
      if (!opts?.keepStatus) setStatus(null);
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

  const chain = useMemo(() => (config ? primaryChain(config) : null), [config]);
  const tokenOptions = useMemo(
    () =>
      chain
        ? [
            {
              symbol: chain.feeTokenSymbol,
              address: chain.feeTokenAddress,
              decimals: chain.feeTokenDecimals,
            },
            ...(chain.stableTokens ?? []),
          ].filter((token, index, arr) => token.address && arr.findIndex((tok) => tok.symbol === token.symbol) === index)
        : [],
    [chain]
  );
  const selectedToken = tokenOptions.find((token) => token.symbol === selectedTokenSymbol) ?? tokenOptions[0];
  const tokenDecimals = selectedToken?.decimals ?? chain?.feeTokenDecimals ?? 6;
  const selectedTokenBalance = selectedToken ? tokenBalances[selectedToken.symbol] ?? 0n : 0n;
  const selectedPaysFee = Boolean(
    selectedToken?.address && chain?.feeTokenAddress && selectedToken.address.toLowerCase() === chain.feeTokenAddress.toLowerCase()
  );
  const maxSendAtoms = selectedPaysFee
    ? selectedTokenBalance > BigInt(config?.bundlerFeeUsdc || "0")
      ? selectedTokenBalance - BigInt(config?.bundlerFeeUsdc || "0")
      : 0n
    : selectedTokenBalance;
  const selectedAvailable = formatUnits(selectedTokenBalance, tokenDecimals);
  const feeUsd = config?.bundlerFeeUsd ?? "—";

  useEffect(() => {
    if (!session || !config || !chain || !tokenOptions.length) return;
    if (!tokenOptions.some((token) => token.symbol === selectedTokenSymbol)) {
      setSelectedTokenSymbol(tokenOptions[0]?.symbol ?? "USDC");
    }
    let cancelled = false;
    void Promise.all(
      tokenOptions.map(async (token) => {
        if (!token.address || !chain.rpcUrl) return [token.symbol, 0n] as const;
        try {
          const provider = new JsonRpcProvider(chain.rpcUrl);
          const contract = new Contract(token.address, ERC20_ABI, provider);
          return [token.symbol, BigInt(await contract.balanceOf(session.address))] as const;
        } catch {
          return [token.symbol, 0n] as const;
        }
      })
    ).then((rows) => {
      if (!cancelled) setTokenBalances(Object.fromEntries(rows));
    });
    return () => {
      cancelled = true;
    };
  }, [chain, config, selectedTokenSymbol, session, tokenOptions]);

  const handleScan = useCallback((result: { recipient: string; amount?: string }) => {
    setRecipient(result.recipient);
    if (result.amount) setAmount(result.amount);
    setStatus(null);
  }, []);

  const openReview = () => {
    if (!config || !session || !selectedToken?.address) return;
    if (!isAddress(recipient)) {
      setStatus({ kind: "error", message: t("wallet.sendInvalidRecipient") });
      return;
    }
    const parsed = parseUsdcInput(amount, selectedToken.decimals);
    if (parsed === null || parsed <= 0n) {
      setStatus({ kind: "error", message: t("wallet.sendInvalidAmount") });
      return;
    }
    const feeAtoms = BigInt(config.bundlerFeeUsdc || "0");
    if (parsed > selectedTokenBalance || (selectedPaysFee && parsed + feeAtoms > selectedTokenBalance)) {
      setStatus({ kind: "error", message: t("wallet.sendInsufficientBalance") });
      return;
    }
    setStatus(null);
    setReviewOpen(true);
  };

  const createTransfer = async () => {
    if (!session || !config) return;
    if (!isAddress(recipient)) {
      setStatus({ kind: "error", message: t("wallet.sendInvalidRecipient") });
      return;
    }
    const token = selectedToken;
    if (!token?.address) {
      setStatus({ kind: "error", message: t("wallet.sendNotDeployed") });
      return;
    }
    const sendAmount = parseUsdcInput(amount, token.decimals);
    if (sendAmount === null || sendAmount <= 0n) {
      setStatus({ kind: "error", message: t("wallet.sendInvalidAmount") });
      return;
    }
    setBusy("create");
    setReviewOpen(false);
    try {
      const data = encodeErc20Transfer(getAddress(recipient), sendAmount);
      const proposal = await createProposal({
        walletAddress: session.address,
        chainId: config.chainId,
        target: token.address,
        value: "0",
        data,
      });
      setRecipient("");
      setAmount("");
      setNote("");
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

  const signCurrent = async () => {
    if (!session || !config || !detail || !policy || busy) return;
    setBusy("sign");
    setStatus({ kind: "info", message: t("wallet.sendSigning") });
    try {
      const resolved = await resolveSessionSigningKey(session);
      if (!resolved) throw new Error(t("wallet.superWalletNoSigningKey"));
      const myKey = resolved.key;
      const prepared = await prepareProposal(session.address, detail.proposal.id);
      const signature = await signProposalUserOp({
        userOpHash: prepared.userOpHash,
        passkey: resolved.passkey,
        entityId: myKey.entityId,
        keyType: asAdvancedKeyType(myKey.keyType),
        qx: myKey.qx ?? undefined,
        qy: myKey.qy ?? undefined,
        eoa: myKey.eoa ?? undefined,
        credentialId: myKey.credentialId ?? session.credentialId,
      });
      await signProposal({
        walletAddress: session.address,
        proposalId: detail.proposal.id,
        entityId: myKey.entityId,
        keyId: myKey.keyId,
        keyType: myKey.keyType,
        signature,
      });
      const data = await getProposal(session.address, detail.proposal.id);
      const signed = {
        ...data,
        proposal: {
          ...data.proposal,
          signatureCount: proposalSignatureCount(data.proposal, data.signatures),
        },
      };
      setDetail(signed);
      await reloadList(session);
      if (proposalSignatureCount(signed.proposal, signed.signatures) >= policy.threshold) {
        await runExecute(session, signed.proposal.id);
      } else {
        setStatus({ kind: "info", message: t("wallet.proposalsSigned") });
      }
    } catch (error) {
      setStatus({
        kind: "error",
        message: formatSendRejectReason(error instanceof Error ? error.message : String(error), t),
      });
    } finally {
      setBusy(null);
    }
  };

  const runExecute = async (sess: WalletSession, proposalId: string) => {
    setBusy("execute");
    setStatus({ kind: "info", message: t("wallet.proposalsExecuting") });
    const { userOpHash } = await executeProposal(sess.address, proposalId);
    setStatus({ kind: "info", message: t("wallet.sendPending") });
    const result = await waitForUserOp(userOpHash);
    if (result.status !== "included") {
      throw new Error(result.rejectReason ?? result.status);
    }
    if (result.txHash) {
      await attachProposalTx(sess.address, proposalId, result.txHash);
    }
    setStatus({ kind: "success", message: t("wallet.proposalsExecuted") });
    setHistoryKey((n) => n + 1);
    await reloadList(sess);
    await loadDetail(proposalId, sess, { keepStatus: true });
  };

  const executeCurrent = async () => {
    if (!session || !detail || busy) return;
    setBusy("execute");
    setStatus({ kind: "info", message: t("wallet.proposalsExecuting") });
    try {
      await runExecute(session, detail.proposal.id);
    } catch (error) {
      setStatus({
        kind: "error",
        message: formatSendRejectReason(error instanceof Error ? error.message : String(error), t),
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
          <>
          <PageSplit>
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
                      <div className="flex gap-2">
                        <Input
                          id="prop-recipient"
                          type="text"
                          className="font-mono"
                          placeholder="0x…"
                          value={recipient}
                          disabled={busy !== null}
                          onChange={(e) => setRecipient(e.target.value)}
                        />
                        <SendScanButton onScan={handleScan} tokenDecimals={tokenDecimals} disabled={busy !== null} />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between gap-3">
                        <Label htmlFor="prop-amount">{t("wallet.sendAmount")}</Label>
                        <Select
                          value={selectedToken?.symbol ?? selectedTokenSymbol}
                          onValueChange={setSelectedTokenSymbol}
                          disabled={busy !== null || tokenOptions.length <= 1}
                        >
                          <SelectTrigger id="send-token" className="h-9 w-28">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {tokenOptions.map((token) => (
                              <SelectItem key={token.symbol} value={token.symbol}>
                                {token.symbol}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <Input
                        id="prop-amount"
                        type="text"
                        inputMode="decimal"
                        placeholder="0.00"
                        value={amount}
                        disabled={busy !== null}
                        onChange={(e) => setAmount(e.target.value)}
                      />
                      <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
                        <span>
                          {t("wallet.sendAvailable", {
                            amount: selectedAvailable,
                            symbol: selectedToken?.symbol ?? "",
                          })}
                        </span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2 text-xs"
                          disabled={busy !== null || maxSendAtoms <= 0n}
                          onClick={() => setAmount(formatUnits(maxSendAtoms, tokenDecimals))}
                        >
                          {t("wallet.max")}
                        </Button>
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="prop-note">{t("wallet.sendNoteOptional")}</Label>
                      <Input
                        id="prop-note"
                        placeholder={t("wallet.sendNotePlaceholder")}
                        value={note}
                        disabled={busy !== null}
                        onChange={(e) => setNote(e.target.value)}
                      />
                    </div>
            <Button
                      id="review-proposal"
                      type="button"
                      disabled={busy !== null}
                      onClick={openReview}
                    >
                      {t("wallet.sendReview")}
                      <ArrowUpRight className="h-3.5 w-3.5" />
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
                      disabled={busy !== null}
                      onClick={() => void createCall()}
                    >
                      {busy === "create" ? (
                        <>
                          <Loader2 className="animate-spin" />
                          {t("wallet.proposalsCreateCta")}
                        </>
                      ) : (
                        t("wallet.proposalsCreateCta")
                      )}
                    </Button>
                  </div>
                )}
              </PageCard>
              {createKind === "transfer" && (
                <PageCard>
                  <Shield className="mb-3 h-5 w-5 text-emphasis" aria-hidden />
                  <h2 className="text-base font-semibold">{t("wallet.sendPauseTitle")}</h2>
                  <p className="mt-2 text-sm text-muted-foreground">{t("wallet.sendPauseBody")}</p>
                  <p className="mt-4 text-sm text-muted-foreground">
                    {t("wallet.sendNetworkFeeLine", { fee: feeUsd })}
                  </p>
                  <p className="mt-2 text-sm">
                    {t("wallet.sendAvailable", {
                      amount: selectedAvailable,
                      symbol: selectedToken?.symbol ?? "",
                    })}
                  </p>
                </PageCard>
              )}
          </PageSplit>
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
                            </div>
                            <p className="truncate text-sm">
                              <ProposalSummaryLine proposal={p} t={t} decimals={decimals} tokens={tokenOptions} />
                            </p>
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
                            disabled={busy !== null}
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

              {status && !detail && (
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
            <div className="mt-6">
              <TxHistory wallet={session.address} chainId={config?.chainId} refreshKey={historyKey} />
            </div>
          </>
        )}
      </div>

      <Dialog open={reviewOpen} onOpenChange={setReviewOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("wallet.sendReviewTitle")}</DialogTitle>
            <DialogDescription>{t("wallet.sendPauseBody")}</DialogDescription>
          </DialogHeader>
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">{t("wallet.sendRecipient")}</dt>
              <dd className="font-mono text-end">{recipient.slice(0, 10)}…</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">{t("wallet.sendAmount")}</dt>
              <dd>
                {amount} {selectedToken?.symbol ?? ""}
              </dd>
            </div>
            {note.trim() ? (
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">{t("wallet.sendNoteOptional")}</dt>
                <dd className="text-end">{note}</dd>
              </div>
            ) : null}
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">{t("wallet.networkFee")}</dt>
              <dd>{feeUsd}</dd>
            </div>
          </dl>
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" disabled={busy !== null} onClick={() => setReviewOpen(false)}>
              {t("wallet.cancel")}
            </Button>
            <Button id="create-proposal" type="button" disabled={busy !== null} onClick={() => void createTransfer()}>
              {busy === "create" ? (
                <>
                  <Loader2 className="animate-spin" />
                  {t("wallet.proposalsCreateCta")}
                </>
              ) : (
                t("wallet.proposalsCreateCta")
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(detail && policy)}
        onOpenChange={(open) => {
          if (!open) {
            if (busy) return;
            setDetail(null);
            setSearchParams(closedView ? { status: "closed" } : {}, { replace: true });
          }
        }}
      >
        {detail && policy && (
          <DialogContent
            id="proposal-detail"
            onPointerDownOutside={(event) => {
              if (busy) event.preventDefault();
            }}
            onEscapeKeyDown={(event) => {
              if (busy) event.preventDefault();
            }}
          >
            <DialogHeader>
              <DialogTitle>{t("wallet.proposalsDetail")}</DialogTitle>
              <DialogDescription>{detail.proposal.status}</DialogDescription>
            </DialogHeader>
            <p className="min-w-0 text-sm">
              <ProposalSummaryLine proposal={detail.proposal} t={t} decimals={decimals} tokens={tokenOptions} />
            </p>
            <p className="text-sm">
              {t("wallet.proposalsSigCount", {
                count: String(proposalSignatureCount(detail.proposal, detail.signatures)),
                threshold: String(policy.threshold),
              })}
              {isFullySigned(detail.proposal, policy.threshold, detail.signatures)
                ? ` · ${t("wallet.proposalsFullySigned")}`
                : ` · ${t("wallet.proposalsAwaitingSignatures")}`}
            </p>
            {status && (
              <Alert
                variant={status.kind === "error" ? "destructive" : status.kind === "success" ? "ok" : "default"}
                id="proposal-status"
              >
                <AlertDescription className="flex items-center gap-2">
                  {busy ? <Loader2 className="h-4 w-4 shrink-0 animate-spin" /> : null}
                  {status.message}
                </AlertDescription>
              </Alert>
            )}
            {busy && !status && (
              <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
                <Loader2 className="h-4 w-4 animate-spin" />
                {busy === "sign" ? t("wallet.sendSigning") : t("wallet.proposalsExecuting")}
              </p>
            )}
            <DialogFooter className="flex-col gap-2 sm:flex-col">
              <Button
                id="sign-proposal"
                type="button"
                variant="outline"
                className="w-full"
                disabled={busy !== null || detail.proposal.status === "executed"}
                onClick={() => void signCurrent()}
              >
                {busy === "sign" ? (
                  <>
                    <Loader2 className="animate-spin" />
                    {t("wallet.sendSigning")}
                  </>
                ) : (
                  t("wallet.proposalsSign")
                )}
              </Button>
              <Button
                id="execute-proposal"
                type="button"
                className="w-full"
                disabled={
                  busy !== null ||
                  detail.proposal.status === "executed" ||
                  !isFullySigned(detail.proposal, policy.threshold, detail.signatures)
                }
                onClick={() => void executeCurrent()}
              >
                {busy === "execute" ? (
                  <>
                    <Loader2 className="animate-spin" />
                    {t("wallet.sendPending")}
                  </>
                ) : (
                  t("wallet.proposalsExecute")
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        )}
      </Dialog>
    </WalletFrame>
  );
}
