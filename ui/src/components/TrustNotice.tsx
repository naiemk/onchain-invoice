import { Shield } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

export function TrustNotice({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "flex items-start gap-3 rounded-xl border border-border bg-card px-4 py-3 text-sm text-muted-foreground",
        className
      )}
    >
      <Shield className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
      <p>{children}</p>
    </div>
  );
}
