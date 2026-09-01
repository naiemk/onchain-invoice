import { useEffect, useRef } from "react";
import type { WalletRenderOptions } from "@/shared/wallet-ui.js";

type LegacyRenderer = (root: HTMLElement, opts?: WalletRenderOptions) => void | Promise<void>;

/**
 * Remove React-duplicated chrome without destroying event listeners.
 * Move live nodes — never assign innerHTML from another tree.
 */
function stripLegacyWalletChrome(container: HTMLElement): void {
  for (const sel of [
    ".wallet-account-bar",
    ".wallet-subnav-row",
    ".wallet-panel-title",
    ".wallet-panel-lede",
    ".page-header.wallet-page-header",
  ]) {
    container.querySelector(sel)?.remove();
  }

  const panel = container.querySelector(".wallet-panel, .wallet-panel-unlocked, .wallet-panel-empty");
  if (!panel) return;

  const children = Array.from(panel.childNodes);
  container.replaceChildren(...children);
}

/** Mount legacy wallet page body during React migration (preserves bound listeners). */
export function WalletBodyMount({ render }: { render: LegacyRenderer }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.replaceChildren();
    const mount = document.createElement("div");
    el.appendChild(mount);

    let cancelled = false;
    void Promise.resolve(render(mount, { frameless: true })).then(() => {
      if (cancelled || !el.isConnected) return;
      stripLegacyWalletChrome(mount);
      // Keep the same DOM nodes that received addEventListener
      el.replaceChildren(...Array.from(mount.childNodes));
    });

    return () => {
      cancelled = true;
      el.replaceChildren();
    };
  }, [render]);

  return <div ref={ref} className="wallet-legacy-body legacy-page" />;
}
