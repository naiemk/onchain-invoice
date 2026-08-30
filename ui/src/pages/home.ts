import { integrationLogoStrip } from "./integrations.js";
import { deploymentMode, networksForDeployment } from "../shared/networks.js";
import { saveWalletMode } from "../shared/wallet-mode.js";
import { spaNavigate } from "../shared/spa-render.js";
import { t } from "../i18n/t.js";
import { escapeHtml } from "../shared/dom.js";

export function renderHome(root: HTMLElement): void {
  const mode = deploymentMode();
  const networks = networksForDeployment(mode);
  const chainLabels = networks
    .filter((n) => n.enabled !== false)
    .slice(0, 4)
    .map((n) => n.short)
    .join(" · ");

  root.innerHTML = `
    <section class="landing-hero landing-hero-product">
      <div class="landing-hero-copy">
        <p class="brand-hero">${escapeHtml(t("brand"))}</p>
        <h1>${escapeHtml(t("home.h1"))}</h1>
        <p class="lede">${escapeHtml(t("home.lede"))}</p>
        <div class="cta-row">
          <a class="tc-btn" href="/wallet" data-route>${escapeHtml(t("home.ctaOpenWallet"))}</a>
          <a class="tc-btn secondary" href="/create" data-route>${escapeHtml(t("home.ctaCreate"))}</a>
        </div>
        <p class="home-trust-row" aria-label="${escapeHtml(t("home.trustRowLabel"))}">
          <span>${escapeHtml(t("home.trustPasskey"))}</span>
          <span aria-hidden="true">·</span>
          <span>${escapeHtml(t("home.trustStables"))}</span>
          <span aria-hidden="true">·</span>
          <span>${escapeHtml(chainLabels || t("home.trustChainsFallback"))}</span>
        </p>
      </div>
      <aside class="hero-product" aria-hidden="true">
        <div class="hero-wallet-frame">
          <p class="hero-wallet-eyebrow">${escapeHtml(t("home.heroBalanceLabel"))}</p>
          <p class="hero-wallet-balance"><span class="hero-wallet-amount">12,480.00</span> <span>USD</span></p>
          <div class="hero-wallet-actions">
            <span>${escapeHtml(t("home.heroActionGetPaid"))}</span>
            <span>${escapeHtml(t("home.heroActionPay"))}</span>
            <span>${escapeHtml(t("home.heroActionCashIn"))}</span>
          </div>
          <ul class="hero-wallet-activity">
            <li><span class="ok">${escapeHtml(t("home.heroActivityPaid"))}</span><span>+240.00</span></li>
            <li><span>${escapeHtml(t("home.heroActivityDeposit"))}</span><span>+500.00</span></li>
            <li><span>${escapeHtml(t("home.heroActivitySent"))}</span><span>−85.00</span></li>
          </ul>
        </div>
      </aside>
    </section>

    <section class="section home-mode-section" id="modes">
      <p class="eyebrow">${escapeHtml(t("home.modeEyebrow"))}</p>
      <h2>${escapeHtml(t("home.modeTitle"))}</h2>
      <p class="section-lede">${escapeHtml(t("home.modeLede"))}</p>
      <div class="home-mode-chooser" role="list">
        <button type="button" class="home-mode-card is-active" data-home-mode="simple" role="listitem">
          <h3>${escapeHtml(t("home.modeSoloTitle"))}</h3>
          <p>${escapeHtml(t("home.modeSoloBody"))}</p>
          <span class="home-mode-cta">${escapeHtml(t("home.modeSoloCta"))}</span>
        </button>
        <button type="button" class="home-mode-card" data-home-mode="advanced" role="listitem">
          <h3>${escapeHtml(t("home.modeTeamTitle"))}</h3>
          <p>${escapeHtml(t("home.modeTeamBody"))}</p>
          <span class="home-mode-cta">${escapeHtml(t("home.modeTeamCta"))}</span>
        </button>
      </div>
      <div class="home-mode-preview" id="home-mode-preview" data-preview="simple">
        <p class="home-mode-preview-simple">${escapeHtml(t("home.modeSoloPreview"))}</p>
        <p class="home-mode-preview-advanced">${escapeHtml(t("home.modeTeamPreview"))}</p>
      </div>
    </section>

    <section class="section" id="jobs">
      <p class="eyebrow">${escapeHtml(t("home.jobsEyebrow"))}</p>
      <h2>${escapeHtml(t("home.jobsTitle"))}</h2>
      <div class="home-job-bento">
        <a class="home-job-tile" href="/get-paid" data-route>
          <h3>${escapeHtml(t("home.jobGetPaidTitle"))}</h3>
          <p>${escapeHtml(t("home.jobGetPaidBody"))}</p>
        </a>
        <a class="home-job-tile" href="/wallet/send" data-route>
          <h3>${escapeHtml(t("home.jobPayTitle"))}</h3>
          <p>${escapeHtml(t("home.jobPayBody"))}</p>
        </a>
        <a class="home-job-tile" href="/wallet/cash" data-route>
          <h3>${escapeHtml(t("home.jobCashTitle"))}</h3>
          <p>${escapeHtml(t("home.jobCashBody"))}</p>
        </a>
        <a class="home-job-tile" href="/security" data-route>
          <h3>${escapeHtml(t("home.jobSecureTitle"))}</h3>
          <p>${escapeHtml(t("home.jobSecureBody"))}</p>
        </a>
      </div>
    </section>

    <section class="section home-fiat-band">
      <h2>${escapeHtml(t("home.fiatTitle"))}</h2>
      <p>${escapeHtml(t("home.fiatBody"))}</p>
      <div class="cta-row">
        <a class="tc-btn secondary" href="/wallet/cash" data-route>${escapeHtml(t("home.fiatCta"))}</a>
      </div>
    </section>

    <section class="section">
      <div class="security-band">
        <p class="eyebrow">${escapeHtml(t("home.trustEyebrow"))}</p>
        <h2>${escapeHtml(t("home.trustTitle"))}</h2>
        <p>${escapeHtml(t("home.trustBody"))}</p>
        <p><a class="tc-btn secondary" href="/security" data-route>${escapeHtml(t("home.trustCta"))}</a></p>
      </div>
    </section>

    <section class="section" id="integrations">
      <p class="eyebrow">${escapeHtml(t("home.integrationsEyebrow"))}</p>
      <h2>${escapeHtml(t("home.integrationsTitle"))}</h2>
      <p class="section-lede">${escapeHtml(t("home.integrationsLede"))}</p>
      <div class="integration-logo-strip" role="list">
        ${integrationLogoStrip()}
      </div>
      <p class="integration-home-cta">
        <a class="tc-btn secondary" href="/integrations" data-route>${escapeHtml(t("home.integrationsCta"))}</a>
      </p>
    </section>

    <section class="section section-narrow home-final-cta">
      <h2>${escapeHtml(t("home.readyTitle"))}</h2>
      <p class="section-lede">${escapeHtml(t("home.readyLede"))}</p>
      <div class="cta-row" style="justify-content:center">
        <a class="tc-btn" href="/wallet" data-route>${escapeHtml(t("home.ctaOpenWallet"))}</a>
        <a class="tc-btn secondary" href="/create" data-route>${escapeHtml(t("home.ctaCreate"))}</a>
      </div>
    </section>
  `;

  const preview = root.querySelector<HTMLElement>("#home-mode-preview");
  root.querySelectorAll<HTMLButtonElement>("[data-home-mode]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const next = btn.dataset.homeMode === "advanced" ? "advanced" : "simple";
      root.querySelectorAll(".home-mode-card").forEach((c) => c.classList.remove("is-active"));
      btn.classList.add("is-active");
      if (preview) preview.dataset.preview = next;
      saveWalletMode(next);
      if (next === "advanced") spaNavigate("/wallet");
      else spaNavigate("/wallet");
    });
  });
}
