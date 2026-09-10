import { createRoot, type Root } from "react-dom/client";
import { LocaleProvider } from "@/providers/LocaleProvider";
import { OnrampFlow } from "./OnrampFlow.js";
import type { OnrampFlowProps } from "./types.js";

const roots = new WeakMap<HTMLElement, Root>();

export function mountOnrampFlow(host: HTMLElement, props: OnrampFlowProps): void {
  let root = roots.get(host);
  if (!root) {
    root = createRoot(host);
    roots.set(host, root);
  }
  root.render(
    <LocaleProvider>
      <OnrampFlow {...props} />
    </LocaleProvider>
  );
}

export function unmountOnrampFlow(host: HTMLElement): void {
  const root = roots.get(host);
  if (!root) return;
  root.unmount();
  roots.delete(host);
}
