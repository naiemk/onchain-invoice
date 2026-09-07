import { useEffect, useState } from "react";
import { Check, Copy } from "lucide-react";
import { Contract, JsonRpcProvider, getAddress } from "ethers";
import { Button } from "@/components/ui/button";
import { PageCard } from "@/components/PageSplit";
import { ExplorerLink } from "@/components/ExplorerLink";
import { StatusBadge } from "@/components/StatusBadge";
import { useLocale } from "@/providers/LocaleProvider";
import { copyText } from "@/shared/dom.js";
import { fetchWalletConfig, primaryChain } from "@/shared/wallet-api.js";
import type { WalletPublicConfig } from "../../../commerce/shared/wallet.js";

const FACTORY_ABI = [
  "function walletImplementation() view returns (address)",
  "function recoveryImpl() view returns (address)",
];

type OnChainRefs = {
  implementation: string | null;
  recovery: string | null;
};

function sameAddr(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  try {
    return getAddress(a) === getAddress(b);
  } catch {
    return a.toLowerCase() === b.toLowerCase();
  }
}

function ContractRow({
  label,
  address,
  chainId,
  onChain,
  matchLabel,
  mismatchLabel,
}: {
  label: string;
  address: string | null;
  chainId: string;
  onChain?: string | null;
  matchLabel: string;
  mismatchLabel: string;
}) {
  const { t } = useLocale();
  const [copied, setCopied] = useState(false);
  if (!address) return null;

  const compared = Boolean(onChain);
  const matches = compared && sameAddr(address, onChain);

  const copy = async () => {
    try {
      await copyText(address);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      /* ignore */
    }
  };

  return (
    <li className="border-b border-border py-3 last:border-b-0 last:pb-0">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-medium">{label}</span>
        {compared ? (
          <StatusBadge tone={matches ? "verified" : "pending"}>{matches ? matchLabel : mismatchLabel}</StatusBadge>
        ) : null}
      </div>
      <div className="mt-1 flex min-w-0 items-center gap-1">
        <code className="min-w-0 flex-1 truncate font-mono text-xs" dir="ltr" title={address}>
          {address}
        </code>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-7 w-7 shrink-0"
          onClick={() => void copy()}
          aria-label={t("wallet.copyAddress")}
        >
          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
        </Button>
        <ExplorerLink chainId={chainId} value={address} />
      </div>
      {compared && onChain && !matches ? (
        <p className="mt-1 font-mono text-[11px] text-muted-foreground" dir="ltr">
          {t("securityPage.contractsOnChain")}: {onChain}
        </p>
      ) : null}
    </li>
  );
}

export function WalletContractsCard() {
  const { t } = useLocale();
  const [config, setConfig] = useState<WalletPublicConfig | null>(null);
  const [onChain, setOnChain] = useState<OnChainRefs | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const cfg = await fetchWalletConfig();
        if (cancelled) return;
        setConfig(cfg);
        const chain = primaryChain(cfg);
        if (!cfg.factoryAddress || !chain.rpcUrl) {
          setOnChain(null);
          return;
        }
        try {
          const provider = new JsonRpcProvider(chain.rpcUrl);
          const factory = new Contract(cfg.factoryAddress, FACTORY_ABI, provider);
          const [implementation, recovery] = await Promise.all([
            factory.walletImplementation() as Promise<string>,
            factory.recoveryImpl() as Promise<string>,
          ]);
          if (cancelled) return;
          setOnChain({ implementation, recovery });
        } catch {
          if (!cancelled) setOnChain(null);
        }
      } catch {
        if (!cancelled) setError(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const chainId = config ? primaryChain(config).chainId : "";
  const configured = Boolean(config?.factoryAddress || config?.implementationAddress);

  return (
    <PageCard className="mt-8" data-testid="wallet-contracts-card">
      <h2 className="text-lg font-semibold">{t("securityPage.contractsTitle")}</h2>
      <p className="mt-2 text-sm text-muted-foreground">{t("securityPage.contractsLede")}</p>
      {error || (config && !configured) ? (
        <p className="mt-4 text-sm text-muted-foreground">{t("securityPage.contractsUnavailable")}</p>
      ) : config ? (
        <ul className="mt-4">
          <ContractRow
            label={t("securityPage.contractsFactory")}
            address={config.factoryAddress}
            chainId={chainId}
            matchLabel={t("securityPage.contractsMatch")}
            mismatchLabel={t("securityPage.contractsMismatch")}
          />
          <ContractRow
            label={t("securityPage.contractsImplementation")}
            address={config.implementationAddress}
            chainId={chainId}
            onChain={onChain?.implementation}
            matchLabel={t("securityPage.contractsMatch")}
            mismatchLabel={t("securityPage.contractsMismatch")}
          />
          <ContractRow
            label={t("securityPage.contractsRecovery")}
            address={config.recoveryAddress}
            chainId={chainId}
            onChain={onChain?.recovery}
            matchLabel={t("securityPage.contractsMatch")}
            mismatchLabel={t("securityPage.contractsMismatch")}
          />
          <ContractRow
            label={t("securityPage.contractsEntryPoint")}
            address={config.entryPointAddress}
            chainId={chainId}
            matchLabel={t("securityPage.contractsMatch")}
            mismatchLabel={t("securityPage.contractsMismatch")}
          />
        </ul>
      ) : null}
    </PageCard>
  );
}
