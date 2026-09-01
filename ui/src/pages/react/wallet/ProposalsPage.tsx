import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { getAddress, isAddress } from "ethers";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useLocale } from "@/providers/LocaleProvider";
import { fetchWalletConfig, waitForUserOp } from "@/shared/wallet-api.js";
import {
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

type StatusKind = "info" | "error" | "success";

function shortAddr(addr: string): string {
  return `${addr.slice(0, 8)}…${addr.slice(-4)}`;
}

export function ProposalsPage() {
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

  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("");

  const [detail, setDetail] = useState<{
    proposal: WalletProposalRecord;
    signatures: WalletProposalSigRecord[];
  } | null>(null);

  const showCreate = searchParams.get("create") === "1";
  const openId = searchParams.get("id");

  const loadDetail = useCallback(
    async (proposalId: string, sess: WalletSession, cfg: WalletPublicConfig, thresh: number) => {
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
    },
    []
  );

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
        const list = await listProposals(sess.address).catch(() => []);
        if (cancelled) return;
        setProposals(list);
        if (openId) {
          await loadDetail(openId, sess, cfg, pol.threshold);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [navigate, openId, loadDetail]);

  const createNew = async () => {
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
      setProposals(await listProposals(session.address));
      await loadDetail(proposal.id, session, config, policy!.threshold);
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
    if (!session || !config || !detail || !policy) return;
    setBusy("sign");
    setStatus({ kind: "info", message: t("wallet.sendSigning") });
    try {
      const roster = await listWalletEntities(session.address);
      let myKey =
        (session.keyId ? roster.keys.find((k) => k.keyId === session.keyId) : null) ??
        roster.keys.find((k) => k.qx === session.qx && k.qy === session.qy) ??
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
      await loadDetail(detail.proposal.id, session, config, policy.threshold);
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
      setStatus({ kind: "success", message: t("wallet.proposalsExecuted") });
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

  return (
    <WalletFrame
      current="superWallet"
      title={t("wallet.proposalsTitle")}
      lede={policy ? t("wallet.proposalsLede", { threshold: String(policy.threshold) }) : undefined}
    >
      {loading ? (
        <div className="space-y-4">
          <Skeleton className="h-8 w-1/2" />
          <Skeleton className="h-24 w-full" />
        </div>
      ) : (
        <div className="space-y-8">
          <section className="space-y-3">
            <h2 className="text-lg font-semibold">{t("wallet.proposalsInbox")}</h2>
            {proposals.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("wallet.proposalsEmpty")}</p>
            ) : (
              <ul className="divide-y rounded-lg border">
                {proposals.map((p) => (
                  <li key={p.id} className="flex items-center justify-between gap-4 p-4">
                    <div>
                      <strong className="text-sm">{p.status}</strong>
                      <span className="ml-2 font-mono text-xs text-muted-foreground">{shortAddr(p.target)}</span>
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setSearchParams({ id: p.id }, { replace: true });
                        void loadDetail(p.id, session, config!, policy!.threshold);
                      }}
                    >
                      {t("wallet.proposalsOpenOne")}
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {showCreate ? (
            <section className="space-y-4">
              <h2 className="text-lg font-semibold">{t("wallet.proposalsCreateTitle")}</h2>
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
              <Button id="create-proposal" type="button" disabled={busy === "create"} onClick={() => void createNew()}>
                {t("wallet.proposalsCreateCta")}
              </Button>
            </section>
          ) : (
            <Button asChild variant="outline">
              <Link to="/wallet/proposals?create=1">{t("wallet.proposalsNew")}</Link>
            </Button>
          )}

          {detail && policy && (
            <section id="proposal-detail" className="space-y-4 rounded-lg border p-4">
              <h2 className="text-lg font-semibold">{t("wallet.proposalsDetail")}</h2>
              <p className="font-mono text-xs text-muted-foreground">
                {detail.proposal.target} · {detail.proposal.status}
              </p>
              <p className="text-sm">
                {t("wallet.proposalsSigCount", {
                  count: String(detail.signatures.length),
                  threshold: String(policy.threshold),
                })}
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  id="sign-proposal"
                  type="button"
                  variant="outline"
                  disabled={busy !== null}
                  onClick={() => void signCurrent()}
                >
                  {t("wallet.proposalsSign")}
                </Button>
                <Button id="execute-proposal" type="button" disabled={busy !== null} onClick={() => void executeCurrent()}>
                  {t("wallet.proposalsExecute")}
                </Button>
              </div>
            </section>
          )}

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
      )}
    </WalletFrame>
  );
}
