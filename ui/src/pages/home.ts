import { encodePayLink } from "../shared/invoice.js";
import { integrationLogoStrip } from "./integrations.js";
import { howCreateArt, howPayArt, howSettleArt } from "../shared/how-graphics.js";
import { deploymentMode, networkKind, networksForDeployment } from "../shared/networks.js";
import { SITE } from "../shared/site.js";
import { t } from "../i18n/t.js";

function chip(label: string, kind: "muted" | "warn" | "ok" | "accent" = "muted"): string {
  return `<span class="cmp-chip cmp-chip-${kind}">${label}</span>`;
}

export function renderHome(root: HTMLElement): void {
  const mode = deploymentMode();
  const networks = networksForDeployment(mode);
  // Prefer Base on mainnet so the demo link keeps an EVM merchant address.
  const demoChain =
    mode === "mainnet"
      ? (networks.find((n) => n.id === "8453")?.id ?? networks[0]?.id ?? "8453")
      : (networks[0]?.id ?? "11155111");
  const demoKind = networkKind(demoChain);
  const demoToken = demoKind === "tron" ? "USDT" : "USDC";
  const demoTo =
    demoKind === "tron"
      ? ["TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf"]
      : ["0xc2eCF8b48b9D5D1Fd04b8A9c15126011aa1cC3Eb"];
  const demo = {
    price: "0.01",
    to: demoTo,
    chains: [demoChain],
    tokens: [demoToken],
    clientInvoiceId: `order-${Date.now().toString(36)}`,
    callback: "",
    title: t("home.demoTitle"),
    description: mode === "testnet" ? t("home.demoDescriptionTestnet") : t("home.demoDescriptionMainnet"),
    allowPartial: false,
    paymentMode: "crypto" as const,
  };
  const demoLink = `/pay?${encodePayLink(demo)}`;

  root.innerHTML = `
    <section class="landing-hero">
      <div>
        <p class="brand-hero">${t("brand")}</p>
        <h1>${t("home.h1")}</h1>
        <p class="lede">${t("home.lede")}</p>
        <div class="cta-row">
          <a class="tc-btn" href="/create" data-route>${t("home.ctaCreate")}</a>
          <a class="tc-btn secondary" href="${demoLink}" target="_blank" rel="noopener noreferrer">${t("home.ctaLiveCheckout")}</a>
        </div>
      </div>
      <aside class="hero-shopify" aria-hidden="true">
        <div class="shopify-shot">
          <div class="shopify-shot-inner">
            <p class="shopify-store">${t("home.shopifyStore")}</p>
            <p class="shopify-step">${t("home.shopifyStep")}</p>
            <div class="shopify-line">
              <img
                class="shopify-thumb"
                src="/images/canvas-weekender.png"
                alt=""
                width="64"
                height="64"
                decoding="async"
              />
              <div class="shopify-line-copy">
                <p class="shopify-product">${t("home.shopifyProduct")}</p>
                <p class="shopify-variant">${t("home.shopifyVariant")}</p>
              </div>
              <p class="shopify-price">$128.00</p>
            </div>
            <div class="shopify-totals">
              <div><span>${t("home.shopifySubtotal")}</span><span>$128.00</span></div>
              <div><span>${t("home.shopifyShipping")}</span><span>${t("home.shopifyShippingFree")}</span></div>
              <div class="shopify-total"><span>${t("home.shopifyTotal")}</span><span>$128.00</span></div>
            </div>
            <div class="shopify-pay">
              <span class="shopify-crypto">${t("home.shopifyPayCrypto")}</span>
            </div>
          </div>
        </div>
        <p class="shopify-caption">${t("home.shopifyCaption")}</p>
      </aside>
    </section>

    <section class="section" id="agents">
      <p class="eyebrow">${t("home.agentsEyebrow")}</p>
      <h2>${t("home.agentsTitle")}</h2>
      <p class="section-lede">${t("home.agentsLede")}</p>
      <p>
        <a
          id="agent-skill"
          class="agent-skill-link"
          href="${SITE.agentSkillUrl}"
          rel="alternate noopener noreferrer"
          target="_blank"
          data-agent-skill="trustless-commerce-invoice"
        >${t("home.agentsSkillLink")}</a>
        ·
        <a href="${SITE.agentsDocsUrl}" target="_blank" rel="noopener noreferrer">${t("home.agentsDocs")}</a>
      </p>
      <p class="field-hint mono">${SITE.agentSkillPath}</p>
    </section>

    <section class="section" id="integrations">
      <p class="eyebrow">${t("home.integrationsEyebrow")}</p>
      <h2>${t("home.integrationsTitle")}</h2>
      <p class="section-lede">${t("home.integrationsLede")}</p>
      <div class="integration-logo-strip" role="list">
        ${integrationLogoStrip()}
      </div>
      <p class="integration-home-cta">
        <a class="tc-btn secondary" href="/integrations" data-route>${t("home.integrationsCta")}</a>
      </p>
    </section>

    <section class="section">
      <p class="eyebrow">${t("home.whyEyebrow")}</p>
      <h2>${t("home.whyTitle")}</h2>
      <p class="section-lede">${t("home.whyLede")}</p>
      <div class="feature-row">
        <article>
          <h3>${t("home.whyMinuteTitle")}</h3>
          <p>${t("home.whyMinuteBody")}</p>
        </article>
        <article>
          <h3>${t("home.whyPaperworkTitle")}</h3>
          <p>${t("home.whyPaperworkBody")}</p>
        </article>
        <article>
          <h3>${t("home.whyDropinTitle")}</h3>
          <p>${t("home.whyDropinBody")}</p>
        </article>
      </div>
    </section>

    <section class="section">
      <p class="eyebrow">${t("home.compareEyebrow")}</p>
      <h2>${t("home.compareTitle")}</h2>
      <p class="section-lede">${t("home.compareLede")}</p>
      <p class="compare-callout">${t("home.compareCallout")}</p>
      <div class="compare-wrap">
        <table class="compare-table">
          <thead>
            <tr>
              <th class="sticky-col">${t("home.compareStep")}</th>
              <th>BitPay</th>
              <th>Coinbase Commerce</th>
              <th>NOWPayments</th>
              <th>BTCPay Server</th>
              <th class="highlight-col">
                <span class="ours-pill">${t("home.compareOurs")}</span>
                ${t("brand")}
              </th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td class="sticky-col">${t("home.compareAccountRow")}</td>
              <td>${chip(t("home.chipAccount"), "warn")}</td>
              <td>${chip(t("home.chipAccount"), "warn")}</td>
              <td>${chip(t("home.chipAccount"), "warn")}</td>
              <td>${chip(t("home.chipSelfHost"), "muted")}</td>
              <td class="highlight-col">${chip(t("home.chipNone"), "ok")}</td>
            </tr>
            <tr>
              <td class="sticky-col">${t("home.compareKycRow")}</td>
              <td>${chip(t("home.chipKyc"), "warn")}</td>
              <td>${chip(t("home.chipVerify"), "warn")}</td>
              <td>${chip(t("home.chipOftenKyc"), "warn")}</td>
              <td>${chip(t("home.chipVaries"), "muted")}</td>
              <td class="highlight-col">${chip(t("home.chipNone"), "ok")}</td>
            </tr>
            <tr>
              <td class="sticky-col">${t("home.compareTimeRow")}</td>
              <td>${chip(t("home.chipDays"), "muted")}</td>
              <td>${chip(t("home.chipHoursDays"), "muted")}</td>
              <td>${chip(t("home.chipHours"), "muted")}</td>
              <td>${chip(t("home.chipSetupHours"), "muted")}</td>
              <td class="highlight-col">${chip(t("home.chipOneMin"), "accent")}</td>
            </tr>
            <tr>
              <td class="sticky-col">${t("home.compareControlRow")}</td>
              <td>${chip(t("home.chipProcessor"), "muted")}</td>
              <td>${chip(t("home.chipProcessor"), "muted")}</td>
              <td>${chip(t("home.chipProcessor"), "muted")}</td>
              <td>${chip(t("home.chipYourNode"), "muted")}</td>
              <td class="highlight-col">${chip(t("home.chipYourWallet"), "accent")}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <section class="section">
      <p class="eyebrow">${t("home.howEyebrow")}</p>
      <h2>${t("home.howTitle")}</h2>
      <p class="section-lede">${t("home.howLede")}</p>
      <div class="how-grid">
        <article class="how-card how-card-1">
          <div class="how-art-wrap">${howCreateArt()}</div>
          <span class="how-step">1</span>
          <h3>${t("home.how1Title")}</h3>
          <p>${t("home.how1Body")}</p>
        </article>
        <article class="how-card how-card-2">
          <div class="how-art-wrap">${howPayArt()}</div>
          <span class="how-step">2</span>
          <h3>${t("home.how2Title")}</h3>
          <p>${t("home.how2Body")}</p>
        </article>
        <article class="how-card how-card-3">
          <div class="how-art-wrap">${howSettleArt(t("home.howFee"), t("home.howYourWallet"))}</div>
          <span class="how-step">3</span>
          <h3>${t("home.how3Title")}</h3>
          <p>${t("home.how3Body")}</p>
        </article>
      </div>
    </section>

    <section class="section">
      <div class="security-band">
        <p class="eyebrow">${t("home.securityEyebrow")}</p>
        <h2>${t("home.securityTitle")}</h2>
        <p>${t("home.securityBody")}</p>
      </div>
    </section>

    <section class="section section-narrow" style="text-align:center">
      <h2>${t("home.readyTitle")}</h2>
      <p class="section-lede" style="margin-left:auto;margin-right:auto">${t("home.readyLede")}</p>
      <div class="cta-row" style="justify-content:center">
        <a class="tc-btn" href="/create" data-route>${t("home.ctaCreate")}</a>
        <a class="tc-btn secondary" href="/create#docs" data-route>${t("home.ctaApiDocs")}</a>
      </div>
    </section>

    <footer class="site-footer">
      <span>${t("brand")}</span>
      <span>
        <a href="/create" data-route>${t("home.footerCreate")}</a>
        ·
        <a href="/merchant" data-route>${t("nav.merchant")}</a>
        ·
        <a href="${SITE.agentSkillUrl}" rel="alternate noopener noreferrer" target="_blank" data-agent-skill="trustless-commerce-invoice">${t("nav.aiSkill")}</a>
      </span>
    </footer>
  `;
}
