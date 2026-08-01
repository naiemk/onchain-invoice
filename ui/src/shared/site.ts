/** Public site / docs / social links (dummy TG until live). */
export const SITE = {
  docsUrl: "https://naiemk.github.io/onchain-invoice/",
  githubUrl: "https://github.com/naiemk/onchain-invoice",
  githubCommerceUrl: "https://github.com/naiemk/trustless-commerce",
  telegramChannel: "https://t.me/trustlesscommerce",
  telegramSupport: "https://t.me/trustlesscommerce_support",
} as const;

/** API origin for production; empty = same-origin / Vite proxy. */
export function apiBase(): string {
  const raw = import.meta.env.VITE_API_BASE_URL as string | undefined;
  return raw?.replace(/\/$/, "") ?? "";
}

export function apiUrl(path: string): string {
  const base = apiBase();
  return `${base}${path.startsWith("/") ? path : `/${path}`}`;
}
