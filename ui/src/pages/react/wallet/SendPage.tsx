import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Contract, JsonRpcProvider, formatUnits, getAddress, isAddress } from "ethers";
import { ArrowUpRight, CheckCircle2, Copy, Shield } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { SendScanButton } from "@/components/SendScanDialog";
import { ExplorerLink } from "@/components/ExplorerLink";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { PageCard, PageSplit } from "@/components/PageSplit";
import { useLocale } from "@/providers/LocaleProvider";
import {
  fetchWalletBalance,
  fetchWalletConfig,
  getWalletAccount,
  primaryChain,
  waitForUserOp,
  type WalletPublicConfig,
} from "@/shared/wallet-api.js";
import { fetchAdvancedPolicy } from "@/shared/wallet-advanced-api.js";
import { healWalletSession } from "@/shared/wallet-session-heal.js";
import { loadWalletSession, type WalletSession } from "@/shared/wallet-session.js";
import { buildSignedAdvancedSendUserOp } from "@/shared/advanced-userop-client.js";
import { buildSignedSendUserOp, submitSignedUserOp } from "@/shared/userop-client.js";
import { ERC20_ABI, parseUsdcInput } from "../../../../../commerce/shared/userop.js";
import { WalletFrame } from "./WalletFrame";

function formatSendRejectReason(reason: string | null | undefined, t: (key: string, vars?: Record<string, string | number>) => string): string {
  switch (reason) {
    case "signature_invalid":
      return t("wallet.userOpSignatureInvalid");
    case "insufficient_balance":
      return t("wallet.userOpInsufficientBalance");
    case "simulation_revert":
      return t("wallet.userOpSimulationRevert");
    case "execution_reverted":
      return t("wallet.userOpExecutionReverted");
    case "prefund_failed":
      return t("wallet.userOpPrefundFailed");
    default:
      return reason?.startsWith("simulation_revert:") ? t("wallet.userOpSimulationRevert") : reason ?? t("wallet.sendFailed");
  }
}

export function SendPage() {
  const { t } = useLocale();
  const navigate = useNavigate();
  const [session, setSession] = useState<WalletSession | null>(() => loadWalletSession());
  const [config, setConfig] = useState<WalletPublicConfig | null>(null);
  const [balanceUsd, setBalanceUsd] = useState("0.00");
  const [tokenBalances, setTokenBalances] = useState<Record<string, bigint>>({});
  const [deployed, setDeployed] = useState(false);
  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("");
  const [selectedTokenSymbol, setSelectedTokenSymbol] = useState("USDC");
  const [note, setNote] = useState("");
  const [status, setStatus] = useState<{ kind: "info" | "error" | "success"; message: string; txHash?: string } | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [successTxHash, setSuccessTxHash] = useState<string | null>(null);
  const [txCopied, setTxCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [advancedEntityId, setAdvancedEntityId] = useState<string | null>(null);

  useEffect(() => {
    if (!session) {
      navigate("/wallet", { replace: true });
      return;
    }
    void (async () => {
      const healed = await healWalletSession(session);
      if (healed.session !== session) setSession(healed.session);
      const active = healed.session;
      const cfg = await fetchWalletConfig();
      const policy = await fetchAdvancedPolicy(active.address).catch(() => null);
      if (policy?.advanced && policy.threshold > 1) {
        navigate("/wallet/proposals?create=1", { replace: true });
        return;
      }
      if (policy?.advanced) {
        if (healed.needsSuperWalletEmail) {
          navigate("/wallet/super-wallet", { replace: true });
          return;
        }
        if (active.entityId) setAdvancedEntityId(active.entityId);
      }
      setConfig(cfg);
      try {
        const balance = await fetchWalletBalance(active.address);
        setBalanceUsd(balance.totalUsd);
        const chain = primaryChain(cfg);
        const primary = balance.chains.find((c) => c.chainId === chain.chainId);
        setTokenBalances((prev) => ({ ...prev, [chain.feeTokenSymbol]: BigInt(primary?.balance ?? "0") }));
        let isDeployed = primary?.deployed ?? false;
        const account = await getWalletAccount(active.address).catch(() => null);
        if (account?.deployedChains.includes(cfg.chainId)) isDeployed = true;
        setDeployed(isDeployed);
      } catch {
        /* ignore */
      }
    })();
  }, [session, navigate]);

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
          ].filter((token, index, arr) => token.address && arr.findIndex((t) => t.symbol === token.symbol) === index)
        : [],
    [chain]
  );
  const selectedToken = tokenOptions.find((token) => token.symbol === selectedTokenSymbol) ?? tokenOptions[0];
  const feeUsd = config?.bundlerFeeUsd ?? "—";
  const tokenDecimals = selectedToken?.decimals ?? chain?.feeTokenDecimals ?? 6;
  const selectedTokenBalance = selectedToken ? tokenBalances[selectedToken.symbol] ?? 0n : 0n;
  const feeTokenBalance = chain ? tokenBalances[chain.feeTokenSymbol] ?? 0n : 0n;
  const selectedPaysFee = Boolean(
    selectedToken?.address && chain?.feeTokenAddress && selectedToken.address.toLowerCase() === chain.feeTokenAddress.toLowerCase()
  );
  const maxSendAtoms = selectedPaysFee
    ? selectedTokenBalance > BigInt(config?.bundlerFeeUsdc || "0")
      ? selectedTokenBalance - BigInt(config?.bundlerFeeUsdc || "0")
      : 0n
    : selectedTokenBalance;
  const selectedAvailable = formatUnits(selectedTokenBalance, tokenDecimals);

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
    if (!config || !session || !selectedToken) return;
    if (!isAddress(recipient)) {
      setStatus({ kind: "error", message: t("wallet.sendInvalidRecipient") });
      return;
    }
    const parsed = parseUsdcInput(amount, selectedToken.decimals);
    if (parsed === null || parsed <= 0n) {
      setStatus({ kind: "error", message: t("wallet.sendInvalidAmount") });
      return;
    }
    setStatus(null);
    setReviewOpen(true);
  };

  const confirmSend = useCallback(async () => {
    if (!config || !session) return;
    const chain = primaryChain(config);
    const token = selectedToken;
    if (!token?.address) return;
    const feeAtoms = BigInt(config.bundlerFeeUsdc || "0");
    const sendAmount = parseUsdcInput(amount, token.decimals);
    if (sendAmount === null) return;

    setBusy(true);
    setReviewOpen(false);
    setStatus({ kind: "info", message: t("wallet.sendSigning") });
    try {
      const policy = await fetchAdvancedPolicy(session.address).catch(() => null);
      if (policy?.advanced && !advancedEntityId) {
        setStatus({ kind: "error", message: t("wallet.superWalletRestoreEmailHint") });
        navigate("/wallet/super-wallet");
        return;
      }
      if (!chain.rpcUrl) throw new Error("RPC not configured");
      const tokenContract = new Contract(token.address, ERC20_ABI, new JsonRpcProvider(chain.rpcUrl));
      const latestTokenBalance = BigInt(await tokenContract.balanceOf(session.address));
      const balance = await fetchWalletBalance(session.address);
      const primary = balance.chains.find((c) => c.chainId === chain.chainId);
      const latestFeeBalance = BigInt(primary?.balance ?? "0");
      const tokenPaysFee = token.address.toLowerCase() === (chain.feeTokenAddress ?? "").toLowerCase();
      if (sendAmount > latestTokenBalance || (tokenPaysFee ? sendAmount + feeAtoms > latestFeeBalance : feeAtoms > latestFeeBalance)) {
        setStatus({ kind: "error", message: t("wallet.sendInsufficientBalance") });
        return;
      }
      const { userOp, userOpHash } =
        advancedEntityId != null
          ? await buildSignedAdvancedSendUserOp({
              config,
              walletAddress: session.address,
              entityId: advancedEntityId,
              qx: session.qx,
              qy: session.qy,
              recipient: getAddress(recipient),
              sendAmount,
              feeAmount: feeAtoms,
              credentialId: session.credentialId,
              chainId: chain.chainId,
              sendTokenAddress: token.address,
            })
          : await buildSignedSendUserOp({
              config,
              walletAddress: session.address,
              recipient: getAddress(recipient),
              sendAmount,
              feeAmount: feeAtoms,
              credentialId: session.credentialId,
              chainId: chain.chainId,
              sendTokenAddress: token.address,
            });
      setStatus({ kind: "info", message: t("wallet.sendSubmitting") });
      await submitSignedUserOp({ config, userOp, userOpHash, walletAddress: session.address });
      const result = await waitForUserOp(userOpHash);
      if (result.status === "included") {
        const txHash = result.txHash ?? userOpHash;
        setStatus({ kind: "success", message: t("wallet.sendSuccessShort") });
        setSuccessTxHash(txHash);
        setTxCopied(false);
        setRecipient("");
        setAmount("");
        setNote("");
        return;
      }
      setStatus({ kind: "error", message: formatSendRejectReason(result.rejectReason, t) });
    } catch (error) {
      setStatus({
        kind: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setBusy(false);
    }
  }, [advancedEntityId, amount, config, navigate, recipient, selectedToken, session, t]);

  const shortSuccessTx = successTxHash ? `${successTxHash.slice(0, 10)}…${successTxHash.slice(-8)}` : "";
  const copySuccessTx = async () => {
    if (!successTxHash) return;
    await navigator.clipboard.writeText(successTxHash);
    setTxCopied(true);
    window.setTimeout(() => setTxCopied(false), 1600);
  };

  if (!session) return null;

  return (
    <WalletFrame
      current="send"
      title={t("wallet.sendPageTitle")}
      lede={t("wallet.sendPageLede")}
    >
      <PageSplit>
        <PageCard>
          {!deployed && (
            <Alert variant="warn" className="mb-4">
              <AlertDescription>{t("wallet.sendNotDeployed")}</AlertDescription>
            </Alert>
          )}
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="send-recipient">{t("wallet.sendRecipient")}</Label>
              <div className="flex gap-2">
                <Input
                  id="send-recipient"
                  className="font-mono"
                  placeholder="0x…"
                  value={recipient}
                  disabled={!deployed || busy}
                  onChange={(e) => setRecipient(e.target.value)}
                />
                <SendScanButton onScan={handleScan} tokenDecimals={tokenDecimals} disabled={!deployed || busy} />
              </div>
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-3">
                <Label htmlFor="send-amount">{t("wallet.sendAmount")}</Label>
                <Select value={selectedTokenSymbol} onValueChange={setSelectedTokenSymbol} disabled={!deployed || busy || tokenOptions.length <= 1}>
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
                id="send-amount"
                inputMode="decimal"
                placeholder="0.00"
                value={amount}
                disabled={!deployed || busy}
                onChange={(e) => setAmount(e.target.value)}
              />
              <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
                <span>{t("wallet.sendAvailable", { amount: selectedAvailable, symbol: selectedToken?.symbol ?? "" })}</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-xs"
                  disabled={!deployed || busy || maxSendAtoms <= 0n}
                  onClick={() => setAmount(formatUnits(maxSendAtoms, tokenDecimals))}
                >
                  {t("wallet.max")}
                </Button>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="send-note">{t("wallet.sendNoteOptional")}</Label>
              <Input
                id="send-note"
                placeholder={t("wallet.sendNotePlaceholder")}
                value={note}
                disabled={!deployed || busy}
                onChange={(e) => setNote(e.target.value)}
              />
            </div>
            <Button type="button" disabled={!deployed || busy} onClick={openReview}>
              {t("wallet.sendReview")}
              <ArrowUpRight className="h-3.5 w-3.5" />
            </Button>
          </div>
          {status && (
            <p
              role="status"
              className={`mt-4 flex flex-wrap items-center gap-2 text-sm ${
                status.kind === "error" ? "text-destructive" : status.kind === "success" ? "text-ok" : "text-muted-foreground"
              }`}
            >
              <span>{status.message}</span>
              {status.txHash && config && (
                <ExplorerLink chainId={config.chainId} value={status.txHash} kind="tx" />
              )}
            </p>
          )}
        </PageCard>

        <PageCard>
          <Shield className="mb-3 h-5 w-5 text-emphasis" aria-hidden />
          <h2 className="text-base font-semibold">{t("wallet.sendPauseTitle")}</h2>
          <p className="mt-2 text-sm text-muted-foreground">{t("wallet.sendPauseBody")}</p>
          <p className="mt-4 text-sm text-muted-foreground">
            {t("wallet.sendNetworkFeeLine", { fee: feeUsd })}
          </p>
          <p className="mt-2 text-sm">
            {t("wallet.sendAvailable", { amount: balanceUsd, symbol: t("wallet.usd") })}
          </p>
        </PageCard>
      </PageSplit>

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
              <dd>{amount} {selectedToken?.symbol ?? ""}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">{t("wallet.networkFee")}</dt>
              <dd>{feeUsd}</dd>
            </div>
          </dl>
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={() => setReviewOpen(false)}>
              {t("wallet.cancel")}
            </Button>
            <Button type="button" disabled={busy} onClick={() => void confirmSend()}>
              {t("wallet.sendConfirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(successTxHash)} onOpenChange={(open) => !open && setSuccessTxHash(null)}>
        <DialogContent>
          <DialogHeader>
            <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-full bg-ok/10 text-ok">
              <CheckCircle2 className="h-5 w-5" />
            </div>
            <DialogTitle>{t("wallet.sendSuccessTitle")}</DialogTitle>
            <DialogDescription>{t("wallet.sendSuccessBody")}</DialogDescription>
          </DialogHeader>
          {successTxHash && (
            <div className="rounded-lg border bg-muted/30 p-3">
              <p className="mb-1 text-xs font-medium text-muted-foreground">{t("wallet.transactionId")}</p>
              <div className="flex items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-2">
                  <code className="truncate font-mono text-sm">{shortSuccessTx}</code>
                  <ExplorerLink chainId={config?.chainId} value={successTxHash} kind="tx" />
                </div>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="h-8 w-8 shrink-0"
                  onClick={() => void copySuccessTx()}
                  aria-label={txCopied ? t("wallet.copied") : t("wallet.copy")}
                  title={txCopied ? t("wallet.copied") : t("wallet.copy")}
                >
                  <Copy className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button type="button" onClick={() => setSuccessTxHash(null)}>
              {t("wallet.done")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <p className="mt-4 text-sm text-muted-foreground">
        <Link to="/wallet/withdraw" className="text-primary hover:underline">
          {t("wallet.withdrawCta")}
        </Link>
      </p>
    </WalletFrame>
  );
}
