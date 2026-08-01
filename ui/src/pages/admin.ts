import type { AdminStats } from "../shared/types.js";
import { escapeHtml } from "../shared/dom.js";
import { apiUrl } from "../shared/site.js";

export function renderAdmin(root: HTMLElement): void {
  const savedKey = localStorage.getItem("tc.adminKey") ?? "";
  if (!savedKey && !sessionStorage.getItem("tc.adminUnlocked")) {
    root.innerHTML = `
      <div class="admin-shell">
        <header class="page-header" style="max-width:none;margin:0 0 1.25rem">
          <p class="eyebrow">Admin</p>
          <h1>Restricted</h1>
          <p>Enter the platform admin API key to continue.</p>
        </header>
        <section class="panel">
          <div class="field" style="max-width:28rem">
            <label for="admin-key">Admin API key</label>
            <input id="admin-key" type="password" placeholder="ADMIN_API_KEY" autocomplete="off" />
          </div>
          <button id="unlock-admin">Unlock</button>
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
        if (status) status.textContent = error instanceof Error ? error.message : "Unlock failed";
      }
    });
    return;
  }

  root.innerHTML = `
    <div class="admin-shell">
      <header class="page-header" style="max-width:none;margin:0 0 1.25rem">
        <p class="eyebrow">Admin</p>
        <h1>Platform overview</h1>
        <p>Fees, gas, and settlement activity across merchant addresses.</p>
      </header>

      <section class="panel">
        <div class="field" style="max-width:28rem">
          <label for="admin-key">Admin API key</label>
          <p class="field-hint">Sent as <span class="mono">x-api-key</span> to <span class="mono">GET /api/admin/stats</span>.</p>
          <input id="admin-key" type="password" value="${escapeHtml(savedKey)}" placeholder="ADMIN_API_KEY" autocomplete="off" />
        </div>
        <button id="load-stats">Load stats</button>
        <div id="admin-status" class="status">Enter your API key to load live metrics.</div>
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
      if (status) status.textContent = "Stats loaded.";
      if (results) results.innerHTML = statsView(body);
    } catch (error) {
      if (status) status.textContent = error instanceof Error ? error.message : "Stats request failed";
    }
  });
}

function statsView(stats: AdminStats): string {
  return `
    <div class="metric-grid">
      <article class="metric">
        <div class="label">Fees collected</div>
        <div class="value">${escapeHtml(stats.fees)}</div>
      </article>
      <article class="metric">
        <div class="label">Gas spent (wei)</div>
        <div class="value">${escapeHtml(stats.gas)}</div>
      </article>
      <article class="metric">
        <div class="label">In flight</div>
        <div class="value">${stats.inFlight}</div>
      </article>
    </div>
    <section class="panel" style="margin-top:1.25rem;overflow:auto">
      <h2>By merchant address</h2>
      <table>
        <thead>
          <tr><th>To</th><th>Count</th><th>Paid</th><th>Swept</th><th>Fees</th></tr>
        </thead>
        <tbody>
          ${
            stats.byTo.length === 0
              ? `<tr><td colspan="5">No settlement activity yet.</td></tr>`
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
