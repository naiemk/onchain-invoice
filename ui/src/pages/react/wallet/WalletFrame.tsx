import { Link, useLocation, useNavigate } from "react-router-dom";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Check, ChevronDown, Copy, Lock, Plus, Vault } from "lucide-react";
import { LocaleSelect, useWalletAppMenu } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { PageHero } from "@/components/PageHero";
import { ExplorerLink } from "@/components/ExplorerLink";
import { WalletAddressQrDialog } from "@/components/WalletAddressQrDialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { useLocale } from "@/providers/LocaleProvider";
import { copyText } from "@/shared/dom.js";
import { deploymentMode, isTestnet } from "@/shared/networks.js";
import {
  clearActiveWallet,
  listWalletRegistryForDeployment,
  loadWalletSession,
  setActiveWallet,
  shortAddress,
  walletSessionsEquivalent,
  WALLET_SESSION_EVENT,
  type WalletSession,
} from "@/shared/wallet-session.js";
import { isAdvancedMode, loadWalletMode, saveWalletMode, type WalletMode } from "@/shared/wallet-mode.js";
import type { WalletTab } from "@/shared/wallet-ui.js";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useWalletPolicy } from "./wallet-policy";

const IDENT_PALETTE = [
  { h: 168, s: 56, l: 32 },
  { h: 175, s: 45, l: 28 },
  { h: 28, s: 82, l: 44 },
  { h: 145, s: 46, l: 34 },
  { h: 198, s: 64, l: 38 },
] as const;

function labelInitials(label: string): string {
  const parts = label.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0]![0] ?? ""}${parts[1]![0] ?? ""}`.toUpperCase();
  return (parts[0] ?? "?").slice(0, 2).toUpperCase();
}

function addressPalette(address: string): (typeof IDENT_PALETTE)[number] {
  const hex = address.replace(/^0x/i, "");
  let n = 0;
  for (let i = 0; i < hex.length; i++) {
    n = (n * 33 + parseInt(hex[i] ?? "0", 16)) >>> 0;
  }
  return IDENT_PALETTE[n % IDENT_PALETTE.length]!;
}

function WalletIdenticon({ session }: { session: WalletSession }) {
  const { h, s, l } = addressPalette(session.address);
  return (
    <span
      className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-white"
      style={{ backgroundColor: `hsl(${h} ${s}% ${l}%)` }}
      aria-hidden
    >
      {labelInitials(session.label)}
    </span>
  );
}

function WalletSwitcher({
  session,
  registry,
  onSessionChange,
  onNavigate,
}: {
  session: WalletSession | null;
  registry: WalletSession[];
  onSessionChange: () => void;
  onNavigate?: () => void;
}) {
  const { t } = useLocale();
  const navigate = useNavigate();

  const lock = useCallback(() => {
    clearActiveWallet();
    onSessionChange();
    onNavigate?.();
    navigate("/wallet", { replace: true });
  }, [navigate, onSessionChange, onNavigate]);

  const switchWallet = useCallback(
    (addr: string) => {
      if (session && addr.toLowerCase() === session.address.toLowerCase()) return;
      if (setActiveWallet(addr)) {
        onSessionChange();
        onNavigate?.();
        navigate("/wallet", { replace: true });
      }
    },
    [session, onSessionChange, onNavigate, navigate]
  );

  const go = useCallback(
    (href: string) => {
      onNavigate?.();
      navigate(href);
    },
    [navigate, onNavigate]
  );

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="h-9 w-full justify-start gap-2 px-2">
          {session ? (
            <>
              <WalletIdenticon session={session} />
              <span className="min-w-0 truncate text-sm">{session.label}</span>
            </>
          ) : (
            <span className="min-w-0 truncate text-sm">{t("wallet.allWallets")}</span>
          )}
          <ChevronDown className="ms-auto h-3.5 w-3.5 shrink-0 opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuLabel>{t("wallet.switchWallet")}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {session
          ? registry.map((w) => (
              <DropdownMenuItem key={w.address} onClick={() => switchWallet(w.address)}>
                {w.label}
                <span className="ms-auto font-mono text-[10px] text-muted-foreground">{shortAddress(w.address)}</span>
              </DropdownMenuItem>
            ))
          : null}
        <DropdownMenuItem
          onClick={() => {
            if (session) lock();
            else go("/wallet");
          }}
        >
          {t("wallet.allWallets")}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => go("/wallet/create")}>
          <Plus className="h-3.5 w-3.5" />
          {t("wallet.createAnother")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function WalletInfoBar({
  session,
  onSessionChange,
  isSuperWallet,
}: {
  session: WalletSession;
  onSessionChange: () => void;
  isSuperWallet: boolean;
}) {
  const { t } = useLocale();
  const navigate = useNavigate();
  const [copied, setCopied] = useState(false);

  const copyAddress = useCallback(async () => {
    try {
      await copyText(session.address);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      /* ignore */
    }
  }, [session.address]);

  const lock = useCallback(() => {
    clearActiveWallet();
    onSessionChange();
    navigate("/wallet", { replace: true });
  }, [navigate, onSessionChange]);

  return (
    <div
      data-testid="wallet-info-bar"
      className="mb-4 flex flex-nowrap items-center gap-0.5 overflow-x-auto [scrollbar-width:thin]"
    >
      <Button type="button" variant="outline" size="sm" className="h-8 shrink-0 font-mono text-[10px]" onClick={() => void copyAddress()}>
        {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
        {shortAddress(session.address)}
      </Button>
      <WalletAddressQrDialog address={session.address} />
      <ExplorerLink chainId={session.chainId} value={session.address} className="h-8 w-8 shrink-0 rounded-md border border-border" />
      {isSuperWallet && (
        <Tooltip>
          <TooltipTrigger asChild>
            <span
              data-testid="super-wallet-shield"
              className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border text-primary"
              tabIndex={0}
            >
              <Vault className="h-4 w-4" />
              <span className="sr-only">{t("wallet.superWalletShieldTooltip")}</span>
            </span>
          </TooltipTrigger>
          <TooltipContent>{t("wallet.superWalletShieldTooltip")}</TooltipContent>
        </Tooltip>
      )}
      <Button type="button" variant="ghost" size="icon" className="h-8 w-8 shrink-0" aria-label={t("wallet.lock")} onClick={lock}>
        <Lock className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

function WalletModeToggle() {
  const { t } = useLocale();
  const navigate = useNavigate();
  const location = useLocation();
  const [mode, setMode] = useState<WalletMode>(() => loadWalletMode());

  return (
    <div className="inline-flex w-full rounded-full border border-border p-0.5" role="group" aria-label={t("wallet.modeLabel")}>
      {(["simple", "advanced"] as const).map((m) => (
        <button
          key={m}
          type="button"
          className={cn(
            "flex-1 rounded-full px-3 py-1 text-xs font-medium transition-colors",
            mode === m ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
          )}
          onClick={() => {
            saveWalletMode(m);
            setMode(m);
            navigate(location.pathname + location.search, { replace: true });
          }}
        >
          {m === "simple" ? t("wallet.modeSimple") : t("wallet.modeAdvanced")}
        </button>
      ))}
    </div>
  );
}

function useWalletNavLinks(): Array<{ href: string; key: string; label: string }> {
  const { t } = useLocale();
  const { isSuperWallet } = useWalletPolicy();
  const advanced = isAdvancedMode();

  return useMemo(() => {
    const items: Array<{ href: string; key: string; label: string }> = [
      { href: "/wallet", key: "home", label: t("wallet.homeTab") },
      { href: "/wallet/get-paid", key: "getPaid", label: t("wallet.getPaidTab") },
      { href: "/wallet/send", key: "send", label: t("wallet.payTab") },
      { href: "/wallet/cash", key: "cash", label: t("wallet.cashTab") },
    ];
    items.push({ href: "/wallet/security", key: "security", label: t("wallet.securityTab") });
    if (isSuperWallet) {
      items.push(
        { href: "/wallet/access", key: "access", label: t("wallet.accessTab") },
        { href: "/wallet/invoices", key: "invoices", label: t("wallet.invoicesTab") }
      );
    } else if (advanced) {
      items.push(
        { href: "/wallet/super-wallet", key: "superWallet", label: t("wallet.superWalletTab") },
        { href: "/wallet/invoices", key: "invoices", label: t("wallet.invoicesTab") }
      );
    }
    return items;
  }, [t, advanced, isSuperWallet]);
}

function WalletNavLinks({ current, onNavigate }: { current: WalletTab; onNavigate?: () => void }) {
  const { t } = useLocale();
  const links = useWalletNavLinks();

  return (
    <nav aria-label={t("wallet.navLabel")} className="flex flex-col gap-0.5">
      {links.map((item) =>
        item.key === current ? (
          <span
            key={item.href}
            aria-current="page"
            className="rounded-md bg-muted px-3 py-2 text-sm font-medium text-foreground"
          >
            {item.label}
          </span>
        ) : (
          <Link
            key={item.href}
            to={item.href}
            onClick={onNavigate}
            className="rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
          >
            {item.label}
          </Link>
        )
      )}
    </nav>
  );
}

function WalletAppMenu({
  session,
  registry,
  current,
  onSessionChange,
  isSuperWallet,
  onNavigate,
}: {
  session: WalletSession | null;
  registry: WalletSession[];
  current: WalletTab;
  onSessionChange: () => void;
  isSuperWallet: boolean;
  onNavigate?: () => void;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <WalletSwitcher session={session} registry={registry} onSessionChange={onSessionChange} onNavigate={onNavigate} />
      <WalletNavLinks current={current} onNavigate={onNavigate} />
      {!isSuperWallet && (
        <div className="mt-auto">
          <WalletModeToggle />
        </div>
      )}
    </div>
  );
}

const TAB_BREADCRUMBS: Partial<Record<WalletTab, string>> = {
  home: "WALLET",
  send: "WALLET / SEND",
  receive: "WALLET / RECEIVE",
  cash: "WALLET / CASH RAILS",
  security: "WALLET / SECURITY",
  create: "NEW WALLET",
  recover: "WALLET / RECOVERY",
  superWallet: "WALLET / SUPER WALLET",
  proposals: "WALLET / PROPOSALS",
  getPaid: "WALLET / GET PAID",
  developers: "WALLET / DEVELOPERS",
  invoices: "WALLET / INVOICES",
  access: "WALLET / TEAM",
};

export function WalletFrame({
  current,
  title,
  lede,
  children,
  showChrome = true,
  breadcrumb,
}: {
  current: WalletTab;
  title?: string;
  lede?: string;
  children: ReactNode;
  showChrome?: boolean;
  breadcrumb?: string;
}) {
  const { t } = useLocale();
  const { isSuperWallet } = useWalletPolicy();
  const appMenu = useWalletAppMenu();
  const [session, setSession] = useState<WalletSession | null>(() => loadWalletSession());
  const mode = deploymentMode();
  const registry = useMemo(
    () => listWalletRegistryForDeployment(isTestnet, mode === "testnet"),
    [session?.address]
  );

  const refreshSession = useCallback(() => {
    setSession((prev) => {
      const next = loadWalletSession();
      if (!prev || !next) return next;
      return walletSessionsEquivalent(prev, next) ? prev : next;
    });
  }, []);

  useEffect(() => {
    refreshSession();
  }, [current, refreshSession]);

  useEffect(() => {
    const handler = () => refreshSession();
    window.addEventListener(WALLET_SESSION_EVENT, handler);
    return () => window.removeEventListener(WALLET_SESSION_EVENT, handler);
  }, [refreshSession]);

  const crumb = breadcrumb ?? TAB_BREADCRUMBS[current] ?? t("wallet.eyebrow");
  const showTestnetWarning = mode === "testnet" || (session != null && isTestnet(session.chainId));
  const unlocked = Boolean(showChrome && session);
  const closeMobile = useCallback(() => appMenu?.setMobileOpen(false), [appMenu]);

  const menu = (
    <WalletAppMenu
      session={session}
      registry={registry}
      current={current}
      onSessionChange={refreshSession}
      isSuperWallet={isSuperWallet}
      onNavigate={closeMobile}
    />
  );

  return (
    <div className="flex min-h-0 flex-1">
      <aside
        data-testid="wallet-app-sidebar"
        className="sticky top-14 hidden h-[calc(100vh-3.5rem)] w-56 shrink-0 flex-col border-r bg-background p-4 md:!flex"
      >
        {menu}
      </aside>
      {appMenu && (
        <Sheet open={appMenu.mobileOpen} onOpenChange={appMenu.setMobileOpen}>
          <SheetContent side="right" className="flex w-[280px] flex-col md:!hidden">
            <SheetHeader>
              <SheetTitle>{t("brand")}</SheetTitle>
            </SheetHeader>
            <div className="mt-6 flex min-h-0 flex-1 flex-col">{menu}</div>
            <div className="mt-6">
              <LocaleSelect />
            </div>
          </SheetContent>
        </Sheet>
      )}
      <div className="min-w-0 flex-1 px-4 py-6 md:px-8">
        <div className={cn("mx-auto", unlocked ? "max-w-5xl" : "max-w-3xl")}>
          {unlocked && showTestnetWarning && (
            <Alert variant="destructive" className="mb-4 border-destructive bg-destructive/10">
              <AlertDescription className="font-medium">{t("wallet.testnetAddressWarning")}</AlertDescription>
            </Alert>
          )}
          {unlocked && session && (
            <WalletInfoBar session={session} onSessionChange={refreshSession} isSuperWallet={isSuperWallet} />
          )}
          {title && <PageHero breadcrumb={crumb} title={title} lede={lede} className="mb-4" />}
          {unlocked ? children : <div className="rounded-xl border border-border bg-card p-5 shadow-sm md:p-6">{children}</div>}
        </div>
      </div>
    </div>
  );
}

export function useRequireWalletSession(): WalletSession | null {
  const session = loadWalletSession();
  const navigate = useNavigate();
  useEffect(() => {
    if (!session) navigate("/wallet", { replace: true });
  }, [session, navigate]);
  return session;
}

export type { WalletTab };
