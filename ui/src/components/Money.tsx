import { cn } from "@/lib/utils";

/** Large monetary amount — Source Serif 4 only. */
export function Money({
  amount,
  currency = "USD",
  className,
  size = "md",
}: {
  amount: string;
  currency?: string;
  className?: string;
  size?: "sm" | "md" | "lg";
}) {
  return (
    <span
      className={cn(
        "font-display font-semibold tracking-tight text-foreground",
        size === "sm" && "text-xl",
        size === "md" && "text-3xl",
        size === "lg" && "text-4xl md:text-5xl",
        className
      )}
    >
      {amount}
      {currency ? (
        <span className="ms-1.5 font-sans text-sm font-normal text-muted-foreground">{currency}</span>
      ) : null}
    </span>
  );
}
