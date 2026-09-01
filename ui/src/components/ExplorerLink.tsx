import { ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";
import { useLocale } from "@/providers/LocaleProvider";
import { explorerAddressUrl, explorerTxUrl } from "@/shared/networks.js";

type ExplorerLinkProps = {
  chainId: string | null | undefined;
  value: string;
  kind?: "address" | "tx";
  className?: string;
};

/** Small external-link icon opening the chain explorer for an address or tx hash. */
export function ExplorerLink({ chainId, value, kind = "address", className }: ExplorerLinkProps) {
  const { t } = useLocale();
  const href =
    kind === "tx" ? explorerTxUrl(chainId, value) : explorerAddressUrl(chainId, value);
  if (!href) return null;

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded p-0.5 text-muted-foreground transition-colors hover:text-primary",
        className
      )}
      aria-label={kind === "tx" ? t("wallet.viewTxExplorer") : t("wallet.viewAddressExplorer")}
      title={kind === "tx" ? t("wallet.viewTxExplorer") : t("wallet.viewAddressExplorer")}
    >
      <ExternalLink className="h-3.5 w-3.5" />
    </a>
  );
}
