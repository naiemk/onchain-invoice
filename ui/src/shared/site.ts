/** Public site / docs / social links (dummy TG until live). */
export const SITE = {
  docsUrl: "https://naiemk.github.io/onchain-invoice/",
  platformIntegrationDocsUrl: "https://naiemk.github.io/onchain-invoice/platform-integration/",
  agentsDocsUrl: "https://naiemk.github.io/onchain-invoice/agents/",
  githubPlatformsUrl: "https://github.com/naiemk/onchain-invoice/tree/main/platforms",
  /** Raw Cursor skill — agents/bots should fetch this URL. */
  agentSkillUrl:
    "https://raw.githubusercontent.com/naiemk/onchain-invoice/main/.cursor/skills/trustless-commerce-invoice/SKILL.md",
  agentSkillPath: ".cursor/skills/trustless-commerce-invoice/SKILL.md",
  githubUrl: "https://github.com/naiemk/onchain-invoice",
  githubCommerceUrl: "https://github.com/naiemk/onchain-invoice/tree/main/commerce",
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
