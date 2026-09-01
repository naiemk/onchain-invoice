import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function PageSplit({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn("grid gap-6 lg:grid-cols-2 lg:items-start", className)}>
      {children}
    </div>
  );
}

export function PageCard({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn("rounded-xl border border-border bg-card p-5 shadow-sm md:p-6", className)}>
      {children}
    </div>
  );
}
