import { Link, useLocation, useNavigate } from "react-router-dom";
import { ArrowUpRight, Menu, Moon, Sun } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useLocale } from "@/providers/LocaleProvider";
import { useTheme } from "@/providers/ThemeProvider";
import { LOCALES, LOCALE_NATIVE_NAMES, type Locale } from "@/i18n/locales.js";
import { SITE } from "@/shared/site.js";
import type { PayChrome } from "@/shared/pay-chrome.js";
import { deploymentMode } from "@/shared/networks.js";
import { cn } from "@/lib/utils";

const NAV_LINKS = [
  { href: "/wallet", labelKey: "nav.wallet" as const },
  { href: "/get-paid", labelKey: "nav.getPaid" as const },
  { href: "/integrations", labelKey: "nav.integrations" as const },
  { href: "/developers", labelKey: "nav.developers" as const },
  { href: "/security", labelKey: "nav.security" as const },
];

function isActive(pathname: string, href: string): boolean {
  if (pathname === href) return true;
  if (href !== "/" && pathname.startsWith(href)) return true;
  if (href === "/get-paid" && (pathname.startsWith("/create") || pathname.startsWith("/merchant"))) return true;
  if (href === "/developers" && pathname.startsWith("/developers")) return true;
  if (href === "/wallet" && pathname.startsWith("/wallet")) return true;
  return false;
}

function NavLinks({ pathname, t, onNavigate }: { pathname: string; t: (k: string) => string; onNavigate?: () => void }) {
  return (
    <>
      {NAV_LINKS.map(({ href, labelKey }) => (
        <Link
          key={href}
          to={href}
          onClick={onNavigate}
          aria-current={isActive(pathname, href) ? "page" : undefined}
          className={cn(
            "text-sm font-medium transition-colors hover:text-foreground",
            isActive(pathname, href) ? "text-primary underline decoration-primary/40 underline-offset-4" : "text-muted-foreground"
          )}
        >
          {t(labelKey)}
        </Link>
      ))}
      <a
        href={SITE.docsUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        {t("nav.docs")}
      </a>
    </>
  );
}

function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  const { t } = useLocale();
  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={() => toggleTheme()}
      aria-pressed={theme === "dark"}
      aria-label={theme === "dark" ? t("theme.switchToLight") : t("theme.switchToDark")}
      title={theme === "dark" ? t("theme.switchToLight") : t("theme.switchToDark")}
    >
      {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </Button>
  );
}

function LocaleSelect() {
  const { locale, setLocaleAndApply, t } = useLocale();
  return (
    <Select value={locale} onValueChange={(v) => setLocaleAndApply(v as Locale)}>
      <SelectTrigger className="h-9 w-[130px]" aria-label={t("locale.label")}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {LOCALES.map((loc) => (
          <SelectItem key={loc} value={loc}>
            {LOCALE_NATIVE_NAMES[loc]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function BrandLink() {
  const { t } = useLocale();
  return (
    <Link to="/" className="flex items-center gap-2.5 font-semibold text-foreground no-underline hover:no-underline">
      <img src="/logo.svg" alt="" width={32} height={32} className="rounded-md" />
      <span>{t("brand")}</span>
    </Link>
  );
}

function FooterEnvLine() {
  const { t } = useLocale();
  const mode = deploymentMode();
  return (
    <span className="text-xs text-muted-foreground">
      {mode === "testnet" ? t("common.testnet") : t("common.mainnet")} · {t("footer.settlementLine")}
    </span>
  );
}

function OpenWorkspaceButton({
  className,
  onAfterNavigate,
}: {
  className?: string;
  onAfterNavigate?: () => void;
}) {
  const { t } = useLocale();
  const navigate = useNavigate();
  const location = useLocation();

  const openWorkspace = () => {
    onAfterNavigate?.();
    const onWalletHome = location.pathname === "/wallet";
    if (onWalletHome) {
      window.scrollTo({ top: 0, behavior: "smooth" });
      document.getElementById("main-content")?.focus();
      return;
    }
    navigate("/wallet");
  };

  return (
    <Button type="button" size="sm" className={className} onClick={openWorkspace}>
      {t("nav.openWorkspace")}
      <ArrowUpRight className="h-3.5 w-3.5" />
    </Button>
  );
}

function FullFooter() {
  const { t } = useLocale();
  return (
    <footer className="border-t bg-background/80 px-4 py-8 text-sm text-muted-foreground md:px-8">
      <div className="mx-auto flex max-w-6xl flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <span className="font-medium text-foreground">{t("brand")}</span>
        <FooterEnvLine />
        <div className="flex flex-wrap gap-x-3 gap-y-1 sm:justify-end">
          <a href={SITE.docsUrl} target="_blank" rel="noopener noreferrer" className="hover:text-foreground">
            {t("nav.docs")}
          </a>
          <span aria-hidden="true">·</span>
          <Link to="/developers" className="hover:text-foreground">
            {t("nav.developers")}
          </Link>
          <span aria-hidden="true">·</span>
          <a href={SITE.agentSkillUrl} rel="alternate noopener noreferrer" target="_blank" className="hover:text-foreground">
            {t("nav.aiSkill")}
          </a>
          <span aria-hidden="true">·</span>
          <a href={SITE.githubUrl} target="_blank" rel="noopener noreferrer" className="hover:text-foreground">
            {t("nav.github")}
          </a>
          <span aria-hidden="true">·</span>
          <a href={SITE.telegramChannel} target="_blank" rel="noopener noreferrer" className="hover:text-foreground">
            {t("nav.telegram")}
          </a>
          <span aria-hidden="true">·</span>
          <a href={SITE.telegramSupport} target="_blank" rel="noopener noreferrer" className="hover:text-foreground">
            {t("nav.support")}
          </a>
        </div>
      </div>
    </footer>
  );
}

export function AppShell({ chrome, children }: { chrome: PayChrome; children: React.ReactNode }) {
  const location = useLocation();
  const { t } = useLocale();
  const [mobileOpen, setMobileOpen] = useState(false);

  if (chrome === "none") {
    return <main className="min-h-screen">{children}</main>;
  }

  const minimal = chrome === "minimal";

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-40 border-b bg-background/90 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-4 px-4 md:px-8">
          <BrandLink />
          {!minimal && (
            <>
              <div
                data-app-nav
                role="navigation"
                aria-label="Main"
                className="ml-auto flex flex-1 items-center justify-center gap-6 max-md:!hidden"
              >
                <NavLinks pathname={location.pathname} t={t} />
              </div>
              <div data-app-nav className="flex items-center gap-2 max-md:!hidden">
                <LocaleSelect />
                <ThemeToggle />
                <OpenWorkspaceButton className="ms-1" />
              </div>
              <div data-app-nav-mobile className="ml-auto flex items-center gap-2 md:!hidden">
                <ThemeToggle />
                <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
                  <SheetTrigger asChild>
                    <Button variant="ghost" size="icon" aria-label="Menu">
                      <Menu className="h-5 w-5" />
                    </Button>
                  </SheetTrigger>
                  <SheetContent side="right" className="w-[280px]">
                    <SheetHeader>
                      <SheetTitle>{t("brand")}</SheetTitle>
                    </SheetHeader>
                    <div role="navigation" className="mt-6 flex flex-col gap-4">
                      <NavLinks pathname={location.pathname} t={t} onNavigate={() => setMobileOpen(false)} />
                    </div>
                    <div className="mt-6 space-y-4">
                      <LocaleSelect />
                      <OpenWorkspaceButton className="w-full" onAfterNavigate={() => setMobileOpen(false)} />
                    </div>
                  </SheetContent>
                </Sheet>
              </div>
            </>
          )}
          {minimal && (
            <div className="flex items-center gap-2">
              <LocaleSelect />
              <ThemeToggle />
            </div>
          )}
        </div>
      </header>
      <main id="main-content" tabIndex={-1} className="flex-1 outline-none">
        {children}
      </main>
      {minimal ? (
        <footer className="border-t px-4 py-4 text-sm text-muted-foreground">
          <div className="mx-auto flex max-w-6xl justify-between">
            <span>{t("brand")}</span>
            <a href={SITE.docsUrl} target="_blank" rel="noopener noreferrer" className="hover:text-foreground">
              {t("nav.docs")}
            </a>
          </div>
        </footer>
      ) : (
        <FullFooter />
      )}
    </div>
  );
}
