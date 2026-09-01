import { useEffect, useRef } from "react";
import type { WalletRenderOptions } from "@/shared/wallet-ui.js";

type LegacyRenderer = (root: HTMLElement, opts?: WalletRenderOptions) => void | Promise<void>;

/**
 * Remove React-duplicated chrome without destroying event listeners.
 * Never clone via innerHTML — that drops addEventListener bindings.
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
  if (!panel || panel.parentElement !== container) return;

  const children = Array.from(panel.childNodes);
  container.replaceChildren(...children);
}

/**
 * Mount legacy wallet page body during React migration.
 * Render into the host node so click handlers that query `root` still see the live form
 * (a nested mount + move left `#admin-email` / `#enable-advanced` on a detached tree).
 */
export function WalletBodyMount({ render }: { render: LegacyRenderer }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.replaceChildren();

    let cancelled = false;
    void Promise.resolve(render(el, { frameless: true }))
      .then(() => {
        if (cancelled || !el.isConnected) return;
        stripLegacyWalletChrome(el);
      })
      .catch((error: unknown) => {
        if (cancelled || !el.isConnected) return;
        const message = error instanceof Error ? error.message : String(error);
        el.replaceChildren();
        const p = document.createElement("p");
        p.className = "status wallet-status error";
        p.setAttribute("role", "status");
        p.textContent = message;
        el.appendChild(p);
      });

    return () => {
      cancelled = true;
      el.replaceChildren();
    };
  }, [render]);

  return <div ref={ref} className="wallet-legacy-body legacy-page" />;
}
