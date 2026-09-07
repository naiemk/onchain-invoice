import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Contract, JsonRpcProvider } from "ethers";
import { Mail, Shield } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useLocale } from "@/providers/LocaleProvider";
import { renderWalletRecover } from "@/pages/wallet/recover.js";
import { PageCard, PageSplit } from "@/components/PageSplit";
import { TrustNotice } from "@/components/TrustNotice";
import { fetchWalletEmail } from "@/shared/wallet-recovery-api.js";
import { fetchWalletConfig, primaryChain } from "@/shared/wallet-api.js";
import { isAdvancedMode } from "@/shared/wallet-mode.js";
import { loadWalletSession } from "@/shared/wallet-session.js";
import { WalletFrame } from "./WalletFrame";
import { WalletBodyMount } from "./WalletBodyMount";
import { useWalletPolicy } from "./wallet-policy";
import { DevicesCard } from "./DevicesCard";
import type { AdvancedPolicy } from "@/shared/wallet-advanced-api.js";

const PENDING_OWNER_ABI = [
  "function pendingOwner() view returns (bytes32 qx, bytes32 qy, uint64 executableAt, bytes32 requestId, bool active)",
];

function EmailStatusCard() {
  const { t } = useLocale();
  const session = loadWalletSession();
  const [status, setStatus] = useState<"loading" | "none" | "pending" | "verified">("loading");
  const [email, setEmail] = useState<string | null>(null);

  useEffect(() => {
    if (!session) return;
    void (async () => {
      try {
        const result = await fetchWalletEmail(session.address);
        if (result.verified && result.email) {
          setStatus("verified");
          setEmail(result.email);
        } else if (result.hasEmail && result.email) {
          setStatus("pending");
          setEmail(result.email);
        } else {
          setStatus("none");
        }
      } catch {
        setStatus("none");
      }
    })();
  }, [session]);

  if (status === "loading") return null;

  if (status === "verified" && email) {
    return (
      <Alert className="mb-4 border-ok/30 bg-ok/5">
        <Mail className="h-4 w-4" />
        <AlertDescription>{t("wallet.recoverEmailVerified", { email })}</AlertDescription>
      </Alert>
    );
  }

  if (status === "pending" && email) {
    return (
      <Alert variant="warn" className="mb-4">
        <Mail className="h-4 w-4" />
        <AlertDescription>{t("wallet.recoverEmailPending", { email })}</AlertDescription>
      </Alert>
    );
  }

  return (
    <Alert className="mb-4 border-primary/30 bg-primary/5">
      <Mail className="h-4 w-4" />
      <AlertDescription className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <span>{t("wallet.emailAttachHint")}</span>
        <Button asChild size="sm" variant="secondary">
          <a href="#recovery">{t("wallet.emailAttachCta")}</a>
        </Button>
      </AlertDescription>
    </Alert>
  );
}

function SuperWalletPolicyCard({ policy }: { policy: AdvancedPolicy }) {
  const { t } = useLocale();
  return (
    <Alert className="mb-4" data-testid="super-wallet-policy-card">
      <Shield className="h-4 w-4" />
      <AlertDescription className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <span>
          <span className="font-medium">{t("wallet.superWalletPolicyTitle")}. </span>
          {t("wallet.superWalletSecuritySigners", {
            threshold: String(policy.threshold),
            count: String(policy.entityCount),
          })}
        </span>
        <Button asChild size="sm" variant="secondary">
          <Link to="/wallet/access">{t("wallet.details")}</Link>
        </Button>
      </AlertDescription>
    </Alert>
  );
}

function PendingRecoveryBanner({ address }: { address: string }) {
  const { t } = useLocale();
  const [pending, setPending] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const config = await fetchWalletConfig();
        const chain = primaryChain(config);
        if (!chain.rpcUrl) return;
        const provider = new JsonRpcProvider(chain.rpcUrl);
        const wallet = new Contract(address, PENDING_OWNER_ABI, provider);
        const active = Boolean((await wallet.pendingOwner()).active);
        if (!cancelled) setPending(active);
      } catch {
        if (!cancelled) setPending(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [address]);

  if (!pending) return null;

  return (
    <Alert variant="warn">
      <AlertDescription className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <span>{t("wallet.pendingRecovery")}</span>
        <Button asChild size="sm" variant="secondary">
          <a href="#recovery">{t("wallet.recoverOpen")}</a>
        </Button>
      </AlertDescription>
    </Alert>
  );
}

function ConvertCallout() {
  const { t } = useLocale();
  return (
    <Alert>
      <Shield className="h-4 w-4" />
      <AlertDescription className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <span>
          <span className="font-medium">{t("wallet.superWalletTitle")}. </span>
          {t("wallet.superWalletUpgradeShort")}
        </span>
        <Button asChild size="sm">
          <Link to="/wallet/super-wallet">{t("wallet.superWalletConvertCta")}</Link>
        </Button>
      </AlertDescription>
    </Alert>
  );
}

export function SecurityPage() {
  const { t } = useLocale();
  const { isSuperWallet, policy } = useWalletPolicy();
  const session = loadWalletSession();

  return (
    <WalletFrame
      current="security"
      title={t("wallet.securityPageTitle")}
      lede={isSuperWallet ? t("wallet.securityPageLedeSuper") : t("wallet.securityPageLede")}
    >
      {isSuperWallet && policy?.advanced ? <SuperWalletPolicyCard policy={policy} /> : null}
      {!isSuperWallet && <EmailStatusCard />}
      <PageSplit>
        <div className="space-y-6">
          {!isSuperWallet && session ? <PendingRecoveryBanner address={session.address} /> : null}
          {isAdvancedMode() && !isSuperWallet ? <ConvertCallout /> : null}
          {session ? <DevicesCard session={session} advanced={isSuperWallet} /> : null}
          {!isSuperWallet && (
            <PageCard>
              <section id="recovery" className="scroll-mt-24">
                <h2 className="mb-4 text-base font-semibold">{t("wallet.recoverPageTitle")}</h2>
                <WalletBodyMount render={renderWalletRecover} />
              </section>
            </PageCard>
          )}
        </div>
        <PageCard>
          {isSuperWallet ? (
            <>
              <h2 className="text-base font-semibold">{t("wallet.superWalletSecurityAsideTitle")}</h2>
              <p className="mt-2 text-sm text-muted-foreground">{t("wallet.superWalletSecurityAsideBody")}</p>
              <Button asChild size="sm" variant="outline" className="mt-4">
                <Link to="/wallet/access">{t("wallet.details")}</Link>
              </Button>
            </>
          ) : (
            <>
              <h2 className="text-base font-semibold">{t("wallet.recoveryMethodsTitle")}</h2>
              <p className="mt-2 text-sm text-muted-foreground">{t("wallet.recoveryMethodsHint")}</p>
              <TrustNotice className="mt-6 border-0 bg-muted/40 p-0">
                {t("wallet.securityDelayNotice")}
              </TrustNotice>
            </>
          )}
        </PageCard>
      </PageSplit>
    </WalletFrame>
  );
}
