import { Link, useLocation, useNavigate } from "react-router-dom";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Check, ChevronDown, Copy, Lock, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { useLocale } from "@/providers/LocaleProvider";
import { copyText } from "@/shared/dom.js";
import {
  clearActiveWallet,
  listWalletRegistry,
  loadWalletSession,
  setActiveWallet,
  shortAddress,
  type WalletSession,
} from "@/shared/wallet-session.js";
import { isAdvancedMode, loadWalletMode, saveWalletMode, type WalletMode } from "@/shared/wallet-mode.js";
import type { WalletTab } from "@/shared/wallet-ui.js";

const IDENT_PALETTE = [
  { h: 211, s: 78, l: 44 },
  { h: 168, s: 56, l: 32 },
  { h: 28, s: 82, l: 44 },
  { h: 338, s: 62, l: 44 },
  { h: 262, s: 48, l: 48 },
  { h: 145, s: 46, l: 34 },
  { h: 198, s: 64, l: 38 },
  { h: 12, s: 70, l: 46 },
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
      className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white"
      style={{ backgroundColor: `hsl(${h} ${s}% ${l}%)` }}
      aria-hidden
    >
      {labelInitials(session.label)}
    </span>
  );
}

function WalletAccountBar({
  session,
  registry,
  onSessionChange,
}: {
  session: WalletSession;
  registry: WalletSession[];
  onSessionChange: () => void;
}) {
  const { t } = useLocale();
  const navigate = useNavigate();
  const location = useLocation();
  const [copied, setCopied] = useState(false);
  const multiple = registry.length > 1;

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

  const switchWallet = useCallback(
    (addr: string) => {
      if (addr.toLowerCase() === session.address.toLowerCase()) return;
      if (setActiveWallet(addr)) {
        onSessionChange();
        navigate(location.pathname + location.search, { replace: true });
      }
    },
    [session.address, onSessionChange, navigate, location.pathname, location.search]
  );

  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b pb-4">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        {multiple ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="h-auto gap-2 px-2 py-1.5">
                <WalletIdenticon session={session} />
                <span className="font-medium">{session.label}</span>
                <ChevronDown className="h-4 w-4 opacity-60" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-64">
              <DropdownMenuLabel>{t("wallet.walletsOnDevice")}</DropdownMenuLabel>
              {registry.map((w) => {
                const active = w.address.toLowerCase() === session.address.toLowerCase();
                return (
                  <DropdownMenuItem key={w.address} onClick={() => switchWallet(w.address)} className="gap-2">
                    <WalletIdenticon session={w} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium">{w.label}</div>
                      <div className="truncate font-mono text-xs text-muted-foreground">{shortAddress(w.address)}</div>
                    </div>
                    {active && <Check className="h-4 w-4 shrink-0 text-primary" />}
                  </DropdownMenuItem>
                );
              })}
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild>
                <Link to="/wallet/create" className="gap-2">
                  <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-muted">
                    <Plus className="h-4 w-4" />
                  </span>
                  {t("wallet.createAnother")}
                </Link>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <div className="flex items-center gap-2 px-2 py-1.5">
            <WalletIdenticon session={session} />
            <span className="font-medium">{session.label}</span>
          </div>
        )}
        <Button variant="ghost" size="sm" className="font-mono text-xs" onClick={() => void copyAddress()}>
          {shortAddress(session.address)}
          {copied ? <Check className="ml-1 h-3.5 w-3.5 text-ok" /> : <Copy className="ml-1 h-3.5 w-3.5 opacity-60" />}
        </Button>
        <span className="sr-only" aria-live="polite">
          {copied ? t("wallet.addressCopied") : ""}
        </span>
      </div>
      <Button variant="outline" size="sm" onClick={lock}>
        <Lock className="mr-1.5 h-3.5 w-3.5" />
        {t("wallet.signOut")}
      </Button>
    </div>
  );
}

function WalletModeToggle() {
  const { t } = useLocale();
  const navigate = useNavigate();
  const location = useLocation();
  const [mode, setMode] = useState<WalletMode>(() => loadWalletMode());

  const selectMode = (next: WalletMode) => {
    saveWalletMode(next);
    setMode(next);
    navigate(location.pathname + location.search, { replace: true });
  };

  return (
    <div className="inline-flex rounded-lg border bg-muted p-0.5" role="group" aria-label={t("wallet.modeLabel")}>
      {(["simple", "advanced"] as const).map((m) => (
        <button
          key={m}
          type="button"
          onClick={() => selectMode(m)}
          className={cn(
            "rounded-md px-3 py-1 text-sm font-medium transition-colors",
            mode === m ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
          )}
        >
          {m === "simple" ? t("wallet.modeSimple") : t("wallet.modeAdvanced")}
        </button>
      ))}
    </div>
  );
}

function WalletSubnav({ current }: { current: WalletTab }) {
  const { t } = useLocale();
  const session = loadWalletSession();
  const advanced = isAdvancedMode();

  const links = useMemo(() => {
    const items: Array<{ href: string; key: WalletTab; label: string }> = [
      { href: "/wallet", key: "home", label: t("wallet.homeTab") },
      { href: "/wallet/get-paid", key: "getPaid", label: t("wallet.getPaidTab") },
      { href: "/wallet/send", key: "send", label: t("wallet.payTab") },
      { href: "/wallet/cash", key: "cash", label: t("wallet.cashTab") },
      { href: "/wallet/security", key: "security", label: t("wallet.securityTab") },
    ];
    if (advanced) {
      items.push(
        { href: "/wallet/super-wallet", key: "superWallet", label: t("wallet.superWalletTab") },
        { href: "/merchant", key: "invoices", label: t("wallet.invoicesTab") },
        { href: "/wallet/recover", key: "recover", label: t("wallet.recoverTab") },
        { href: "/wallet/developers", key: "developers", label: t("wallet.developersTab") }
      );
    } else if (session || current === "recover") {
      items.push({ href: "/wallet/recover", key: "recover", label: t("wallet.recoverTab") });
    }
    return items;
  }, [t, advanced, session, current]);

  return (
    <nav className="mb-6 flex flex-wrap gap-1 border-b pb-1" aria-label={t("wallet.navLabel")}>
      {links.map((l) =>
        l.key === current ? (
          <span
            key={l.href}
            aria-current="page"
            className="rounded-md px-3 py-1.5 text-sm font-medium text-foreground"
          >
            {l.label}
          </span>
        ) : (
          <Link
            key={l.href}
            to={l.href}
            className="rounded-md px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            {l.label}
          </Link>
        )
      )}
    </nav>
  );
}

export function WalletFrame({
  current,
  title,
  lede,
  children,
  showChrome = true,
}: {
  current: WalletTab;
  title?: string;
  lede?: string;
  children: ReactNode;
  /** When false, skip account bar + subnav (empty/picker states). */
  showChrome?: boolean;
}) {
  const { t } = useLocale();
  const [session, setSession] = useState<WalletSession | null>(() => loadWalletSession());
  const registry = useMemo(() => listWalletRegistry(), [session]);

  useEffect(() => {
    setSession(loadWalletSession());
  }, [current]);

  const refreshSession = useCallback(() => setSession(loadWalletSession()), []);

  if (!showChrome || !session) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-8 md:px-8">
        {!session && title && (
          <header className="mb-8 space-y-2">
            <p className="text-sm font-medium uppercase tracking-wider text-primary">{t("wallet.eyebrow")}</p>
            <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
            {lede && <p className="text-lg text-muted-foreground">{lede}</p>}
          </header>
        )}
        <Card className="p-6">{children}</Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 md:px-8">
      <Card className="p-6">
        <WalletAccountBar session={session} registry={registry} onSessionChange={refreshSession} />
        <div className="mb-6 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <WalletModeToggle />
          <WalletSubnav current={current} />
        </div>
        {title && <h1 className="mb-2 text-2xl font-semibold tracking-tight">{title}</h1>}
        {lede && <p className="mb-6 text-muted-foreground">{lede}</p>}
        {children}
      </Card>
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
