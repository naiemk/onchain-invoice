import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ChevronDown, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { NoticeCarousel, type NoticeItem } from "@/components/NoticeCarousel";
import { ExplorerLink } from "@/components/ExplorerLink";
import { useLocale } from "@/providers/LocaleProvider";
import { fetchWalletBalance, listDevices } from "@/shared/wallet-api.js";
import { fetchWalletEmail, fetchWalletRecovery } from "@/shared/wallet-recovery-api.js";
import { resolveAdvancedPolicy, listWalletEntities } from "@/shared/wallet-advanced-api.js";
import { deploymentMode, isTestnet } from "@/shared/networks.js";
import {
  listWalletRegistry,
  listWalletRegistryForDeployment,
  loadWalletSession,
  shortAddress,
  WALLET_SESSION_EVENT,
  type WalletSession,
} from "@/shared/wallet-session.js";
import { formatPasskeyError, webAuthnSupported } from "@/shared/webauthn.js";
import { unlockRegistryWallet } from "@/shared/wallet-unlock.js";
import { LocalRecoverySheet, isUnlockRecoveryError } from "@/components/LocalRecoverySheet";
import { healWalletSession } from "@/shared/wallet-session-heal.js";
import { isAdvancedMode } from "@/shared/wallet-mode.js";
import type { WalletBalanceChain } from "../../../../../commerce/shared/wallet.js";
import { WalletFrame } from "./WalletFrame";

function ChainBalanceList({ chains, t }: { chains: WalletBalanceChain[]; t: (k: string, v?: Record<string, string | number>) => string }) {
  if (!chains.length) {
    return <p className="text-sm text-muted-foreground">{t("wallet.noChains")}</p>;
  }
  return (
    <ul className="divide-y rounded-lg border">
      {chains.map((c) => (
        <li key={c.chainId} className="flex items-center justify-between gap-4 px-4 py-3">
          <div>
            <strong className="text-sm">{c.networkLabel}</strong>
            <p className="text-xs text-muted-foreground">
              {c.deployed ? t("wallet.chainActive") : t("wallet.chainPending")}
            </p>
          </div>
          <span className="font-mono text-sm">
            {c.balanceUsd} {c.feeTokenSymbol}
          </span>
        </li>
      ))}
    </ul>
  );
}

function EmailAttachCard() {
  const { t } = useLocale();
  return (
    <Alert className="border-primary/30 bg-primary/5">
      <Mail className="h-4 w-4" />
      <AlertDescription className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <span>{t("wallet.emailAttachHint")}</span>
        <Button asChild size="sm" variant="secondary">
          <Link to="/wallet/security#recovery">{t("wallet.emailAttachCta")}</Link>
        </Button>
      </AlertDescription>
    </Alert>
  );
}

function WalletDashboard({ session: initialSession }: { session: WalletSession }) {
  const { t } = useLocale();
  const advanced = isAdvancedMode();
  const [session, setSession] = useState(initialSession);
  const [healNotice, setHealNotice] = useState<string | null>(null);
  const [totalUsd, setTotalUsd] = useState(t("wallet.balanceLoading"));
  const [chains, setChains] = useState<WalletBalanceChain[]>([]);
  const [loading, setLoading] = useState(true);
  const [balanceError, setBalanceError] = useState(false);
  const [pendingRecovery, setPendingRecovery] = useState(false);
  const [showEmailCard, setShowEmailCard] = useState(false);
  const [notices, setNotices] = useState<NoticeItem[]>([]);

  useEffect(() => {
    setSession(initialSession);
  }, [initialSession]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const healed = await healWalletSession(initialSession);
        if (cancelled) return;
        setSession(healed.session);
        if (healed.needsSuperWalletEmail) {
          setHealNotice(t("wallet.superWalletRestoreEmailHint"));
        }
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [initialSession, t]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const balance = await fetchWalletBalance(session.address);
        if (cancelled) return;
        setTotalUsd(balance.totalUsd);
        setChains(balance.chains);
        setBalanceError(false);
      } catch {
        if (cancelled) return;
        setTotalUsd(t("wallet.balanceZero"));
        setBalanceError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [session.address, t]);

  useEffect(() => {
    void (async () => {
      try {
        const recovery = await fetchWalletRecovery(session.address);
        if (recovery.request || recovery.pendingOwner?.active) setPendingRecovery(true);
      } catch {
        /* ignore */
      }
    })();
  }, [session.address]);

  useEffect(() => {
    if (advanced) return;
    void (async () => {
      try {
        const policy = await resolveAdvancedPolicy(session.address, false);
        if (policy.advanced) return;
        const email = await fetchWalletEmail(session.address);
        if (!email.hasEmail && !email.verified) setShowEmailCard(true);
      } catch {
        /* ignore */
      }
    })();
  }, [advanced, session.address]);

  useEffect(() => {
    if (!advanced) return;
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
      const policy = await resolveAdvancedPolicy(session.address, deployed);
      onChainAdvanced = policy.advanced;
      superUnsupported = !onChainAdvanced && policy.supportsAdvanced === false;
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
      } else {
        items.push({
          id: "super-manage",
          title: t("wallet.superWalletTitle"),
          description: t("wallet.superWalletActiveShort"),
          href: "/wallet/super-wallet",
          cta: t("wallet.superWalletManage"),
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
          id: "recovery",
          title: t("wallet.advancedRecoveryTitle"),
          description: t("wallet.advancedRecoveryBody"),
          href: "/wallet/security#recovery",
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
  }, [advanced, session.address, session.chainId, t]);

  return (
    <WalletFrame current="home">
      <div className="space-y-6">
        <div className="rounded-2xl bg-brand-panel p-6 text-brand-panel-foreground">
          <p className="text-xs text-brand-panel-foreground/70">{t("wallet.totalBalance")}</p>
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
        {!advanced && showEmailCard && <EmailAttachCard />}
        {healNotice && (
          <Alert variant="warn">
            <AlertDescription>
              {healNotice}{" "}
              <Link to="/wallet/super-wallet" className="font-medium underline">
                {t("wallet.superWalletRestoreEmailCta")}
              </Link>
            </AlertDescription>
          </Alert>
        )}
        {pendingRecovery && (
          <Alert variant="warn">
            <AlertDescription>
              {t("wallet.pendingRecovery")}{" "}
              <Link to="/wallet/security#recovery" className="font-medium underline">
                {t("wallet.recoverOpen")}
              </Link>
            </AlertDescription>
          </Alert>
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
              <ChainBalanceList chains={chains} t={t} />
            )}
          </section>
        )}
      </div>
    </WalletFrame>
  );
}

function AnotherWalletMenu({
  disabled,
  onRecover,
}: {
  disabled?: boolean;
  onRecover: () => void;
}) {
  const { t } = useLocale();
  const navigate = useNavigate();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="outline" disabled={disabled} className="gap-2">
          {t("wallet.otherWalletOptions")}
          <ChevronDown className="h-4 w-4 opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-[16rem]">
        <DropdownMenuItem onClick={() => navigate("/wallet/pair")}>
          {t("wallet.pairWithAnotherDevice")}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onRecover}>{t("wallet.recoverExistingOnDevice")}</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
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
  const [recoveryEntry, setRecoveryEntry] = useState<WalletSession | null>(null);
  const [recoveryOpen, setRecoveryOpen] = useState(false);

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

  const openRecovery = (entry?: WalletSession) => {
    setRecoveryEntry(entry ?? null);
    setRecoveryOpen(true);
  };

  const openWallet = async (entry: WalletSession) => {
    setOpeningAddress(entry.address);
    setStatus(t("wallet.sendSigning"));
    try {
      await unlockRegistryWallet(entry);
      onOpened();
    } catch (error) {
      if (isUnlockRecoveryError(error)) {
        openRecovery(entry);
        setStatus(null);
      } else {
        setStatus(formatPasskeyError(error));
      }
    } finally {
      setOpeningAddress(null);
    }
  };

  return (
    <>
    <WalletFrame
      current="home"
      showChrome={false}
      title={t("wallet.chooseWallet")}
      lede={t("wallet.chooseWalletLede")}
    >
      <div className="space-y-3">
        {registry.map((w) => (
          <button
            key={w.address}
            type="button"
            disabled={Boolean(openingAddress)}
            onClick={() => void openWallet(w)}
            className="flex w-full items-center justify-between gap-4 rounded-lg border p-4 text-left transition-colors hover:border-primary/40 disabled:opacity-60"
          >
            <div>
              <h3 className="font-medium">{w.label}</h3>
              <p className="flex items-center gap-1 font-mono text-sm text-muted-foreground">
                {shortAddress(w.address)}
                <ExplorerLink chainId={w.chainId} value={w.address} />
              </p>
              {balances[w.address] != null && Number(balances[w.address]) > 0 && (
                <p className="mt-1 text-xs text-muted-foreground">
                  {t("wallet.fundsSafeAtAddress", { address: shortAddress(w.address) })}
                </p>
              )}
            </div>
            <div className="text-right">
              <p className="text-sm">
                {balances[w.address] != null
                  ? `${balances[w.address]} ${t("wallet.usd")}`
                  : t("wallet.balanceUnavailableShort")}
              </p>
              <span className="text-xs text-primary">
                {openingAddress === w.address ? t("wallet.sendSigning") : t("wallet.signIn")}
              </span>
            </div>
          </button>
        ))}
      </div>
      <div className="mt-6 flex flex-wrap gap-3">
        <Button asChild variant="outline">
          <Link to="/wallet/create">{t("wallet.createAnother")}</Link>
        </Button>
        <AnotherWalletMenu disabled={Boolean(openingAddress)} onRecover={() => openRecovery()} />
      </div>
      <p className="mt-4 text-sm text-muted-foreground">{t("wallet.syncHint")}</p>
      {status && <p className="mt-2 text-sm text-destructive">{status}</p>}
    </WalletFrame>
    <LocalRecoverySheet
      open={recoveryOpen}
      onOpenChange={setRecoveryOpen}
      initialEntry={recoveryEntry}
      onRecovered={onOpened}
    />
    </>
  );
}

function WalletEmpty({ onOpened }: { onOpened: () => void }) {
  const { t } = useLocale();
  const supported = webAuthnSupported();
  const [recoveryOpen, setRecoveryOpen] = useState(false);

  return (
    <>
    <WalletFrame current="home" showChrome={false} title={t("wallet.homeTitle")} lede={t("wallet.homeLede")}>
      <div className="grid gap-3 md:grid-cols-2">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">{t("wallet.createEmptyTitle")}</CardTitle>
            <CardDescription>{t("wallet.createEmptyBody")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-xs text-muted-foreground">{supported ? t("wallet.webauthnOk") : t("wallet.webauthnNo")}</p>
            <Button asChild>
              <Link to="/wallet/create">{t("wallet.create")}</Link>
            </Button>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">{t("wallet.otherWalletOptions")}</CardTitle>
            <CardDescription>{t("wallet.otherWalletOptionsLede")}</CardDescription>
          </CardHeader>
          <CardContent>
            <AnotherWalletMenu onRecover={() => setRecoveryOpen(true)} />
          </CardContent>
        </Card>
      </div>
    </WalletFrame>
    <LocalRecoverySheet open={recoveryOpen} onOpenChange={setRecoveryOpen} onRecovered={onOpened} />
    </>
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

  const refresh = useCallback(() => setSession(loadWalletSession()), []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    const handler = () => refresh();
    window.addEventListener(WALLET_SESSION_EVENT, handler);
    return () => window.removeEventListener(WALLET_SESSION_EVENT, handler);
  }, [refresh]);

  if (session) return <WalletDashboard session={session} />;
  if (registry.length > 0) return <WalletPicker registry={registry} onOpened={refresh} />;
  if (allRegistry.length > 0) {
    return <WalletNetworkMismatch count={allRegistry.length} deploymentIsTestnet={deploymentIsTestnet} />;
  }
  return <WalletEmpty onOpened={refresh} />;
}
