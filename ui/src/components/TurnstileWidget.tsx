import { useEffect, useRef, type MutableRefObject } from "react";
import { mountTurnstile } from "@/shared/turnstile.js";

export type TurnstileControl = {
  getToken: () => string | null;
  reset: () => void;
  destroy?: () => void;
};

export function readCaptchaToken(controlRef: MutableRefObject<TurnstileControl | null>): string | null {
  try {
    return controlRef.current?.getToken() ?? null;
  } catch {
    return null;
  }
}

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
    if (!siteKey) {
      notify(true);
      controlRef.current = null;
      return;
    }

    let cancelled = false;
    const abort = new AbortController();
    let frame = 0;

    // Defer past React Strict Mode's sync mount→cleanup→remount so the first
    // (discarded) effect never calls turnstile.render.
    frame = requestAnimationFrame(() => {
      const container = containerRef.current;
      if (cancelled || !container) {
        notify(true);
        return;
      }
      notify(false);
      void mountTurnstile(container, siteKey, {
        signal: abort.signal,
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
    });

    return () => {
      cancelled = true;
      abort.abort();
      cancelAnimationFrame(frame);
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
