import { useEffect, useRef } from "react";
import { mountTurnstile } from "@/shared/turnstile.js";

export type TurnstileControl = {
  getToken: () => string | null;
  reset: () => void;
};

export function TurnstileWidget({
  siteKey,
  onTokenChange,
  controlRef,
}: {
  siteKey: string | null | undefined;
  onTokenChange: (ready: boolean) => void;
  controlRef: React.MutableRefObject<TurnstileControl | null>;
}) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!siteKey || !containerRef.current) {
      onTokenChange(true);
      controlRef.current = null;
      return;
    }
    onTokenChange(false);
    let cancelled = false;
    const container = containerRef.current;
    void mountTurnstile(container, siteKey, {
      onToken: (token) => {
        if (!cancelled) onTokenChange(Boolean(token));
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
      controlRef.current?.destroy();
      controlRef.current = null;
    };
  }, [siteKey, onTokenChange, controlRef]);

  if (!siteKey) return null;
  return <div ref={containerRef} data-testid="turnstile-widget" className="flex justify-center" />;
}
