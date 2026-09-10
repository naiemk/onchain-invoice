import { useEffect, useRef, type MutableRefObject } from "react";
import { mountTurnstile } from "@/shared/turnstile.js";

export type TurnstileControl = {
  getToken: () => string | null;
  reset: () => void;
  destroy?: () => void;
};

export function TurnstileWidget({
  siteKey,
  onTokenChange,
  controlRef,
  className,
}: {
  siteKey: string | null | undefined;
  onTokenChange?: (ready: boolean) => void;
  controlRef: MutableRefObject<TurnstileControl | null>;
  className?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const onTokenChangeRef = useRef(onTokenChange);
  onTokenChangeRef.current = onTokenChange;

  useEffect(() => {
    const notify = (ready: boolean) => onTokenChangeRef.current?.(ready);
    if (!siteKey || !containerRef.current) {
      notify(true);
      controlRef.current = null;
      return;
    }
    notify(false);
    let cancelled = false;
    const container = containerRef.current;
    void mountTurnstile(container, siteKey, {
      onToken: (token) => {
        if (!cancelled) notify(Boolean(token));
      },
    }).then((ctl) => {
      if (cancelled) {
        ctl?.destroy();
        return;
      }
      controlRef.current = ctl;
    });
    return () => {
      cancelled = true;
      controlRef.current?.destroy?.();
      controlRef.current = null;
    };
  }, [siteKey, controlRef]);

  if (!siteKey) return null;
  return (
    <div
      ref={containerRef}
      data-testid="turnstile-widget"
      className={className ?? "flex justify-center py-4"}
    />
  );
}
