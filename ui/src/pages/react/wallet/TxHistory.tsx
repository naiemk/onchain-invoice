import { useEffect, useState } from "react";
import { formatUnits } from "ethers";
import { ExplorerLink } from "@/components/ExplorerLink";
import { StatusBadge } from "@/components/StatusBadge";
import { useLocale } from "@/providers/LocaleProvider";
import { fetchWalletTransfers } from "@/shared/wallet-api.js";
import { shortAddress } from "@/shared/wallet-session.js";
import type { WalletTransferRecord } from "../../../../../commerce/shared/wallet.js";

export function TxHistory({
  wallet,
  chainId,
  refreshKey = 0,
}: {
  wallet: string;
  chainId?: string;
  refreshKey?: number;
}) {
  const { t, locale } = useLocale();
  const [rows, setRows] = useState<WalletTransferRecord[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const data = await fetchWalletTransfers(wallet, chainId);
        if (!cancelled) setRows(data.transfers);
      } catch {
        if (!cancelled) setRows((prev) => prev ?? []);
      }
    };
    void load();
    const timer = window.setTimeout(() => void load(), 2500);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [wallet, chainId, refreshKey]);

  return (
    <section className="rounded-xl border border-border bg-card p-5 shadow-sm md:p-6">
      <h2 className="mb-3 text-sm font-semibold">{t("wallet.txHistoryTitle")}</h2>
      {rows === null ? (
        <p className="text-sm text-muted-foreground">{t("wallet.txHistoryLoading")}</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("wallet.txHistoryEmpty")}</p>
      ) : (
        <ul className="divide-y">
          {rows.map((row) => {
            const inbound = row.direction === "in";
            let amount = row.amount;
            try {
              amount = formatUnits(row.amount, row.tokenDecimals);
            } catch {
              /* keep atoms */
            }
            return (
              <li key={row.id} className="flex items-center justify-between gap-3 py-3">
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge tone={inbound ? "verified" : "pending"}>
                      {inbound ? t("wallet.txHistoryIn") : t("wallet.txHistoryOut")}
                    </StatusBadge>
                    <span className="font-medium">
                      {inbound ? "+" : "−"}
                      {amount} {row.tokenSymbol}
                    </span>
                  </div>
                  <p className="font-mono text-xs text-muted-foreground">
                    {shortAddress(row.counterparty)}
                    {row.createdAt ? (
                      <span className="ml-2 font-sans">
                        {new Date(row.createdAt).toLocaleString(locale)}
                      </span>
                    ) : null}
                  </p>
                </div>
                <ExplorerLink chainId={row.chainId} value={row.txHash} kind="tx" />
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
