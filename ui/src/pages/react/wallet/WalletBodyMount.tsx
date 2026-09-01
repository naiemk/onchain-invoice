import { useEffect, useRef } from "react";
import type { WalletRenderOptions } from "@/shared/wallet-ui.js";

type LegacyRenderer = (root: HTMLElement, opts?: WalletRenderOptions) => void | Promise<void>;

/** Strip wallet chrome duplicated by React WalletFrame after a full legacy render. */
function stripLegacyWalletChrome(container: HTMLElement): void {
  container.querySelector(".wallet-account-bar")?.remove();
  container.querySelector(".wallet-subnav-row")?.remove();
  container.querySelector(".wallet-panel-title")?.remove();
  container.querySelector(".wallet-panel-lede")?.remove();
  container.querySelector(".page-header.wallet-page-header")?.remove();

  const panel = container.querySelector(".wallet-panel, .wallet-panel-unlocked, .wallet-panel-empty");
  if (panel && panel.parentElement === container) {
    container.innerHTML = panel.innerHTML;
    return;
  }
  if (panel) {
    const body = document.createElement("div");
    body.innerHTML = panel.innerHTML;
    container.innerHTML = "";
    while (body.firstChild) container.appendChild(body.firstChild);
  }
}

/** Mount legacy wallet page body during React migration. */
export function WalletBodyMount({ render }: { render: LegacyRenderer }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.innerHTML = "";
    const mount = document.createElement("div");
    el.appendChild(mount);

    void Promise.resolve(render(mount, { frameless: true })).then(() => {
      if (!el.isConnected) return;
      stripLegacyWalletChrome(mount);
      el.innerHTML = mount.innerHTML;
    });

    return () => {
      el.innerHTML = "";
    };
  }, [render]);

  return <div ref={ref} className="wallet-legacy-body legacy-page" />;
}
