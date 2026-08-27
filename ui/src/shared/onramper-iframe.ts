import { apiUrl } from "./site.js";
import { escapeHtml } from "./dom.js";

export function isSameOriginWidgetUrl(url: string): boolean {
  if (url.startsWith("/")) return true;
  try {
    return new URL(url, window.location.href).origin === window.location.origin;
  } catch {
    return false;
  }
}

export function currentUiTheme(): "light" | "dark" {
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

export const FIAT_LABELS: Record<string, string> = {
  USD: "US Dollar",
  EUR: "Euro",
  GBP: "British Pound",
  SEK: "Swedish Krona",
  NOK: "Norwegian Krone",
  DKK: "Danish Krone",
  CHF: "Swiss Franc",
  CAD: "Canadian Dollar",
  AUD: "Australian Dollar",
  JPY: "Japanese Yen",
  PLN: "Polish Złoty",
  CZK: "Czech Koruna",
};

/** Mount Onramper (or same-origin demo) iframe into a host element. */
export async function mountOnramperIframe(
  host: HTMLElement,
  widgetUrl: string,
  iframeTitle: string
): Promise<void> {
  const iframe = document.createElement("iframe");
  iframe.className = "onramp-iframe";
  iframe.title = iframeTitle;
  iframe.allow = "accelerometer; autoplay; camera; gyroscope; payment; microphone; clipboard-write";
  if (isSameOriginWidgetUrl(widgetUrl)) {
    const absolute = widgetUrl.startsWith("/") ? apiUrl(widgetUrl) : widgetUrl;
    const demo = await fetch(absolute);
    if (!demo.ok) throw new Error("Failed to load checkout");
    iframe.srcdoc = await demo.text();
  } else {
    iframe.src = widgetUrl;
    iframe.loading = "lazy";
  }
  host.replaceChildren(iframe);
}

export function onramperSkeletonHtml(loadingLabel: string): string {
  return `<div class="onramp-skeleton" aria-busy="true">${escapeHtml(loadingLabel)}</div>`;
}
