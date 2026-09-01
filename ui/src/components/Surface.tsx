import { cn } from "@/lib/utils";
import type { HTMLAttributes, ReactNode } from "react";

/** Quiet bordered panel — default product surface. */
export function Surface({
  className,
  children,
  ...props
}: HTMLAttributes<HTMLDivElement> & { children: ReactNode }) {
  return (
    <div
      className={cn("rounded-lg border border-border bg-card text-card-foreground", className)}
      {...props}
    >
      {children}
    </div>
  );
}

/** Elevated brand band for marketing/trust sections — readable in both themes. */
export function Band({
  className,
  children,
  ...props
}: HTMLAttributes<HTMLDivElement> & { children: ReactNode }) {
  return (
    <div
      className={cn(
        "rounded-xl border border-border/60 bg-brand-panel px-6 py-8 text-brand-panel-foreground",
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
}
