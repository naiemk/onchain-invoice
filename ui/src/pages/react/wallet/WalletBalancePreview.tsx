import { ExplorerLink } from "@/components/ExplorerLink";
import { cn } from "@/lib/utils";
import { useLocale } from "@/providers/LocaleProvider";
import { shortAddress } from "@/shared/wallet-session.js";
import type { WalletBalanceChain } from "../../../../../commerce/shared/wallet.js";

export function ChainBalanceList({
  chains,
}: {
  chains: WalletBalanceChain[];
}) {
  const { t } = useLocale();
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

export type WalletPreviewItem = {
  address: string;
  label: string;
  chainId?: string;
  balanceUsd?: string | null;
};

export function WalletBalancePreview({
  wallets,
  selectedAddress,
  interactive = false,
  onSelect,
}: {
  wallets: WalletPreviewItem[];
  selectedAddress?: string | null;
  interactive?: boolean;
  onSelect?: (address: string) => void;
}) {
  const { t } = useLocale();
  if (!wallets.length) {
    return <p className="text-sm text-muted-foreground">{t("wallet.recoverNoWalletsForEmail")}</p>;
  }
  return (
    <ul className="space-y-2">
      {wallets.map((w) => {
        const selected = selectedAddress?.toLowerCase() === w.address.toLowerCase();
        const content = (
          <>
            <div>
              <h3 className="font-medium">{w.label}</h3>
              <p className="flex items-center gap-1 font-mono text-sm text-muted-foreground">
                {shortAddress(w.address)}
                {w.chainId ? <ExplorerLink chainId={w.chainId} value={w.address} /> : null}
              </p>
            </div>
            <p className="text-sm">
              {w.balanceUsd != null ? `${w.balanceUsd} ${t("wallet.usd")}` : t("wallet.balanceUnavailableShort")}
            </p>
          </>
        );
        if (!interactive) {
          return (
            <li key={w.address} className="flex items-center justify-between gap-4 rounded-lg border p-4">
              {content}
            </li>
          );
        }
        return (
          <li key={w.address}>
            <button
              type="button"
              onClick={() => onSelect?.(w.address)}
              className={cn(
                "flex w-full items-center justify-between gap-4 rounded-lg border p-4 text-left transition-colors",
                selected ? "border-emphasis bg-muted/40" : "hover:border-primary/40"
              )}
            >
              {content}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
