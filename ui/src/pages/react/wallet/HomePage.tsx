import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { ActionTile } from "@/components/ActionTile";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useLocale } from "@/providers/LocaleProvider";
import { fetchWalletBalance, listDevices } from "@/shared/wallet-api.js";
import { fetchWalletRecovery } from "@/shared/wallet-recovery-api.js";
import { fetchAdvancedPolicy, listWalletEntities } from "@/shared/wallet-advanced-api.js";
import {
  listWalletRegistry,
  loadWalletSession,
  setActiveWallet,
  shortAddress,
  type WalletSession,
} from "@/shared/wallet-session.js";
import { webAuthnSupported } from "@/shared/webauthn.js";
import { unlockWalletWithPasskey } from "@/shared/wallet-unlock.js";
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

function WalletDashboard({ session }: { session: WalletSession }) {
  const { t } = useLocale();
  const advanced = isAdvancedMode();
  const [totalUsd, setTotalUsd] = useState(t("wallet.balanceLoading"));
  const [chains, setChains] = useState<WalletBalanceChain[]>([]);
  const [loading, setLoading] = useState(true);
  const [balanceError, setBalanceError] = useState(false);
  const [pendingRecovery, setPendingRecovery] = useState(false);
  const [advancedHtml, setAdvancedHtml] = useState<ReactNode>(
    <p className="text-sm text-muted-foreground">{t("wallet.advancedHomeLoading")}</p>
  );

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
    if (!advanced) return;
    void (async () => {
      let deviceCount = 1;
      let onChainAdvanced = false;
      try {
        deviceCount = (await listDevices(session.address, session.chainId)).length || 1;
      } catch {
        deviceCount = 1;
      }
      try {
        const policy = await fetchAdvancedPolicy(session.address);
        onChainAdvanced = policy.advanced;
        if (onChainAdvanced) {
          const roster = await listWalletEntities(session.address);
          deviceCount = Math.max(roster.keys.length, roster.entities.length, 1);
        }
      } catch {
        onChainAdvanced = false;
      }
      const devicesBodyKey = onChainAdvanced ? "wallet.advancedDevicesBodySuper" : "wallet.advancedDevicesBodySimple";
      setAdvancedHtml(
        <div className="grid gap-3 sm:grid-cols-2">
          {!onChainAdvanced ? (
            <ActionTile
              href="/wallet/super-wallet"
              title={t("wallet.superWalletHomeCta")}
              description={t("wallet.superWalletHomeBanner")}
              cta={t("wallet.superWalletConvertCta")}
              className="border-primary/30 bg-primary/5"
            />
          ) : (
            <ActionTile
              href="/wallet/super-wallet"
              title={t("wallet.superWalletTitle")}
              description={t("wallet.superWalletActiveShort")}
              cta={t("wallet.superWalletManage")}
            />
          )}
          <ActionTile
            href="/wallet/security"
            title={t("wallet.advancedDevicesTitle")}
            description={t(devicesBodyKey, { count: deviceCount })}
          />
          <ActionTile
            href="/wallet/recover"
            title={t("wallet.advancedRecoveryTitle")}
            description={t("wallet.advancedRecoveryBody")}
          />
          <ActionTile
            href="/merchant"
            title={t("wallet.advancedInvoicesTitle")}
            description={t("wallet.advancedInvoicesBody")}
          />
          <ActionTile
            href="/wallet/developers"
            title={t("wallet.developersTab")}
            description={t("wallet.advancedDevBody")}
          />
        </div>
      );
    })();
  }, [advanced, session.address, session.chainId, t]);

  return (
    <WalletFrame current="home">
      <div className="space-y-6">
        <div className={balanceError ? "text-destructive" : ""}>
          <p className="text-sm font-medium uppercase tracking-wider text-muted-foreground">{t("wallet.totalBalance")}</p>
          {loading ? (
            <Skeleton className="mt-2 h-10 w-48" />
          ) : (
            <p className="mt-1 text-4xl font-semibold tracking-tight">
              {totalUsd} <span className="text-lg font-normal text-muted-foreground">{t("wallet.usd")}</span>
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild>
            <Link to="/wallet/get-paid">{t("wallet.actionGetPaid")}</Link>
          </Button>
          <Button asChild variant="outline">
            <Link to="/wallet/send">{t("wallet.actionPay")}</Link>
          </Button>
          <Button asChild variant="outline">
            <Link to="/wallet/cash">{t("wallet.actionCashIn")}</Link>
          </Button>
          <Button asChild variant="outline">
            <Link to="/wallet/cash">{t("wallet.actionCashOut")}</Link>
          </Button>
        </div>
        {pendingRecovery && (
          <Alert variant="warn">
            <AlertDescription>
              {t("wallet.pendingRecovery")}{" "}
              <Link to="/wallet/recover" className="font-medium underline">
                {t("wallet.recoverOpen")}
              </Link>
            </AlertDescription>
          </Alert>
        )}
        {advanced && <div>{advancedHtml}</div>}
        <p className="text-sm text-muted-foreground">
          <span className="font-medium">{t("wallet.thisDeviceChip")}</span>{" "}
          <Link to="/wallet/security" className="text-primary hover:underline">
            {t("wallet.manageDevices")}
          </Link>{" "}
          · {t("wallet.pairOtherDevices")}
        </p>
        {chains.length > 0 && (
          <section>
            <h2 className="mb-3 text-lg font-semibold">{t("wallet.byChain")}</h2>
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
  const [unlocking, setUnlocking] = useState(false);

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

  const openWallet = (addr: string) => {
    if (setActiveWallet(addr)) onOpened();
  };

  const unlock = async () => {
    setUnlocking(true);
    setStatus(t("wallet.sendSigning"));
    try {
      await unlockWalletWithPasskey();
      onOpened();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setUnlocking(false);
    }
  };

  return (
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
            onClick={() => openWallet(w.address)}
            className="flex w-full items-center justify-between gap-4 rounded-lg border p-4 text-left transition-colors hover:border-primary/40"
          >
            <div>
              <h3 className="font-medium">{w.label}</h3>
              <p className="font-mono text-sm text-muted-foreground">{shortAddress(w.address)}</p>
            </div>
            <div className="text-right">
              <p className="text-sm">
                {balances[w.address] != null
                  ? `${balances[w.address]} ${t("wallet.usd")}`
                  : t("wallet.balanceUnavailableShort")}
              </p>
              <span className="text-xs text-primary">{t("wallet.openWallet")}</span>
            </div>
          </button>
        ))}
      </div>
      <div className="mt-6 flex flex-wrap gap-3">
        <Button asChild variant="outline">
          <Link to="/wallet/create">{t("wallet.createAnother")}</Link>
        </Button>
        <Button type="button" variant="outline" disabled={unlocking} onClick={() => void unlock()}>
          {t("wallet.unlockAnother")}
        </Button>
      </div>
      <p className="mt-4 text-sm text-muted-foreground">{t("wallet.syncHint")}</p>
      {status && <p className="mt-2 text-sm text-destructive">{status}</p>}
    </WalletFrame>
  );
}

function WalletEmpty({ onOpened }: { onOpened: () => void }) {
  const { t } = useLocale();
  const supported = webAuthnSupported();
  const [status, setStatus] = useState<string | null>(null);
  const [unlocking, setUnlocking] = useState(false);

  const unlock = async () => {
    setUnlocking(true);
    setStatus(t("wallet.sendSigning"));
    try {
      await unlockWalletWithPasskey();
      onOpened();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setUnlocking(false);
    }
  };

  return (
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
            <CardTitle className="text-base">{t("wallet.unlockSectionTitle")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Button type="button" variant="outline" disabled={!supported || unlocking} onClick={() => void unlock()}>
              {t("wallet.unlock")}
            </Button>
            <p className="text-xs text-muted-foreground">{t("wallet.unlockHint")}</p>
            <p className="text-xs text-muted-foreground">{t("wallet.pairFromOtherHint")}</p>
          </CardContent>
        </Card>
      </div>
      {status && <p className="mt-4 text-sm text-destructive">{status}</p>}
    </WalletFrame>
  );
}

export function HomePage() {
  const [session, setSession] = useState(() => loadWalletSession());
  const registry = listWalletRegistry();

  const refresh = useCallback(() => setSession(loadWalletSession()), []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  if (session) return <WalletDashboard session={session} />;
  if (registry.length > 0) return <WalletPicker registry={registry} onOpened={refresh} />;
  return <WalletEmpty onOpened={refresh} />;
}
