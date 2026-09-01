import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

/** Whole-tile hit target — never nest Button inside Link. */
export function ActionTile({
  href,
  title,
  description,
  cta,
  icon,
  className,
}: {
  href: string;
  title: string;
  description?: string;
  cta?: string;
  icon?: ReactNode;
  className?: string;
}) {
  return (
    <Link
      to={href}
      className={cn(
        "group flex flex-col gap-2 rounded-lg border border-border bg-card p-4 text-left transition-colors hover:border-primary/40 hover:bg-muted/40",
        className
      )}
    >
      {icon && <div className="text-primary">{icon}</div>}
      <div className="text-sm font-semibold text-foreground">{title}</div>
      {description && <p className="text-sm text-muted-foreground">{description}</p>}
      {cta && (
        <span className="mt-auto pt-2 text-xs font-medium text-primary group-hover:underline">{cta}</span>
      )}
    </Link>
  );
}
