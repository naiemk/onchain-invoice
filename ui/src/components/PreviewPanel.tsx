import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

export function PreviewPanel({
  label = "LIVE PREVIEW",
  tag,
  className,
  children,
}: {
  label?: string;
  tag?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn("rounded-xl bg-brand-panel p-5 text-brand-panel-foreground md:p-6", className)}>
      <div className="mb-4 flex items-center justify-between gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-brand-panel-foreground/70">
          {label}
        </span>
        {tag && (
          <span className="rounded-full border border-brand-panel-foreground/20 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide">
            {tag}
          </span>
        )}
      </div>
      {children}
    </div>
  );
}
