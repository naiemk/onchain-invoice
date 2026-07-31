import type { AdminStats } from "../shared/types.js";

export function renderAdmin(root: HTMLElement): void {
  const savedKey = localStorage.getItem("tc.adminKey") ?? "";
  root.innerHTML = `
    <section class="panel">
      <p class="eyebrow">Admin</p>
      <h1>Platform stats</h1>
      <div class="grid">
        <label>Admin API key
          <input id="admin-key" type="password" value="${escapeHtml(savedKey)}" placeholder="ADMIN_API_KEY" />
        </label>
      </div>
      <button id="load-stats">Load stats</button>
      <div id="admin-status" class="status">Fees, gas, in-flight invoices, and settlement buckets by merchant address.</div>
      <div id="admin-results"></div>
    </section>
  `;

  root.querySelector<HTMLButtonElement>("#load-stats")?.addEventListener("click", async () => {
    const key = root.querySelector<HTMLInputElement>("#admin-key")?.value ?? "";
    localStorage.setItem("tc.adminKey", key);
    const status = root.querySelector<HTMLElement>("#admin-status");
    const results = root.querySelector<HTMLElement>("#admin-results");
    try {
      const response = await fetch("/api/admin/stats", { headers: { "x-api-key": key } });
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
    <section class="grid" style="margin-top: 1rem">
      <article class="card"><h3>Fees</h3><p class="mono">${escapeHtml(stats.fees)}</p></article>
      <article class="card"><h3>Gas spent wei</h3><p class="mono">${escapeHtml(stats.gas)}</p></article>
      <article class="card"><h3>In flight</h3><p class="mono">${stats.inFlight}</p></article>
    </section>
    <section class="card" style="margin-top: 1rem; overflow:auto">
      <h2>By merchant address</h2>
      <table>
        <thead><tr><th>To</th><th>Count</th><th>Paid</th><th>Swept</th><th>Fees</th></tr></thead>
        <tbody>
          ${stats.byTo.map((row) => `
            <tr>
              <td class="mono">${escapeHtml(row.to)}</td>
              <td>${row.count}</td>
              <td class="mono">${escapeHtml(row.amountPaid)}</td>
              <td class="mono">${escapeHtml(row.amountSwept)}</td>
              <td class="mono">${escapeHtml(row.feeCollected)}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </section>
  `;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[char] ?? char);
}
