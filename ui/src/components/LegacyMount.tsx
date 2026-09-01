import { useEffect, useRef } from "react";

type LegacyRenderer = (root: HTMLElement) => void | Promise<void>;

/** Mount legacy vanilla page renderers during incremental React migration. */
export function LegacyMount({ render }: { render: LegacyRenderer }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.innerHTML = "";
    void render(el);
  }, [render]);

  return <div ref={ref} className="legacy-page" />;
}
