import { useEffect } from "react";
import { Routes, Route, useLocation, useNavigate } from "react-router-dom";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";
import { AppShell } from "@/components/AppShell";
import { LocaleProvider, useLocale } from "@/providers/LocaleProvider";
import { ThemeProvider } from "@/providers/ThemeProvider";
import { currentPayChromeFromLocation } from "@/shared/pay-chrome.js";
import { HomePage } from "@/pages/react/HomePage";
import { GetPaidPage } from "@/pages/react/GetPaidPage";
import { SecurityPage } from "@/pages/react/SecurityPage";
import { IntegrationsPage } from "@/pages/react/IntegrationsPage";
import { CreatePage } from "@/pages/react/CreatePage";
import { PayPage } from "@/pages/react/PayPage";
import { MerchantPage } from "@/pages/react/MerchantPage";
import { DevelopersPage } from "@/pages/react/DevelopersPage";
import { AdminPage } from "@/pages/react/AdminPage";
import { GuardianPage } from "@/pages/react/GuardianPage";
import { WalletRouter } from "@/pages/react/wallet/WalletRouter";
import { LegalHubPage, LegalPage } from "@/pages/react/LegalPage";
import type { MessageKey } from "@/i18n/t.js";

function usePageMeta() {
  const location = useLocation();
  const { t } = useLocale();

  useEffect(() => {
    const pathname = location.pathname;
    const key = pathname.startsWith("/merchant") ? "/merchant" : pathname;
    const meta = pageMeta(key, t);
    document.title = meta.title;
    const desc = document.querySelector('meta[name="description"]');
    if (desc) desc.setAttribute("content", meta.description);
  }, [location.pathname, t]);
}

function pageMeta(path: string, t: (key: MessageKey) => string): { title: string; description: string } {
  switch (path) {
    case "/get-paid":
      return { title: t("meta.getPaidTitle"), description: t("meta.getPaidDescription") };
    case "/security":
      return { title: t("meta.securityTitle"), description: t("meta.securityDescription") };
    case "/create":
      return { title: t("meta.createTitle"), description: t("meta.createDescription") };
    case "/pay":
      return { title: t("meta.payTitle"), description: t("meta.payDescription") };
    case "/merchant":
      return { title: t("meta.merchantTitle"), description: t("meta.merchantDescription") };
    case "/integrations":
      return { title: t("meta.integrationsTitle"), description: t("meta.integrationsDescription") };
    case "/admin":
      return { title: t("meta.adminTitle"), description: t("meta.adminDescription") };
    case "/guardian":
      return { title: t("meta.guardianTitle"), description: t("meta.guardianDescription") };
    case "/legal":
      return { title: t("meta.legalTitle"), description: t("meta.legalDescription") };
    case "/terms":
      return { title: t("meta.termsTitle"), description: t("meta.termsDescription") };
    case "/privacy":
      return { title: t("meta.privacyTitle"), description: t("meta.privacyDescription") };
    case "/cookies":
      return { title: t("meta.cookiesTitle"), description: t("meta.cookiesDescription") };
    case "/risks":
      return { title: t("meta.risksTitle"), description: t("meta.risksDescription") };
    case "/security-checks":
      return { title: t("meta.securityChecksTitle"), description: t("meta.securityChecksDescription") };
    default:
      if (path.startsWith("/wallet")) {
        return { title: t("meta.walletTitle"), description: t("meta.walletDescription") };
      }
      return { title: t("meta.homeTitle"), description: t("meta.homeDescription") };
  }
}

/** Bridge legacy `data-route` anchor clicks to React Router. */
function useLegacyRouteBridge() {
  const navigate = useNavigate();
  useEffect(() => {
    const handler = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      const link = target?.closest("a[data-route]") as HTMLAnchorElement | null;
      if (!link) return;
      event.preventDefault();
      navigate(link.getAttribute("href") ?? "/");
    };
    document.addEventListener("click", handler);
    return () => document.removeEventListener("click", handler);
  }, [navigate]);
}

function useFocusMainOnNavigate() {
  const location = useLocation();
  useEffect(() => {
    document.getElementById("main-content")?.focus();
  }, [location.pathname]);
}

function useHashScroll() {
  const location = useLocation();
  useEffect(() => {
    if (!location.hash) return;
    const id = location.hash.slice(1);
    requestAnimationFrame(() => {
      document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }, [location.pathname, location.hash]);
}

function AppRoutes() {
  const location = useLocation();
  usePageMeta();
  useLegacyRouteBridge();
  useFocusMainOnNavigate();
  useHashScroll();

  const chrome = location.pathname === "/pay" ? currentPayChromeFromLocation() : "full";

  return (
    <AppShell chrome={chrome}>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/get-paid" element={<GetPaidPage />} />
        <Route path="/security" element={<SecurityPage />} />
        <Route path="/integrations" element={<IntegrationsPage />} />
        <Route path="/create" element={<CreatePage />} />
        <Route path="/pay" element={<PayPage />} />
        <Route path="/merchant" element={<MerchantPage />} />
        <Route path="/merchant/*" element={<MerchantPage />} />
        <Route path="/developers" element={<DevelopersPage />} />
        <Route path="/admin" element={<AdminPage />} />
        <Route path="/guardian" element={<GuardianPage />} />
        <Route path="/legal" element={<LegalHubPage />} />
        <Route path="/terms" element={<LegalPage docId="terms" />} />
        <Route path="/privacy" element={<LegalPage docId="privacy" />} />
        <Route path="/cookies" element={<LegalPage docId="cookies" />} />
        <Route path="/risks" element={<LegalPage docId="risks" />} />
        <Route path="/security-checks" element={<LegalPage docId="security-checks" />} />
        <Route path="/wallet/*" element={<WalletRouter />} />
        <Route path="*" element={<HomePage />} />
      </Routes>
    </AppShell>
  );
}

export function App() {
  return (
    <ThemeProvider>
      <LocaleProvider>
        <TooltipProvider>
          <AppRoutes />
          <Toaster />
        </TooltipProvider>
      </LocaleProvider>
    </ThemeProvider>
  );
}
