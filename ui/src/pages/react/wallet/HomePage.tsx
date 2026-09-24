import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { NoticeCarousel, type NoticeItem } from "@/components/NoticeCarousel";
import { useLocale } from "@/providers/LocaleProvider";
import { fetchWalletBalance, listDevices, walletChainIsFunded } from "@/shared/wallet-api.js";
import { formatPasskeyError } from "@/shared/webauthn.js";
import { unlockRegistryWallet } from "@/shared/wallet-unlock.js";
import { WalletAuthCard } from "./WalletAuthCard";
import { subscribePageVisible } from "@/shared/page-visibility.js";
import { fetchWalletRecovery } from "@/shared/wallet-recovery-api.js";
import { resolveAdvancedPolicy, listWalletEntities, listProposals } from "@/shared/wallet-advanced-api.js";
import { deploymentMode, isTestnet } from "@/shared/networks.js";
import {
  listWalletRegistry,
  listWalletRegistryForDeployment,
  loadWalletSession,
  isActiveWalletAddress,
  walletSessionsEquivalent,
  WALLET_SESSION_EVENT,
  type WalletSession,
} from "@/shared/wallet-session.js";
import { healWalletSession } from "@/shared/wallet-session-heal.js";
import { isAdvancedMode } from "@/shared/wallet-mode.js";
import { ChainBalanceList, WalletBalancePreview } from "./WalletBalancePreview";
import { IdentityOperatorRestoresCard } from "./IdentityOperatorRestoresCard";
import { WalletFrame } from "./WalletFrame";
import { useWalletPolicy } from "./wallet-policy";
import { isClosedProposal, isFullySigned, ProposalSummaryLine } from "./proposal-display";
import { StatusBadge } from "@/components/StatusBadge";
import type { WalletBalanceChain, WalletProposalRecord } from "../../../../../commerce/shared/wallet.js";

function WalletDashboard({ session: initialSession }: { session: WalletSession }) {
  const { t } = useLocale();
  const { isSuperWallet, policy } = useWalletPolicy();
  const advanced = isAdvancedMode();
  const [session, setSession] = useState(initialSession);
  const [healNotice, setHealNotice] = useState<string | null>(null);
  const [totalUsd, setTotalUsd] = useState(t("wallet.balanceLoading"));
  const [chains, setChains] = useState<WalletBalanceChain[]>([]);
  const [loading, setLoading] = useState(true);
  const [balanceError, setBalanceError] = useState(false);
  const [pendingRecovery, setPendingRecovery] = useState(false);
  const [notices, setNotices] = useState<NoticeItem[]>([]);
  const [entityLabel, setEntityLabel] = useState<string | null>(null);
  const [openProposals, setOpenProposals] = useState<WalletProposalRecord[]>([]);

  useEffect(() => {
    setSession(initialSession);
  }, [initialSession]);

  useEffect(() => {
    let cancelled = false;
    const target = initialSession;
    void (async () => {
      try {
        const healed = await healWalletSession(target);
        if (cancelled) return;
        if (!isActiveWalletAddress(target.address)) return;
        setSession(healed.session);
        if (healed.needsSuperWalletEmail && !target.identityId) {
          setHealNotice(t("wallet.superWalletRestoreEmailHint"));
        }
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [initialSession.address, t]);

  const loadBalance = useCallback(async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) setLoading(true);
    try {
      const balance = await fetchWalletBalance(session.address);
      setTotalUsd(balance.totalUsd);
      setChains(balance.chains);
      setBalanceError(false);
    } catch {
      setTotalUsd(t("wallet.balanceZero"));
      setBalanceError(true);
    } finally {
      if (!opts?.silent) setLoading(false);
    }
  }, [session.address, t]);

  useEffect(() => {
    void loadBalance();
  }, [loadBalance]);

  useEffect(() => subscribePageVisible(() => void loadBalance({ silent: true })), [loadBalance]);

  const activating = chains.some((c) => !c.deployed && walletChainIsFunded(c.balance));
  useEffect(() => {
    if (!activating) return;
    const id = window.setInterval(() => void loadBalance({ silent: true }), 3_000);
    return () => window.clearInterval(id);
  }, [activating, loadBalance]);

  useEffect(() => {
    if (isSuperWallet) {
      setPendingRecovery(false);
      return;
    }
    void (async () => {
      try {
        const recovery = await fetchWalletRecovery(session.address);
        if (recovery.request || recovery.pendingOwner?.active) setPendingRecovery(true);
      } catch {
        /* ignore */
      }
    })();
  }, [isSuperWallet, session.address]);

  useEffect(() => {
    if (!advanced && !session.identityId) {
      setNotices([]);
      return;
    }
    void (async () => {
      let deviceCount = 1;
      let onChainAdvanced = false;
      let superUnsupported = false;
      try {
        deviceCount = (await listDevices(session.address, session.chainId)).length || 1;
      } catch {
        deviceCount = 1;
      }
      const balance = await fetchWalletBalance(session.address).catch(() => null);
      const deployed = balance?.chains.some((c) => c.deployed) ?? false;
      if (session.identityId) {
        onChainAdvanced = isSuperWallet;
        superUnsupported = false;
      } else {
        const policy = await resolveAdvancedPolicy(session.address, deployed);
        onChainAdvanced = policy.advanced;
        superUnsupported = !onChainAdvanced && policy.supportsAdvanced === false;
      }
      if (onChainAdvanced) {
        try {
          const roster = await listWalletEntities(session.address);
          deviceCount = Math.max(roster.keys.length, roster.entities.length, 1);
        } catch {
          /* keep deviceCount */
        }
      }
      const devicesBodyKey = onChainAdvanced ? "wallet.advancedDevicesBodySuper" : "wallet.advancedDevicesBodySimple";
      const items: NoticeItem[] = [];

      if (superUnsupported) {
        items.push({
          id: "super-unsupported",
          title: t("wallet.superWalletUnsupportedTitle"),
          description: t("wallet.superWalletUnsupportedBody"),
          href: "/wallet/create",
          cta: t("wallet.createAnother"),
        });
      } else if (!onChainAdvanced) {
        items.push({
          id: "super-convert",
          title: t("wallet.superWalletHomeCta"),
          description: t("wallet.superWalletHomeBanner"),
          href: "/wallet/super-wallet",
          cta: t("wallet.superWalletConvertCta"),
          className: "border-primary/30 bg-primary/5",
        });
      }

      if (!onChainAdvanced) {
        items.push({
          id: "recovery",
          title: t("wallet.advancedRecoveryTitle"),
          description: t("wallet.advancedRecoveryBody"),
          href: "/wallet/security#recovery",
        });
      }
      items.push(
        {
          id: "devices",
          title: t("wallet.advancedDevicesTitle"),
          description: t(devicesBodyKey, { count: deviceCount }),
          href: "/wallet/security",
        },
        {
          id: "invoices",
          title: t("wallet.advancedInvoicesTitle"),
          description: t("wallet.advancedInvoicesBody"),
          href: "/wallet/invoices",
        }
      );

      setNotices(items);
    })();
  }, [advanced, isSuperWallet, session.address, session.chainId, session.identityId, t]);

  useEffect(() => {
    if (!isSuperWallet) {
      setEntityLabel(null);
      setOpenProposals([]);
      return;
    }
    let cancelled = false;
    void (async () => {
      const roster = await listWalletEntities(session.address).catch(() => ({ entities: [], keys: [] }));
      if (cancelled) return;
      const mine =
        roster.entities.find((e) => e.entityId === session.entityId) ?? roster.entities[0] ?? null;
      setEntityLabel(mine?.label ?? session.label);
      const list = await listProposals(session.address).catch(() => []);
      if (cancelled) return;
      setOpenProposals(list.filter((p) => !isClosedProposal(p)));
    })();
    return () => {
      cancelled = true;
    };
  }, [isSuperWallet, session.address, session.entityId, session.label]);

  return (
    <WalletFrame current="home">
      <div className="space-y-6">
        <div className="rounded-2xl bg-brand-panel p-6 text-brand-panel-foreground">
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-brand-panel-foreground/70">{t("wallet.totalBalance")}</p>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={loading}
              onClick={() => void loadBalance()}
              className="gap-2"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              {t("wallet.refresh")}
            </Button>
          </div>
          {loading ? (
            <Skeleton className="mt-2 h-12 w-48 bg-brand-panel-foreground/10" />
          ) : (
            <p className="mt-1 text-4xl font-semibold tracking-tight">
              {totalUsd} <span className="text-lg font-normal text-brand-panel-foreground/70">{t("wallet.usd")}</span>
            </p>
          )}
          <div className="mt-6 flex flex-wrap gap-2">
            <Button asChild size="sm" variant="secondary">
              <Link to="/wallet/get-paid">{t("wallet.actionGetPaid")}</Link>
            </Button>
            <Button asChild size="sm" variant="secondary">
              <Link to="/wallet/send">{t("wallet.actionPay")}</Link>
            </Button>
            <Button asChild size="sm" variant="secondary">
              <Link to="/wallet/cash">{t("wallet.actionCashIn")}</Link>
            </Button>
          </div>
        </div>
        {healNotice && (
          <Alert variant="warn">
            <AlertDescription>
              {healNotice}{" "}
              <Link to={isSuperWallet ? "/wallet/access" : "/wallet/super-wallet"} className="font-medium underline">
                {t("wallet.superWalletRestoreEmailCta")}
              </Link>
            </AlertDescription>
          </Alert>
        )}
        {pendingRecovery && !isSuperWallet && (
          <Alert variant="warn">
            <AlertDescription>
              {t("wallet.pendingRecovery")}{" "}
              <Link to="/wallet/security#recovery" className="font-medium underline">
                {t("wallet.recoverOpen")}
              </Link>
            </AlertDescription>
          </Alert>
        )}
        {session.identityId ? <IdentityOperatorRestoresCard /> : null}
        {isSuperWallet && policy && (
          <section
            data-testid="super-wallet-home-summary"
            className="rounded-xl border border-border bg-card p-5 space-y-4"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">{t("wallet.superWalletHomeEntity")}</p>
                <p className="text-sm font-medium">{entityLabel ?? session.label}</p>
                <p className="text-sm text-muted-foreground">
                  {t("wallet.superWalletActive", {
                    threshold: String(policy.threshold),
                    entities: String(policy.entityCount),
                  })}
                </p>
              </div>
              <Button asChild size="sm" variant="outline">
                <Link to="/wallet/access">{t("wallet.superWalletHomeOpenAccess")}</Link>
              </Button>
            </div>
            <div>
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-sm font-semibold">{t("wallet.superWalletHomeProposalsTitle")}</h2>
                <Button asChild size="sm" variant="ghost">
                  <Link to="/wallet/send?status=closed">{t("wallet.proposalsClosedCta")}</Link>
                </Button>
              </div>
              {openProposals.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("wallet.proposalsEmpty")}</p>
              ) : (
                <ul className="divide-y rounded-lg border">
                  {openProposals.map((p) => (
                    <li key={p.id} className="flex items-center justify-between gap-3 px-3 py-2">
                      <div className="min-w-0 space-y-1">
                        <p className="truncate text-sm">
                          <ProposalSummaryLine proposal={p} t={t} />
                        </p>
                        <div className="flex flex-wrap items-center gap-2">
                          <StatusBadge tone="pending">{p.status}</StatusBadge>
                          {isFullySigned(p, policy.threshold) ? (
                            <StatusBadge tone="verified">{t("wallet.proposalsFullySigned")}</StatusBadge>
                          ) : (
                            <span className="text-xs text-muted-foreground">
                              {t("wallet.proposalsSigCount", {
                                count: String(p.signatureCount ?? 0),
                                threshold: String(policy.threshold),
                              })}
                            </span>
                          )}
                        </div>
                      </div>
                      <Button asChild size="sm" variant="outline">
                        <Link to={`/wallet/send?id=${p.id}`}>{t("wallet.proposalsOpenOne")}</Link>
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>
        )}
        {advanced && notices.length > 0 && <NoticeCarousel items={notices} />}
        <p className="text-sm text-muted-foreground">
            <span className="font-medium">{t("wallet.thisDeviceChip")}</span>{" "}
            <Link to="/wallet/security" className="text-primary hover:underline">
              {t("wallet.manageDevices")}
            </Link>{" "}
            · {t("wallet.pairOtherDevices")}
          </p>
        {chains.length > 0 && (
          <section className="rounded-xl border border-border bg-card p-5">
            <h2 className="mb-3 text-sm font-semibold">{t("wallet.byChain")}</h2>
            {balanceError ? (
              <p className="text-sm text-destructive">{t("wallet.balanceError")}</p>
            ) : (
              <ChainBalanceList chains={chains} />
            )}
          </section>
        )}
      </div>
    </WalletFrame>
  );
}

function WalletPicker({
  registry,
  onOpened,
}: {
  registry: WalletSession[];
  onOpened: () => void;
}) {
  const { t } = useLocale();
  const [balances, setBalances] = useState<Record<string, string | null>>({});
  const [status, setStatus] = useState<string | null>(null);
  const [openingAddress, setOpeningAddress] = useState<string | null>(null);

  useEffect(() => {
    void Promise.all(
      registry.map(async (w) => {
        try {
          const b = await fetchWalletBalance(w.address);
          return [w.address, b.totalUsd] as const;
        } catch {
          return [w.address, null] as const;
        }
      })
    ).then((rows) => {
      setBalances(Object.fromEntries(rows));
    });
  }, [registry]);

  const openWallet = async (entry: WalletSession) => {
    setOpeningAddress(entry.address);
    setStatus(t("wallet.sendSigning"));
    try {
      await unlockRegistryWallet(entry);
      onOpened();
    } catch (error) {
      setStatus(formatPasskeyError(error));
    } finally {
      setOpeningAddress(null);
    }
  };

  return (
    <WalletFrame
      current="home"
      showChrome={false}
      title={t("wallet.chooseWallet")}
      lede={t("wallet.chooseWalletLede")}
    >
      <WalletBalancePreview
        wallets={registry.map((w) => ({
          address: w.address,
          label: w.label,
          chainId: w.chainId,
          balanceUsd: balances[w.address],
        }))}
        interactive
        onSelect={(address) => {
          const entry = registry.find((w) => w.address.toLowerCase() === address.toLowerCase());
          if (entry) void openWallet(entry);
        }}
      />
      <div className="mt-6 flex flex-wrap gap-3">
        <Button asChild variant="outline">
          <Link to="/wallet/create">{t("wallet.createAnother")}</Link>
        </Button>
      </div>
      {status && <p className="mt-2 text-sm text-destructive">{status}</p>}
    </WalletFrame>
  );
}


function WalletNetworkMismatch({ count, deploymentIsTestnet }: { count: number; deploymentIsTestnet: boolean }) {
  const { t } = useLocale();
  const modeLabel = deploymentIsTestnet ? t("common.testnet") : t("common.mainnet");
  const otherMode = deploymentIsTestnet ? t("common.mainnet") : t("common.testnet");
  return (
    <WalletFrame current="home" showChrome={false} title={t("wallet.chooseWallet")} lede={t("wallet.networkMismatchLede", { mode: modeLabel, other: otherMode })}>
      <Alert variant="warn">
        <AlertDescription>
          {t("wallet.networkMismatchBody", { count, other: otherMode, mode: modeLabel })}
        </AlertDescription>
      </Alert>
      <div className="mt-6">
        <Button asChild variant="outline">
          <Link to="/wallet/create">{t("wallet.createAnother")}</Link>
        </Button>
      </div>
    </WalletFrame>
  );
}

export function HomePage() {
  const [session, setSession] = useState(() => loadWalletSession());
  const deploymentIsTestnet = deploymentMode() === "testnet";
  const allRegistry = useMemo(() => listWalletRegistry(), [session]);
  const registry = useMemo(
    () => listWalletRegistryForDeployment(isTestnet, deploymentIsTestnet),
    [session, deploymentIsTestnet]
  );

  const refresh = useCallback(() => {
    setSession((prev) => {
      const next = loadWalletSession();
      if (!prev || !next) return next;
      return walletSessionsEquivalent(prev, next) ? prev : next;
    });
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    const handler = () => refresh();
    window.addEventListener(WALLET_SESSION_EVENT, handler);
    return () => window.removeEventListener(WALLET_SESSION_EVENT, handler);
  }, [refresh]);

  if (session) return <WalletDashboard key={session.address} session={session} />;
  if (registry.length > 0) return <WalletPicker registry={registry} onOpened={refresh} />;
  if (allRegistry.length > 0) {
    return <WalletNetworkMismatch count={allRegistry.length} deploymentIsTestnet={deploymentIsTestnet} />;
  }
  return <WalletAuthCard onOpened={refresh} />;
}
