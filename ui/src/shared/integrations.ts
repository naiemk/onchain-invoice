import { SITE } from "./site.js";

export type IntegrationStatus = "available" | "preview";
export type IntegrationWave = 1 | 2 | 3;

export interface PlatformIntegration {
  id: string;
  wave: IntegrationWave;
  status: IntegrationStatus;
  logo: string;
  docsUrl: string;
  skillUrl: string;
  skillPath: string;
}

const GITHUB_PLATFORMS = `${SITE.githubUrl}/tree/main/platforms`;

export const PLATFORM_INTEGRATIONS: PlatformIntegration[] = [
  {
    id: "woocommerce",
    wave: 1,
    status: "available",
    logo: "/images/integrations/woocommerce.svg",
    docsUrl: `${GITHUB_PLATFORMS}/woocommerce`,
    skillUrl: `${SITE.githubUrl}/blob/main/.cursor/skills/trustless-commerce-woocommerce/SKILL.md`,
    skillPath: ".cursor/skills/trustless-commerce-woocommerce/SKILL.md",
  },
  {
    id: "shopify",
    wave: 1,
    status: "available",
    logo: "/images/integrations/shopify.svg",
    docsUrl: `${GITHUB_PLATFORMS}/shopify`,
    skillUrl: `${SITE.githubUrl}/blob/main/.cursor/skills/trustless-commerce-shopify/SKILL.md`,
    skillPath: ".cursor/skills/trustless-commerce-shopify/SKILL.md",
  },
  {
    id: "kajabi",
    wave: 2,
    status: "available",
    logo: "/images/integrations/kajabi.svg",
    docsUrl: `${GITHUB_PLATFORMS}/creator/kajabi`,
    skillUrl: `${SITE.githubUrl}/blob/main/.cursor/skills/trustless-commerce-kajabi/SKILL.md`,
    skillPath: ".cursor/skills/trustless-commerce-kajabi/SKILL.md",
  },
  {
    id: "teachable",
    wave: 2,
    status: "available",
    logo: "/images/integrations/teachable.svg",
    docsUrl: `${GITHUB_PLATFORMS}/creator/teachable`,
    skillUrl: `${SITE.githubUrl}/blob/main/.cursor/skills/trustless-commerce-teachable/SKILL.md`,
    skillPath: ".cursor/skills/trustless-commerce-teachable/SKILL.md",
  },
  {
    id: "bigcommerce",
    wave: 3,
    status: "preview",
    logo: "/images/integrations/bigcommerce.svg",
    docsUrl: `${SITE.docsUrl}platform-integration/`,
    skillUrl: `${SITE.githubUrl}/blob/main/.cursor/skills/trustless-commerce-bigcommerce/SKILL.md`,
    skillPath: ".cursor/skills/trustless-commerce-bigcommerce/SKILL.md",
  },
  {
    id: "lemonsqueezy",
    wave: 3,
    status: "preview",
    logo: "/images/integrations/lemonsqueezy.svg",
    docsUrl: `${SITE.docsUrl}platform-integration/`,
    skillUrl: `${SITE.githubUrl}/blob/main/.cursor/skills/trustless-commerce-lemonsqueezy/SKILL.md`,
    skillPath: ".cursor/skills/trustless-commerce-lemonsqueezy/SKILL.md",
  },
  {
    id: "gumroad",
    wave: 3,
    status: "preview",
    logo: "/images/integrations/gumroad.svg",
    docsUrl: `${SITE.docsUrl}platform-integration/`,
    skillUrl: `${SITE.githubUrl}/blob/main/.cursor/skills/trustless-commerce-gumroad/SKILL.md`,
    skillPath: ".cursor/skills/trustless-commerce-gumroad/SKILL.md",
  },
];

export function integrationsByWave(wave: IntegrationWave): PlatformIntegration[] {
  return PLATFORM_INTEGRATIONS.filter((p) => p.wave === wave);
}
