import { escapeHtml, shortId } from "../shared/dom.js";
import {
  chainChipHtml,
  explorerAddressUrl,
  explorerTxUrl,
  formatTokenAmount,
  looksLikeTronAddress,
  normalizeAddress,
  tokenChipHtml,
} from "../shared/networks.js";
import { apiUrl } from "../shared/site.js";
import type { InvoiceRecord, InvoiceStatus, InvoiceWithEvents } from "../shared/types.js";

const STORAGE_KEY = "tc.merchantAddress";

type SortKey = "createdAt" | "updatedAt" | "priceUsd" | "status" | "amountPaid";
type SortDir = "asc" | "desc";
type TimeFilter = "all" | "24h" | "7d" | "30d";

interface MerchantState {
  address: string;
  invoices: InvoiceRecord[];
  status: string;
  time: TimeFilter;
  sort: SortKey;
  dir: SortDir;
  selectedId: string | null;
}

export function renderMerchant(root: HTMLElement): void {
  const params = new URLSearchParams(location.search);
  const pathMatch = location.pathname.match(/^\/merchant\/([^/]+)$/);
  const invoiceFromPath = pathMatch ? decodeURIComponent(pathMatch[1]) : null;

  if (invoiceFromPath && params.get("view") === "page") {
    void renderInvoicePage(root, invoiceFromPath, params.get("to") ?? localStorage.getItem(STORAGE_KEY));
    return;
  }

  const initialAddress = params.get("to") ?? localStorage.getItem(STORAGE_KEY) ?? "";
  const state: MerchantState = {
    address: initialAddress,
    invoices: [],
    status: params.get("status") ?? "",
    time: (params.get("time") as TimeFilter) || "all",
    sort: (params.get("sort") as SortKey) || "createdAt",
    dir: (params.get("dir") as SortDir) || "desc",
    selectedId: invoiceFromPath ?? params.get("invoice"),
  };

  root.innerHTML = `
    <div class="admin-shell merchant-shell">
      <header class="page-header" style="max-width:none;margin:0 0 1.25rem">
        <p class="eyebrow">Merchant</p>
        <h1>Invoices</h1>
        <p>Enter your settlement address to review invoices, filter by status and time, and open payment details.</p>
      </header>

      <section class="panel">
        <form id="merchant-form" class="merchant-toolbar">
          <div class="field" style="margin:0;flex:1;min-width:16rem">
            <label for="merchant-address">Settlement address</label>
            <p class="field-hint">EVM wallet used as merchant <span class="mono">to</span> on your pay links.</p>
            <input id="merchant-address" class="mono" placeholder="0x…" value="${escapeHtml(state.address)}" required />
          </div>
          <div class="field" style="margin:0;min-width:10rem">
            <label for="filter-status">Status</label>
            <p class="field-hint">Filter by lifecycle state.</p>
            <select id="filter-status">
              <option value="">Any status</option>
              ${statusOptions(state.status)}
            </select>
          </div>
          <div class="field" style="margin:0;min-width:9rem">
            <label for="filter-time">Created</label>
            <p class="field-hint">Time window.</p>
            <select id="filter-time">
              <option value="all" ${state.time === "all" ? "selected" : ""}>Any time</option>
              <option value="24h" ${state.time === "24h" ? "selected" : ""}>Last 24 hours</option>
              <option value="7d" ${state.time === "7d" ? "selected" : ""}>Last 7 days</option>
              <option value="30d" ${state.time === "30d" ? "selected" : ""}>Last 30 days</option>
            </select>
          </div>
          <div class="field" style="margin:0;min-width:9rem">
            <label for="filter-sort">Sort</label>
            <p class="field-hint">Order results.</p>
            <select id="filter-sort">
              <option value="createdAt" ${state.sort === "createdAt" ? "selected" : ""}>Created</option>
              <option value="updatedAt" ${state.sort === "updatedAt" ? "selected" : ""}>Updated</option>
              <option value="priceUsd" ${state.sort === "priceUsd" ? "selected" : ""}>Amount</option>
              <option value="status" ${state.sort === "status" ? "selected" : ""}>Status</option>
              <option value="amountPaid" ${state.sort === "amountPaid" ? "selected" : ""}>Paid</option>
            </select>
          </div>
          <div class="field" style="margin:0;min-width:7rem">
            <label for="filter-dir">Direction</label>
            <p class="field-hint">&nbsp;</p>
            <select id="filter-dir">
              <option value="desc" ${state.dir === "desc" ? "selected" : ""}>Newest first</option>
              <option value="asc" ${state.dir === "asc" ? "selected" : ""}>Oldest first</option>
            </select>
          </div>
          <div class="merchant-actions">
            <button type="submit">Load invoices</button>
          </div>
        </form>
        <div id="merchant-status" class="status">Enter an address to load invoices.</div>
      </section>

      <div id="merchant-table"></div>
      <div id="invoice-modal" class="modal" hidden></div>
    </div>
  `;

  const form = root.querySelector<HTMLFormElement>("#merchant-form");
  form?.addEventListener("submit", (event) => {
    event.preventDefault();
    void load();
  });

  for (const id of ["filter-status", "filter-time", "filter-sort", "filter-dir"]) {
    root.querySelector(`#${id}`)?.addEventListener("change", () => {
      if (state.invoices.length) renderTable();
    });
  }

  async function load(): Promise<void> {
    const statusEl = root.querySelector<HTMLElement>("#merchant-status");
    const raw = root.querySelector<HTMLInputElement>("#merchant-address")?.value.trim() ?? "";
    try {
      state.address = looksLikeTronAddress(raw)
        ? normalizeAddress(raw, "tron")
        : normalizeAddress(raw, "evm");
      localStorage.setItem(STORAGE_KEY, state.address);
      root.querySelector<HTMLInputElement>("#merchant-address")!.value = state.address;
      syncFiltersFromForm();
      if (statusEl) statusEl.textContent = "Loading invoices…";
      const url = new URL(apiUrl("/api/invoices"), location.origin);
      url.searchParams.set("to", state.address);
      const response = await fetch(url.toString());
      const body = (await response.json()) as { invoices?: InvoiceRecord[]; error?: string };
      if (!response.ok) throw new Error(body.error ?? "Failed to load invoices");
      state.invoices = body.invoices ?? [];
      if (statusEl) {
        statusEl.textContent = `${state.invoices.length} invoice${state.invoices.length === 1 ? "" : "s"} for ${shortId(state.address)}`;
      }
      updateListUrl();
      renderTable();
      if (state.selectedId) {
        await openModal(state.selectedId);
      }
    } catch (error) {
      if (statusEl) statusEl.textContent = error instanceof Error ? error.message : "Failed to load invoices";
      root.querySelector<HTMLElement>("#merchant-table")!.innerHTML = "";
    }
  }

  function syncFiltersFromForm(): void {
    state.status = root.querySelector<HTMLSelectElement>("#filter-status")?.value ?? "";
    state.time = (root.querySelector<HTMLSelectElement>("#filter-time")?.value as TimeFilter) || "all";
    state.sort = (root.querySelector<HTMLSelectElement>("#filter-sort")?.value as SortKey) || "createdAt";
    state.dir = (root.querySelector<HTMLSelectElement>("#filter-dir")?.value as SortDir) || "desc";
  }

  function filteredSorted(): InvoiceRecord[] {
    syncFiltersFromForm();
    const cutoff = timeCutoff(state.time);
    let rows = state.invoices.filter((invoice) => {
      if (state.status && invoice.status !== state.status) return false;
      if (cutoff && new Date(invoice.createdAt).getTime() < cutoff) return false;
      return true;
    });
    return [...rows].sort((a, b) => compareInvoices(a, b, state.sort, state.dir));
  }

  function renderTable(): void {
    const rows = filteredSorted();
    const tableHost = root.querySelector<HTMLElement>("#merchant-table");
    if (!tableHost) return;
    if (rows.length === 0) {
      tableHost.innerHTML = `<section class="panel" style="margin-top:1.25rem"><p>No invoices match these filters.</p></section>`;
      return;
    }
    tableHost.innerHTML = `
      <section class="panel table-panel" style="margin-top:1.25rem">
        <div class="table-meta">
          <strong>${rows.length}</strong> shown
          ${state.status ? `· status <span class="mono">${escapeHtml(state.status)}</span>` : ""}
        </div>
        <div class="table-scroll">
          <table class="data-table">
            <thead>
              <tr>
                <th>Created</th>
                <th>Customer ref</th>
                <th>Title</th>
                <th>Amount</th>
                <th>Paid</th>
                <th>Status</th>
                <th>Network</th>
              </tr>
            </thead>
            <tbody>
              ${rows
                .map((invoice) => {
                  const active = invoice.id === state.selectedId ? " is-active" : "";
                  return `
                <tr class="data-row${active}" data-id="${escapeHtml(invoice.id)}">
                  <td>
                    <div class="cell-primary">${escapeHtml(formatDate(invoice.createdAt))}</div>
                    <div class="cell-muted">${escapeHtml(formatRelative(invoice.createdAt))}</div>
                  </td>
                  <td>
                    <div class="cell-primary">${escapeHtml(invoice.clientInvoiceId)}</div>
                    <div class="cell-muted mono">${escapeHtml(shortId(invoice.id))}</div>
                  </td>
                  <td>${escapeHtml(invoice.title ?? "—")}</td>
                  <td class="mono">$${escapeHtml(invoice.priceUsd)}</td>
                  <td class="mono">${escapeHtml(formatTokenAmount(invoice.amountPaid, invoice.token, invoice.chainId))}</td>
                  <td><span class="pill pill-${escapeHtml(invoice.status)}">${escapeHtml(formatStatus(invoice.status))}</span></td>
                  <td>${invoice.chainId ? chainChipHtml(invoice.chainId, { size: "sm", short: true }) : "—"}</td>
                </tr>`;
                })
                .join("")}
            </tbody>
          </table>
        </div>
      </section>
    `;

    tableHost.querySelectorAll<HTMLElement>(".data-row").forEach((el) => {
      el.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        const id = el.getAttribute("data-id");
        if (id) void openModal(id);
      });
    });
  }

  async function openModal(id: string): Promise<void> {
    const modal = root.querySelector<HTMLElement>("#invoice-modal");
    if (!modal) return;
    state.selectedId = id;
    modal.hidden = false;
    modal.innerHTML = `
      <div class="modal-backdrop" data-close></div>
      <div class="modal-dialog" role="dialog" aria-modal="true" aria-labelledby="modal-title">
        <div class="modal-body"><p class="status">Loading invoice…</p></div>
      </div>
    `;
    updateListUrl();
    renderTable();
    document.body.classList.add("modal-open");

    modal.querySelector("[data-close]")?.addEventListener("click", closeModal);

    try {
      const response = await fetch(apiUrl(`/api/invoices/${encodeURIComponent(id)}`));
      const invoice = (await response.json()) as InvoiceWithEvents & { error?: string };
      if (!response.ok) throw new Error(invoice.error ?? "Invoice not found");
      const pageHref = invoicePageHref(invoice.id, state.address);
      const dialog = modal.querySelector(".modal-dialog");
      if (dialog) {
        dialog.innerHTML = `
          <div class="modal-header">
            <div>
              <p class="eyebrow">Invoice</p>
              <h2 id="modal-title">${escapeHtml(invoice.title ?? invoice.clientInvoiceId)}</h2>
            </div>
            <button type="button" class="ghost" data-close aria-label="Close">Close</button>
          </div>
          <div class="modal-body">${detailFields(invoice)}</div>
          <div class="modal-footer btn-row">
            <a class="tc-btn secondary" href="${escapeHtml(pageHref)}" target="_blank" rel="noopener noreferrer">Open in separate page</a>
            <button type="button" class="secondary" data-close>Done</button>
          </div>
        `;
        dialog.querySelectorAll("[data-close]").forEach((el) => el.addEventListener("click", closeModal));
      }
    } catch (error) {
      const body = modal.querySelector(".modal-body");
      if (body) {
        body.innerHTML = `<p class="danger">${escapeHtml(error instanceof Error ? error.message : "Failed to load")}</p>`;
      }
    }
  }

  function closeModal(): void {
    const modal = root.querySelector<HTMLElement>("#invoice-modal");
    if (modal) {
      modal.hidden = true;
      modal.innerHTML = "";
    }
    state.selectedId = null;
    document.body.classList.remove("modal-open");
    updateListUrl();
    renderTable();
  }

  function updateListUrl(): void {
    const url = new URL(location.origin + "/merchant");
    if (state.address) url.searchParams.set("to", state.address);
    if (state.status) url.searchParams.set("status", state.status);
    if (state.time !== "all") url.searchParams.set("time", state.time);
    if (state.sort !== "createdAt") url.searchParams.set("sort", state.sort);
    if (state.dir !== "desc") url.searchParams.set("dir", state.dir);
    if (state.selectedId) url.searchParams.set("invoice", state.selectedId);
    history.replaceState({}, "", url);
  }

  if (state.address) {
    void load();
  }
}

async function renderInvoicePage(root: HTMLElement, invoiceId: string, to: string | null): Promise<void> {
  const back = to ? `/merchant?to=${encodeURIComponent(to)}` : "/merchant";
  root.innerHTML = `
    <div class="admin-shell">
      <header class="page-header" style="max-width:none;margin:0 0 1.25rem">
        <p class="eyebrow">Merchant · Invoice</p>
        <h1>Invoice detail</h1>
        <p><a href="${escapeHtml(back)}" data-route>← Back to invoices</a></p>
      </header>
      <section class="panel" id="invoice-page-body"><p class="status">Loading…</p></section>
    </div>
  `;
  try {
    const response = await fetch(apiUrl(`/api/invoices/${encodeURIComponent(invoiceId)}`));
    const invoice = (await response.json()) as InvoiceWithEvents & { error?: string };
    if (!response.ok) throw new Error(invoice.error ?? "Invoice not found");
    const body = root.querySelector("#invoice-page-body");
    if (body) {
      body.innerHTML = `
        <h2>${escapeHtml(invoice.title ?? invoice.clientInvoiceId)}</h2>
        <p class="field-hint">${escapeHtml(invoice.description ?? "No description")}</p>
        <span class="pill pill-${escapeHtml(invoice.status)}">${escapeHtml(formatStatus(invoice.status))}</span>
        ${detailFields(invoice)}
      `;
    }
  } catch (error) {
    const body = root.querySelector("#invoice-page-body");
    if (body) {
      body.innerHTML = `<p class="danger">${escapeHtml(error instanceof Error ? error.message : "Failed to load")}</p>`;
    }
  }
}

function invoicePageHref(invoiceId: string, to: string): string {
  const url = new URL(`/merchant/${encodeURIComponent(invoiceId)}`, location.origin);
  url.searchParams.set("view", "page");
  if (to) url.searchParams.set("to", to);
  return url.pathname + url.search;
}

function detailFields(invoice: InvoiceWithEvents): string {
  const addressUrl = invoice.invoiceAddress ? explorerAddressUrl(invoice.chainId, invoice.invoiceAddress) : null;
  const txUrl = invoice.sweepTx ? explorerTxUrl(invoice.chainId, invoice.sweepTx) : null;

  return `
    <dl class="detail-list">
      <div><dt>Amount due</dt><dd class="mono">$${escapeHtml(invoice.priceUsd)}</dd></div>
      <div><dt>Amount paid</dt><dd class="mono">${escapeHtml(formatTokenAmount(invoice.amountPaid, invoice.token, invoice.chainId))}</dd></div>
      <div><dt>Amount swept</dt><dd class="mono">${escapeHtml(formatTokenAmount(invoice.amountSwept, invoice.token, invoice.chainId))}</dd></div>
      <div><dt>Platform fee</dt><dd class="mono">${escapeHtml(formatTokenAmount(invoice.feeCollected, invoice.token, invoice.chainId))}</dd></div>
      <div><dt>Customer ref</dt><dd>${escapeHtml(invoice.clientInvoiceId)}</dd></div>
      <div><dt>Invoice id</dt><dd class="mono wrap">${escapeHtml(invoice.id)}</dd></div>
      <div><dt>Payment address</dt><dd class="mono wrap">${
        invoice.invoiceAddress
          ? addressUrl
            ? `<a href="${escapeHtml(addressUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(invoice.invoiceAddress)}</a>`
            : escapeHtml(invoice.invoiceAddress)
          : "—"
      }</dd></div>
      <div><dt>Sweep tx</dt><dd class="mono wrap">${
        invoice.sweepTx
          ? txUrl
            ? `<a href="${escapeHtml(txUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(invoice.sweepTx)}</a>`
            : escapeHtml(invoice.sweepTx)
          : "—"
      }</dd></div>
      <div><dt>Network</dt><dd>${invoice.chainId ? chainChipHtml(invoice.chainId, { size: "md" }) : "—"}</dd></div>
      <div><dt>Token</dt><dd>${tokenChipHtml(invoice.token, { size: "md" })}</dd></div>
      <div><dt>Created</dt><dd>${escapeHtml(formatDate(invoice.createdAt))}</dd></div>
      <div><dt>Updated</dt><dd>${escapeHtml(formatDate(invoice.updatedAt))}</dd></div>
      <div><dt>Paid at</dt><dd>${escapeHtml(invoice.paidAt ? formatDate(invoice.paidAt) : "—")}</dd></div>
      <div><dt>Swept at</dt><dd>${escapeHtml(invoice.sweptAt ? formatDate(invoice.sweptAt) : "—")}</dd></div>
    </dl>
  `;
}

function statusOptions(selected: string): string {
  const statuses: InvoiceStatus[] = ["created", "awaiting_payment", "paid", "paid_partial", "swept"];
  return statuses
    .map((status) => `<option value="${status}" ${selected === status ? "selected" : ""}>${formatStatus(status)}</option>`)
    .join("");
}

function compareInvoices(a: InvoiceRecord, b: InvoiceRecord, sort: SortKey, dir: SortDir): number {
  const sign = dir === "asc" ? 1 : -1;
  if (sort === "priceUsd" || sort === "amountPaid") {
    const av = Number(a[sort] || 0);
    const bv = Number(b[sort] || 0);
    if (av === bv) return 0;
    return av > bv ? sign : -sign;
  }
  const av = String(a[sort] ?? "");
  const bv = String(b[sort] ?? "");
  if (av === bv) return 0;
  return av > bv ? sign : -sign;
}

function timeCutoff(time: TimeFilter): number | null {
  const now = Date.now();
  if (time === "24h") return now - 24 * 60 * 60 * 1000;
  if (time === "7d") return now - 7 * 24 * 60 * 60 * 1000;
  if (time === "30d") return now - 30 * 24 * 60 * 60 * 1000;
  return null;
}

function formatStatus(status: string): string {
  return status.replace(/_/g, " ");
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatRelative(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const delta = Date.now() - date.getTime();
  const minutes = Math.round(delta / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}
