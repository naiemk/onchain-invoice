import { escapeHtml } from "../shared/dom.js";
import { SITE } from "../shared/site.js";
import { t } from "../i18n/t.js";

/** Public marketing page for passkeys, recovery, and Advanced team controls. */
export function renderSecurityMarketing(root: HTMLElement): void {
  root.innerHTML = `
    <header class="page-header">
      <p class="eyebrow">${escapeHtml(t("securityPage.eyebrow"))}</p>
      <h1>${escapeHtml(t("securityPage.title"))}</h1>
      <p class="lede">${escapeHtml(t("securityPage.lede"))}</p>
    </header>

    <section class="section security-marketing">
      <article class="security-marketing-block">
        <h2>${escapeHtml(t("securityPage.passkeyTitle"))}</h2>
        <p>${escapeHtml(t("securityPage.passkeyBody"))}</p>
      </article>
      <article class="security-marketing-block">
        <h2>${escapeHtml(t("securityPage.settlementTitle"))}</h2>
        <p>${escapeHtml(t("securityPage.settlementBody"))}</p>
      </article>
      <article class="security-marketing-block">
        <h2>${escapeHtml(t("securityPage.recoveryTitle"))}</h2>
        <p>${escapeHtml(t("securityPage.recoveryBody"))}</p>
        <p><a class="tc-btn secondary" href="/wallet/recover" data-route>${escapeHtml(t("securityPage.recoveryCta"))}</a></p>
      </article>
      <article class="security-marketing-block">
        <h2>${escapeHtml(t("securityPage.advancedTitle"))}</h2>
        <p>${escapeHtml(t("securityPage.advancedBody"))}</p>
        <ul class="security-coming-list">
          <li><span class="cmp-chip cmp-chip-ok">${escapeHtml(t("securityPage.available"))}</span> ${escapeHtml(t("securityPage.advDevices"))}</li>
          <li><span class="cmp-chip cmp-chip-ok">${escapeHtml(t("securityPage.available"))}</span> ${escapeHtml(t("securityPage.advRecovery"))}</li>
          <li><span class="cmp-chip cmp-chip-muted">${escapeHtml(t("securityPage.coming"))}</span> ${escapeHtml(t("securityPage.advRoles"))}</li>
          <li><span class="cmp-chip cmp-chip-muted">${escapeHtml(t("securityPage.coming"))}</span> ${escapeHtml(t("securityPage.advPolicies"))}</li>
          <li><span class="cmp-chip cmp-chip-muted">${escapeHtml(t("securityPage.coming"))}</span> ${escapeHtml(t("securityPage.advMultisig"))}</li>
        </ul>
      </article>
      <div class="cta-row">
        <a class="tc-btn" href="/wallet" data-route>${escapeHtml(t("securityPage.openWallet"))}</a>
        <a class="tc-btn secondary" href="${SITE.docsUrl}" target="_blank" rel="noopener noreferrer">${escapeHtml(t("nav.docs"))}</a>
      </div>
    </section>`;
}
