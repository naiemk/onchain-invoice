import { useLocation, useNavigate } from "react-router-dom";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Check, ChevronDown, Copy, Lock, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Surface } from "@/components/Surface";
import { ScrollSubnav } from "@/components/ScrollSubnav";
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
      className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-white"
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
        navigate("/wallet", { replace: true });
      }
    },
    [session.address, onSessionChange, navigate]
  );

  return (
    <div className="mb-4 flex items-center gap-2 border-b border-border pb-3">
      {multiple ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="h-8 gap-2 px-1.5">
              <WalletIdenticon session={session} />
              <span className="max-w-[8rem] truncate text-sm">{session.label}</span>
              <ChevronDown className="h-3.5 w-3.5 opacity-60" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-56">
            <DropdownMenuLabel>{t("wallet.switchWallet")}</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {registry.map((w) => (
              <DropdownMenuItem key={w.address} onClick={() => switchWallet(w.address)}>
                {w.label}
                <span className="ms-auto font-mono text-[10px] text-muted-foreground">{shortAddress(w.address)}</span>
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => navigate("/wallet/create")}>
              <Plus className="h-3.5 w-3.5" />
              {t("wallet.createAnother")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : (
        <div className="flex items-center gap-2 px-1">
          <WalletIdenticon session={session} />
          <span className="text-sm font-medium">{session.label}</span>
        </div>
      )}
      <Button type="button" variant="outline" size="sm" className="ms-auto font-mono text-[10px]" onClick={() => void copyAddress()}>
        {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
        {shortAddress(session.address)}
      </Button>
      <Button type="button" variant="ghost" size="icon" aria-label={t("wallet.lock")} onClick={lock}>
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
    <div className="inline-flex rounded-md border border-border p-0.5" role="group" aria-label={t("wallet.modeLabel")}>
      {(["simple", "advanced"] as const).map((m) => (
        <button
          key={m}
          type="button"
          className={cn(
            "rounded px-2 py-1 text-xs font-medium transition-colors",
            mode === m ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground"
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

function WalletSubnav({ current }: { current: WalletTab }) {
  const { t } = useLocale();
  const session = loadWalletSession();
  const advanced = isAdvancedMode();

  const links = useMemo(() => {
    const items: Array<{ href: string; key: string; label: string }> = [
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

  return <ScrollSubnav items={links} current={current} label={t("wallet.navLabel")} className="mb-4 border-b border-border" />;
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
      <div className="mx-auto max-w-2xl px-4 py-8 md:px-6">
        {!session && title && (
          <header className="mb-6 space-y-1.5">
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{t("wallet.eyebrow")}</p>
            <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
            {lede && <p className="text-sm text-muted-foreground">{lede}</p>}
          </header>
        )}
        <Surface className="p-5">{children}</Surface>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 md:px-6">
      <Surface className="p-4 sm:p-5">
        <WalletAccountBar session={session} registry={registry} onSessionChange={refreshSession} />
        <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <WalletModeToggle />
          <WalletSubnav current={current} />
        </div>
        {title && <h1 className="mb-1 text-xl font-semibold tracking-tight">{title}</h1>}
        {lede && <p className="mb-4 text-sm text-muted-foreground">{lede}</p>}
        {children}
      </Surface>
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
