import { cn } from "@/lib/utils";

export function Stepper({
  steps,
  current,
  onSelect,
  className,
}: {
  steps: Array<{ id: number; label: string; hidden?: boolean }>;
  current: number;
  onSelect?: (id: number) => void;
  className?: string;
}) {
  const visible = steps.filter((s) => !s.hidden);
  return (
    <ol className={cn("flex flex-wrap gap-1", className)} aria-label="Steps">
      {visible.map((step, index) => {
        const active = step.id === current;
        const done = step.id < current;
        return (
          <li key={step.id}>
            <button
              type="button"
              disabled={!onSelect || (!done && !active)}
              onClick={() => onSelect?.(step.id)}
              className={cn(
                "inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-colors",
                active && "bg-primary text-primary-foreground",
                done && !active && "bg-muted text-foreground hover:bg-muted/80",
                !active && !done && "bg-transparent text-muted-foreground"
              )}
            >
              <span className="opacity-70">{index + 1}</span>
              {step.label}
            </button>
          </li>
        );
      })}
    </ol>
  );
}
