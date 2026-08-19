import type { AdminStats } from "../shared/types.js";
import { escapeHtml } from "../shared/dom.js";
import { apiUrl } from "../shared/site.js";
import { localizeError } from "../i18n/errors.js";
import { t } from "../i18n/t.js";

export function renderAdmin(root: HTMLElement): void {
  const savedKey = localStorage.getItem("tc.adminKey") ?? "";
  if (!savedKey && !sessionStorage.getItem("tc.adminUnlocked")) {
    root.innerHTML = `
      <div class="admin-shell">
        <header class="page-header" style="max-width:none;margin:0 0 1.25rem">
          <p class="eyebrow">${t("admin.eyebrow")}</p>
          <h1>${t("admin.restrictedTitle")}</h1>
          <p>${t("admin.restrictedLede")}</p>
        </header>
        <section class="panel">
          <div class="field" style="max-width:28rem">
            <label for="admin-key">${t("admin.keyLabel")}</label>
            <input id="admin-key" type="password" placeholder="ADMIN_API_KEY" autocomplete="off" />
          </div>
          <button id="unlock-admin">${t("admin.unlock")}</button>
          <div id="admin-status" class="status"></div>
        </section>
      </div>
    `;
    root.querySelector("#unlock-admin")?.addEventListener("click", async () => {
      const key = root.querySelector<HTMLInputElement>("#admin-key")?.value ?? "";
      const status = root.querySelector<HTMLElement>("#admin-status");
      try {
        const response = await fetch(apiUrl("/api/admin/stats"), { headers: { "x-api-key": key } });
        if (!response.ok) throw new Error("Invalid admin key");
        localStorage.setItem("tc.adminKey", key);
        sessionStorage.setItem("tc.adminUnlocked", "1");
        renderAdmin(root);
      } catch (error) {
        if (status) status.textContent = localizeError(error);
      }
    });
    return;
  }

  root.innerHTML = `
    <div class="admin-shell">
      <header class="page-header" style="max-width:none;margin:0 0 1.25rem">
        <p class="eyebrow">${t("admin.eyebrow")}</p>
        <h1>${t("admin.overviewTitle")}</h1>
        <p>${t("admin.overviewLede")}</p>
      </header>

      <section class="panel">
        <div class="field" style="max-width:28rem">
          <label for="admin-key">${t("admin.keyLabel")}</label>
          <p class="field-hint">${t("admin.keyHint")}</p>
          <input id="admin-key" type="password" value="${escapeHtml(savedKey)}" placeholder="ADMIN_API_KEY" autocomplete="off" />
        </div>
        <button id="load-stats">${t("admin.loadStats")}</button>
        <div id="admin-status" class="status">${t("admin.enterKey")}</div>
      </section>

      <div id="admin-results"></div>
    </div>
  `;

  root.querySelector<HTMLButtonElement>("#load-stats")?.addEventListener("click", async () => {
    const key = root.querySelector<HTMLInputElement>("#admin-key")?.value ?? "";
    localStorage.setItem("tc.adminKey", key);
    const status = root.querySelector<HTMLElement>("#admin-status");
    const results = root.querySelector<HTMLElement>("#admin-results");
    try {
      const response = await fetch(apiUrl("/api/admin/stats"), { headers: { "x-api-key": key } });
      const body = (await response.json()) as AdminStats & { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Stats request failed");
      if (status) status.textContent = t("admin.statsLoaded");
      if (results) results.innerHTML = statsView(body);
    } catch (error) {
      if (status) status.textContent = localizeError(error);
    }
  });
}

function statsView(stats: AdminStats): string {
  return `
    <div class="metric-grid">
      <article class="metric">
        <div class="label">${t("admin.feesCollected")}</div>
        <div class="value">${escapeHtml(stats.fees)}</div>
      </article>
      <article class="metric">
        <div class="label">${t("admin.gasSpent")}</div>
        <div class="value">${escapeHtml(stats.gas)}</div>
      </article>
      <article class="metric">
        <div class="label">${t("admin.inFlight")}</div>
        <div class="value">${stats.inFlight}</div>
      </article>
    </div>
    <section class="panel" style="margin-top:1.25rem;overflow:auto">
      <h2>${t("admin.byMerchant")}</h2>
      <table>
        <thead>
          <tr>
            <th>${t("admin.colTo")}</th>
            <th>${t("admin.colCount")}</th>
            <th>${t("admin.colPaid")}</th>
            <th>${t("admin.colSwept")}</th>
            <th>${t("admin.colFees")}</th>
          </tr>
        </thead>
        <tbody>
          ${
            stats.byTo.length === 0
              ? `<tr><td colspan="5">${t("admin.noActivity")}</td></tr>`
              : stats.byTo
                  .map(
                    (row) => `
            <tr>
              <td class="mono">${escapeHtml(row.to)}</td>
              <td>${row.count}</td>
              <td class="mono">${escapeHtml(row.amountPaid)}</td>
              <td class="mono">${escapeHtml(row.amountSwept)}</td>
              <td class="mono">${escapeHtml(row.feeCollected)}</td>
            </tr>`
                  )
                  .join("")
          }
        </tbody>
      </table>
    </section>
  `;
}
