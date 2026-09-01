import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export type StatusTone = "active" | "verified" | "available" | "connected" | "pending" | "muted";

const toneClass: Record<StatusTone, string> = {
  active: "bg-ok/15 text-ok border-transparent",
  verified: "bg-ok/15 text-ok border-transparent",
  connected: "bg-primary text-primary-foreground border-transparent",
  available: "bg-secondary text-secondary-foreground border-transparent",
  pending: "bg-warn/15 text-warn border-transparent",
  muted: "bg-muted text-muted-foreground border-transparent",
};

export function StatusBadge({
  tone,
  children,
  className,
}: {
  tone: StatusTone;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Badge variant="outline" className={cn("rounded-full font-medium", toneClass[tone], className)}>
      {children}
    </Badge>
  );
}
