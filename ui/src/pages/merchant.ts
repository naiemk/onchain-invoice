import type { InvoiceRecord } from "../shared/types.js";

declare global {
  interface Window {
    ethereum?: {
      request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
    };
  }
}

export function renderMerchant(root: HTMLElement): void {
  const saved = readAuth();
  root.innerHTML = `
    <section class="panel">
      <p class="eyebrow">Merchant console</p>
      <h1>Invoices by wallet</h1>
      <p>Connect a wallet and sign a scoped personal_sign message to list invoices for that merchant address.</p>
      <div class="grid">
        <label>Status
          <select id="status">
            <option value="">Any</option>
            <option value="created">created</option>
            <option value="awaiting_payment">awaiting_payment</option>
            <option value="paid">paid</option>
            <option value="paid_partial">paid_partial</option>
            <option value="swept">swept</option>
          </select>
        </label>
      </div>
      <button id="connect">${saved ? "Refresh invoices" : "Connect wallet"}</button>
      <div id="merchant-status" class="status">${saved ? `Connected as ${escapeHtml(saved.address)}` : "No wallet connected."}</div>
      <div id="merchant-results"></div>
    </section>
  `;

  root.querySelector<HTMLButtonElement>("#connect")?.addEventListener("click", async () => {
    const status = root.querySelector<HTMLElement>("#merchant-status");
    const results = root.querySelector<HTMLElement>("#merchant-results");
    try {
      const auth = saved ?? await signIn();
      sessionStorage.setItem("tc.merchantAuth", JSON.stringify(auth));
      const filter = root.querySelector<HTMLSelectElement>("#status")?.value;
      const url = new URL("/api/invoices", location.origin);
      url.searchParams.set("to", auth.address);
      if (filter) url.searchParams.set("status", filter);
      const response = await fetch(url, { headers: authHeaders(auth) });
      const body = (await response.json()) as { invoices?: InvoiceRecord[]; error?: string };
      if (!response.ok) throw new Error(body.error ?? "Invoice fetch failed");
      if (status) status.textContent = `Loaded ${body.invoices?.length ?? 0} invoices for ${auth.address}.`;
      if (results) results.innerHTML = table(body.invoices ?? []);
    } catch (error) {
      if (status) status.textContent = error instanceof Error ? error.message : "Wallet auth failed";
    }
  });
}

async function signIn(): Promise<{ address: string; message: string; signature: string }> {
  if (!window.ethereum) throw new Error("No injected wallet found");
  const accounts = await window.ethereum.request({ method: "eth_requestAccounts" }) as string[];
  const address = accounts[0];
  if (!address) throw new Error("No wallet account selected");
  const nonce = crypto.randomUUID();
  const message = [
    "Trustless Commerce merchant login",
    `Address: ${address}`,
    `Nonce: ${nonce}`,
    `Issued At: ${new Date().toISOString()}`,
  ].join("\n");
  const signature = await window.ethereum.request({ method: "personal_sign", params: [message, address] }) as string;
  return { address, message, signature };
}

function readAuth(): { address: string; message: string; signature: string } | null {
  const raw = sessionStorage.getItem("tc.merchantAuth");
  if (!raw) return null;
  try {
    return JSON.parse(raw) as { address: string; message: string; signature: string };
  } catch {
    sessionStorage.removeItem("tc.merchantAuth");
    return null;
  }
}

function authHeaders(auth: { address: string; message: string; signature: string }): HeadersInit {
  return {
    "x-merchant-address": auth.address,
    "x-merchant-message": auth.message,
    "x-merchant-signature": auth.signature,
  };
}

function table(invoices: InvoiceRecord[]): string {
  if (invoices.length === 0) return `<p>No invoices found.</p>`;
  return `
    <div class="card" style="margin-top: 1rem; overflow:auto">
      <table>
        <thead><tr><th>ID</th><th>Status</th><th>Price</th><th>Token</th><th>Address</th><th>Sweep tx</th></tr></thead>
        <tbody>
          ${invoices.map((invoice) => `
            <tr>
              <td class="mono">${escapeHtml(short(invoice.id))}</td>
              <td>${escapeHtml(invoice.status)}</td>
              <td>$${escapeHtml(invoice.priceUsd)}</td>
              <td>${escapeHtml(invoice.token ?? "-")}</td>
              <td class="mono">${escapeHtml(invoice.invoiceAddress ? short(invoice.invoiceAddress) : "-")}</td>
              <td class="mono">${escapeHtml(invoice.sweepTx ? short(invoice.sweepTx) : "-")}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function short(value: string): string {
  return value.length > 18 ? `${value.slice(0, 10)}...${value.slice(-6)}` : value;
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
