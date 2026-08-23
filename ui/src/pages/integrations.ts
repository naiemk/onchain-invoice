import {
  integrationsByWave,
  PLATFORM_INTEGRATIONS,
  type PlatformIntegration,
} from "../shared/integrations.js";
import { SITE } from "../shared/site.js";
import { t } from "../i18n/t.js";

function statusChip(status: PlatformIntegration["status"]): string {
  const label = status === "available" ? t("integrations.statusAvailable") : t("integrations.statusPreview");
  const kind = status === "available" ? "ok" : "muted";
  return `<span class="cmp-chip cmp-chip-${kind}">${label}</span>`;
}

function platformCard(platform: PlatformIntegration): string {
  const name = t(`integrations.platforms.${platform.id}.name` as Parameters<typeof t>[0]);
  const description = t(`integrations.platforms.${platform.id}.description` as Parameters<typeof t>[0]);
  const anchor = `platform-${platform.id}`;
  return `
    <article class="integration-card" id="${anchor}">
      <div class="integration-logo-wrap">
        <img class="integration-logo" src="${platform.logo}" alt="${name}" width="240" height="64" loading="lazy" decoding="async" />
      </div>
      <div class="integration-card-body">
        <div class="integration-card-head">
          <h3>${name}</h3>
          ${statusChip(platform.status)}
        </div>
        <p>${description}</p>
        <div class="integration-card-links">
          <a href="${platform.docsUrl}" target="_blank" rel="noopener noreferrer">${t("integrations.docs")}</a>
          <span aria-hidden="true">·</span>
          <a
            href="${platform.skillUrl.replace("/blob/", "/raw/")}"
            rel="alternate noopener noreferrer"
            target="_blank"
            data-agent-skill="trustless-commerce-${platform.id}"
          >${t("integrations.aiSkill")}</a>
        </div>
      </div>
    </article>`;
}

function waveSection(wave: 1 | 2 | 3, titleKey: Parameters<typeof t>[0]): string {
  const items = integrationsByWave(wave);
  if (items.length === 0) return "";
  return `
    <section class="integration-wave" id="wave-${wave}">
      <h2>${t(titleKey)}</h2>
      <div class="integration-grid">${items.map(platformCard).join("")}</div>
    </section>`;
}

export function renderIntegrations(root: HTMLElement): void {
  root.innerHTML = `
    <section class="integrations-hero section-narrow">
      <p class="eyebrow">${t("integrations.eyebrow")}</p>
      <h1>${t("integrations.title")}</h1>
      <p class="section-lede">${t("integrations.lede")}</p>
    </section>

    <section class="section integration-contract" id="contract">
      <div class="integration-contract-inner">
        <div>
          <p class="eyebrow">${t("integrations.contractEyebrow")}</p>
          <h2>${t("integrations.contractTitle")}</h2>
          <p>${t("integrations.contractBody")}</p>
          <p>
            <a href="${SITE.platformIntegrationDocsUrl}" target="_blank" rel="noopener noreferrer">${t("integrations.contractLink")}</a>
            ·
            <a href="${SITE.githubPlatformsUrl}" target="_blank" rel="noopener noreferrer">${t("integrations.sdkLink")}</a>
          </p>
        </div>
      </div>
    </section>

    ${waveSection(1, "integrations.wave1")}
    ${waveSection(2, "integrations.wave2")}
    ${waveSection(3, "integrations.wave3")}

    <section class="section section-narrow integration-cta">
      <h2>${t("integrations.ctaTitle")}</h2>
      <p class="section-lede">${t("integrations.ctaLede")}</p>
      <div class="cta-row" style="justify-content:center">
        <a class="tc-btn" href="/create" data-route>${t("home.ctaCreate")}</a>
        <a class="tc-btn secondary" href="${SITE.agentSkillUrl}" rel="alternate noopener noreferrer" target="_blank" data-agent-skill="trustless-commerce-invoice">${t("nav.aiSkill")}</a>
      </div>
    </section>
  `;
}

/** Logo strip for the home page — links to /integrations#platform-{id} */
export function integrationLogoStrip(): string {
  return PLATFORM_INTEGRATIONS.map((platform) => {
    const name = t(`integrations.platforms.${platform.id}.name` as Parameters<typeof t>[0]);
    return `
      <a class="integration-logo-tile" href="/integrations#platform-${platform.id}" data-route title="${name}">
        <img src="${platform.logo}" alt="${name}" width="200" height="52" loading="lazy" decoding="async" />
      </a>`;
  }).join("");
}
