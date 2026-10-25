/**
 * Privacy-safe event hook. No cookies, no network calls, no PII: events are dispatched as a
 * DOM CustomEvent ("tc:event") and pushed to window.dataLayer only if a provider already
 * defined it. Wire an approved analytics tool to this once a consent policy is chosen.
 * Never pass invoice details, addresses or amounts as params.
 */
export type TcEventName =
  | "seo_cta_clicked"
  | "invoice_create_started"
  | "developer_docs_opened"
  | "integration_guide_opened";

export function trackEvent(name: TcEventName, params: Record<string, string> = {}): void {
  try {
    const detail = { event: name, ...params };
    window.dispatchEvent(new CustomEvent("tc:event", { detail }));
    const dl = (window as unknown as { dataLayer?: unknown[] }).dataLayer;
    if (Array.isArray(dl)) dl.push(detail);
  } catch {
    /* analytics must never break the page */
  }
}
