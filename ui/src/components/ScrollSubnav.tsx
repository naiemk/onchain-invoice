import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";

export function ScrollSubnav({
  items,
  current,
  label,
  className,
}: {
  items: Array<{ href: string; key: string; label: string }>;
  current: string;
  label: string;
  className?: string;
}) {
  return (
    <nav
      aria-label={label}
      className={cn(
        "-mx-1 flex gap-0.5 overflow-x-auto px-1 pb-2 [scrollbar-width:thin]",
        className
      )}
    >
      {items.map((item) =>
        item.key === current ? (
          <span
            key={item.href}
            aria-current="page"
            className="shrink-0 rounded-md bg-muted px-2.5 py-1 text-xs font-medium text-foreground"
          >
            {item.label}
          </span>
        ) : (
          <Link
            key={item.href}
            to={item.href}
            className="shrink-0 rounded-md px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
          >
            {item.label}
          </Link>
        )
      )}
    </nav>
  );
}
