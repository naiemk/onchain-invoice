import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function PageHero({
  breadcrumb,
  title,
  lede,
  aside,
  className,
  children,
}: {
  breadcrumb?: string;
  title: ReactNode;
  lede?: ReactNode;
  aside?: ReactNode;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <header className={cn("mb-8 space-y-4", className)}>
      <div className={cn(aside && "grid gap-6 lg:grid-cols-[1fr_auto] lg:items-start")}>
        <div className="space-y-2">
          {breadcrumb && (
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-emphasis">{breadcrumb}</p>
          )}
          <h1 className="text-3xl font-semibold leading-tight tracking-tight md:text-4xl">{title}</h1>
          {lede && <p className="max-w-2xl text-base text-muted-foreground md:text-lg">{lede}</p>}
        </div>
        {aside}
      </div>
      {children}
    </header>
  );
}
