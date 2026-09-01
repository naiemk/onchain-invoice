import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { getAddress, isAddress } from "ethers";
import { ArrowUpRight, Shield } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
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
import { loadWalletSession, type WalletSession } from "@/shared/wallet-session.js";
import { buildSignedSendUserOp, submitSignedUserOp } from "@/shared/userop-client.js";
import { parseUsdcInput } from "../../../../../commerce/shared/userop.js";
import { WalletFrame } from "./WalletFrame";

export function SendPage() {
  const { t } = useLocale();
  const navigate = useNavigate();
  const session = loadWalletSession();
  const [config, setConfig] = useState<WalletPublicConfig | null>(null);
  const [balanceUsd, setBalanceUsd] = useState("0.00");
  const [deployed, setDeployed] = useState(false);
  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [status, setStatus] = useState<{ kind: "info" | "error" | "success"; message: string } | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!session) {
      navigate("/wallet", { replace: true });
      return;
    }
    void (async () => {
      const cfg = await fetchWalletConfig();
      const policy = await fetchAdvancedPolicy(session.address).catch(() => null);
      if (policy?.advanced && policy.threshold > 1) {
        navigate("/wallet/proposals?create=1", { replace: true });
        return;
      }
      setConfig(cfg);
      try {
        const balance = await fetchWalletBalance(session.address);
        setBalanceUsd(balance.totalUsd);
        const primary = balance.chains.find((c) => c.chainId === cfg.chainId);
        let isDeployed = primary?.deployed ?? false;
        const account = await getWalletAccount(session.address).catch(() => null);
        if (account?.deployedChains.includes(cfg.chainId)) isDeployed = true;
        setDeployed(isDeployed);
      } catch {
        /* ignore */
      }
    })();
  }, [session, navigate]);

  const feeUsd = config?.bundlerFeeUsd ?? "—";

  const openReview = () => {
    if (!config || !session) return;
    if (!isAddress(recipient)) {
      setStatus({ kind: "error", message: t("wallet.sendInvalidRecipient") });
      return;
    }
    const chain = primaryChain(config);
    const parsed = parseUsdcInput(amount, chain.feeTokenDecimals);
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
    const feeAtoms = BigInt(config.bundlerFeeUsdc || "0");
    const sendAmount = parseUsdcInput(amount, chain.feeTokenDecimals);
    if (sendAmount === null) return;

    setBusy(true);
    setReviewOpen(false);
    setStatus({ kind: "info", message: t("wallet.sendSigning") });
    try {
      const balance = await fetchWalletBalance(session.address);
      const primary = balance.chains.find((c) => c.chainId === config.chainId);
      const balanceAtoms = BigInt(primary?.balance ?? "0");
      const total = sendAmount + feeAtoms;
      if (total > balanceAtoms) {
        setStatus({ kind: "error", message: t("wallet.sendInsufficientBalance") });
        return;
      }
      const { userOp, userOpHash } = await buildSignedSendUserOp({
        config,
        walletAddress: session.address,
        recipient: getAddress(recipient),
        sendAmount,
        feeAmount: feeAtoms,
        credentialId: session.credentialId,
      });
      setStatus({ kind: "info", message: t("wallet.sendSubmitting") });
      await submitSignedUserOp({ config, userOp, userOpHash, walletAddress: session.address });
      const result = await waitForUserOp(userOpHash);
      if (result.status === "included") {
        setStatus({
          kind: "success",
          message: t("wallet.sendSuccess", { hash: result.txHash ?? userOpHash }),
        });
        setRecipient("");
        setAmount("");
        setNote("");
        return;
      }
      setStatus({ kind: "error", message: result.rejectReason ?? t("wallet.sendFailed") });
    } catch (error) {
      setStatus({
        kind: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setBusy(false);
    }
  }, [amount, config, recipient, session, t]);

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
              <Input
                id="send-recipient"
                className="font-mono"
                placeholder="0x…"
                value={recipient}
                disabled={!deployed || busy}
                onChange={(e) => setRecipient(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="send-amount">{t("wallet.sendAmountUsdc")}</Label>
              <Input
                id="send-amount"
                inputMode="decimal"
                placeholder="0.00"
                value={amount}
                disabled={!deployed || busy}
                onChange={(e) => setAmount(e.target.value)}
              />
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
              className={`mt-4 text-sm ${
                status.kind === "error" ? "text-destructive" : status.kind === "success" ? "text-ok" : "text-muted-foreground"
              }`}
            >
              {status.message}
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
              <dd>{amount} USDC</dd>
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

      <p className="mt-4 text-sm text-muted-foreground">
        <Link to="/wallet/withdraw" className="text-primary hover:underline">
          {t("wallet.withdrawCta")}
        </Link>
      </p>
    </WalletFrame>
  );
}
