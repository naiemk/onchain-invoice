import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { copyText } from "@/shared/dom.js";

export function AddressBox({
  address,
  className,
  copyLabel = "Copy",
}: {
  address: string;
  className?: string;
  copyLabel?: string;
}) {
  const [copied, setCopied] = useState(false);

  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-2",
        className
      )}
    >
      <code className="min-w-0 flex-1 truncate font-mono text-xs text-foreground">{address}</code>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="shrink-0"
        onClick={async () => {
          await copyText(address);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1400);
        }}
      >
        {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
        {copyLabel}
      </Button>
    </div>
  );
}
