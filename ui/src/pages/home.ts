import { encodePayLink } from "../shared/invoice.js";

export function renderHome(root: HTMLElement): void {
  const example = {
    price: "0.01",
    to: ["0xc2eCF8b48b9D5D1Fd04b8A9c15126011aa1cC3Eb"],
    chains: ["11155111"],
    tokens: ["ETH", "USDC"],
    clientInvoiceId: `order-${Date.now()}`,
    callback: "",
    title: "Sepolia test invoice",
    description: "Pay with Sepolia ETH or USDC. Merchant to is salt-bound.",
    allowPartial: false,
  };
  const link = `/pay?${encodePayLink(example)}`;
  const embed = `<a href="https://trustless.example${link}" class="tc-pay-button">Pay with crypto</a>`;

  root.innerHTML = `
    <section class="hero">
      <div>
        <p class="eyebrow">0.5% platform fee · non-custodial invoice addresses</p>
        <h1>Trustless crypto invoices for shops.</h1>
        <p>
          Accept EVM payments with deterministic CommerceInvoiceSweeper addresses where the CREATE2 salt
          binds the merchant recipient. A sweep can collect the platform fee, but it cannot redirect funds
          away from the merchant <span class="mono">to</span> address encoded into the invoice.
        </p>
        <p>
          Tron follows the typical sweep-later path. Solana support is deferred.
        </p>
        <a class="button" href="${link}" data-route>Try the pay link</a>
      </div>
      <aside class="panel">
        <h2>Embed button</h2>
        <p>Drop a normal link into any shop template. Query parameters become a deterministic invoice id.</p>
        <pre>${escapeHtml(embed)}</pre>
      </aside>
    </section>
    <section class="grid" style="margin-top: 2rem">
      <article class="card">
        <h3>Bound recipient</h3>
        <p>For EVM, the sweeper salt includes merchant <span class="mono">to</span>, so force sweeping cannot redirect settlement.</p>
      </article>
      <article class="card">
        <h3>Simple API</h3>
        <p>Create sessions, activate invoice addresses, track sweeps, and query merchant/admin views over HTTP.</p>
      </article>
      <article class="card">
        <h3>Portable frontend</h3>
        <p>The Vite SPA is ready for Vercel, with client-side routes for pay, merchant, and admin screens.</p>
      </article>
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
