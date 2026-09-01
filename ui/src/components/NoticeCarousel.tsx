import { useCallback, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useLocale } from "@/providers/LocaleProvider";

export type NoticeItem = {
  id: string;
  title: string;
  description: string;
  href: string;
  cta?: string;
  className?: string;
};

const DISMISS_KEY = "tc.walletNotices";

function loadDismissed(): Set<string> {
  try {
    const raw = localStorage.getItem(DISMISS_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as string[];
    return new Set(Array.isArray(parsed) ? parsed : []);
  } catch {
    return new Set();
  }
}

function saveDismissed(ids: Set<string>): void {
  localStorage.setItem(DISMISS_KEY, JSON.stringify([...ids]));
}

/** Single-card swipeable notice carousel with dismiss persistence. */
export function NoticeCarousel({ items }: { items: NoticeItem[] }) {
  const { t } = useLocale();
  const [dismissed, setDismissed] = useState<Set<string>>(() => loadDismissed());
  const visible = useMemo(() => items.filter((i) => !dismissed.has(i.id)), [items, dismissed]);
  const [index, setIndex] = useState(0);

  const current = visible[index % visible.length] ?? null;
  const count = visible.length;

  const dismiss = useCallback(
    (id: string) => {
      setDismissed((prev) => {
        const next = new Set(prev);
        next.add(id);
        saveDismissed(next);
        return next;
      });
      setIndex(0);
    },
    []
  );

  const prev = useCallback(() => {
    if (count <= 1) return;
    setIndex((i) => (i - 1 + count) % count);
  }, [count]);

  const next = useCallback(() => {
    if (count <= 1) return;
    setIndex((i) => (i + 1) % count);
  }, [count]);

  if (!current || count === 0) return null;

  return (
    <NoticeCard
      item={current}
      index={index}
      count={count}
      onDismiss={() => dismiss(current.id)}
      onPrev={prev}
      onNext={next}
      dismissLabel={t("wallet.noticeDismiss")}
      prevLabel={t("wallet.noticePrev")}
      nextLabel={t("wallet.noticeNext")}
    />
  );
}

function NoticeCard({
  item,
  index,
  count,
  onDismiss,
  onPrev,
  onNext,
  dismissLabel,
  prevLabel,
  nextLabel,
}: {
  item: NoticeItem;
  index: number;
  count: number;
  onDismiss: () => void;
  onPrev: () => void;
  onNext: () => void;
  dismissLabel: string;
  prevLabel: string;
  nextLabel: string;
}) {
  const [touchStart, setTouchStart] = useState<number | null>(null);

  const handleTouchStart = (e: React.TouchEvent) => {
    setTouchStart(e.touches[0]?.clientX ?? null);
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (touchStart == null) return;
    const end = e.changedTouches[0]?.clientX ?? touchStart;
    const delta = end - touchStart;
    if (Math.abs(delta) > 48) {
      if (delta < 0) onNext();
      else onPrev();
    }
    setTouchStart(null);
  };

  return (
    <div
      className={cn(
        "relative rounded-lg border border-border bg-card p-4 shadow-sm",
        item.className
      )}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      <div className="flex items-start justify-between gap-3">
        <Link to={item.href} className="min-w-0 flex-1 no-underline hover:no-underline">
          <p className="text-sm font-semibold text-foreground">{item.title}</p>
          <p className="mt-1 text-sm text-muted-foreground">{item.description}</p>
          {item.cta && (
            <span className="mt-2 inline-block text-xs font-medium text-primary">{item.cta}</span>
          )}
        </Link>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-7 w-7 shrink-0"
          aria-label={dismissLabel}
          onClick={onDismiss}
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>
      {count > 1 && (
        <div className="mt-3 flex items-center justify-between gap-2">
          <Button type="button" variant="ghost" size="icon" className="h-7 w-7" aria-label={prevLabel} onClick={onPrev}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-xs text-muted-foreground">
            {(index % count) + 1} / {count}
          </span>
          <Button type="button" variant="ghost" size="icon" className="h-7 w-7" aria-label={nextLabel} onClick={onNext}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      )}
    </div>
  );
}
