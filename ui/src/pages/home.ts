import { encodePayLink } from "../shared/invoice.js";
import { howCreateArt, howPayArt, howSettleArt } from "../shared/how-graphics.js";
import { deploymentMode, networksForDeployment } from "../shared/networks.js";
import { randomInvoiceSeed } from "../onchain-invoice-browser.js";
import { SITE } from "../shared/site.js";

function chip(label: string, kind: "muted" | "warn" | "ok" | "accent" = "muted"): string {
  return `<span class="cmp-chip cmp-chip-${kind}">${label}</span>`;
}

export function renderHome(root: HTMLElement): void {
  const mode = deploymentMode();
  const networks = networksForDeployment(mode);
  const demoChain = networks[0]?.id ?? (mode === "testnet" ? "11155111" : "1");
  const demoToken = demoChain === "nile" ? "USDT" : "USDC";
  const invoiceSeed = randomInvoiceSeed();
  const demo = {
    price: "0.01",
    to: ["0xc2eCF8b48b9D5D1Fd04b8A9c15126011aa1cC3Eb"],
    chains: [demoChain],
    tokens: [demoToken],
    invoiceSeed,
    clientInvoiceId: `order-${invoiceSeed.slice(2, 14).toLowerCase()}`,
    callback: "",
    title: "Demo invoice",
    description:
      mode === "testnet" ? "Try a Sepolia USDC or Nile USDT test payment." : "Try a USDC payment.",
    allowPartial: false,
  };
  const demoLink = `/pay?${encodePayLink(demo)}`;

  root.innerHTML = `
    <section class="landing-hero">
      <div>
        <p class="brand-hero">Trustless Commerce</p>
        <h1>Crypto invoices your customers can pay today.</h1>
        <p class="lede">
          Create a payment link, share it, and get paid on-chain — without opening an account
          or waiting on compliance review.
        </p>
        <div class="cta-row">
          <a class="tc-btn" href="/create" data-route>Create an invoice</a>
          <a class="tc-btn secondary" href="${demoLink}" target="_blank" rel="noopener noreferrer">See a live checkout</a>
        </div>
      </div>
      <aside class="hero-shopify" aria-hidden="true">
        <div class="shopify-shot">
          <div class="shopify-shot-inner">
            <p class="shopify-store">Northline Supply</p>
            <p class="shopify-step">Checkout</p>
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
                <p class="shopify-product">Canvas weekender bag</p>
                <p class="shopify-variant">Natural · Qty 1</p>
              </div>
              <p class="shopify-price">$128.00</p>
            </div>
            <div class="shopify-totals">
              <div><span>Subtotal</span><span>$128.00</span></div>
              <div><span>Shipping</span><span>Free</span></div>
              <div class="shopify-total"><span>Total</span><span>$128.00</span></div>
            </div>
            <div class="shopify-pay">
              <span class="shopify-crypto">Pay with crypto</span>
            </div>
          </div>
        </div>
        <p class="shopify-caption">Example Shopify checkout with Pay with crypto</p>
      </aside>
    </section>

    <section class="section" id="agents">
      <p class="eyebrow">AI agents</p>
      <h2>Invoice skill for coding agents</h2>
      <p class="section-lede">
        Bots and assistants can create pay links and poll status from the published Cursor skill —
        no merchant dashboard required.
      </p>
      <p>
        <a
          id="agent-skill"
          class="agent-skill-link"
          href="${SITE.agentSkillUrl}"
          rel="alternate noopener noreferrer"
          target="_blank"
          data-agent-skill="trustless-commerce-invoice"
        >AI agent skill (SKILL.md)</a>
        ·
        <a href="${SITE.agentsDocsUrl}" target="_blank" rel="noopener noreferrer">Agent docs</a>
      </p>
      <p class="field-hint mono">${SITE.agentSkillPath}</p>
    </section>

    <section class="section">
      <p class="eyebrow">Why shops switch</p>
      <h2>From idea to paid invoice before your coffee cools.</h2>
      <p class="section-lede">
        Fill in amount and wallet, copy a pay button into your site, and you’re live.
        No developer ticket queue, no merchant dashboard signup wall.
      </p>
      <div class="feature-row">
        <article>
          <h3>About a minute to go live</h3>
          <p>Generate a pay link with the fields you already know from your order system.</p>
        </article>
        <article>
          <h3>Skip the paperwork</h3>
          <p>No registration and no KYC. Your settlement address is part of the invoice itself.</p>
        </article>
        <article>
          <h3>Drop in without an integration project</h3>
          <p>Paste a link or HTML button. Wire the API later when you’re ready to automate.</p>
        </article>
      </div>
    </section>

    <section class="section">
      <p class="eyebrow">Getting started</p>
      <h2>What it takes elsewhere vs here</h2>
      <p class="section-lede">
        Most crypto payment products ask you to join their platform first. We ask for an invoice.
      </p>
      <p class="compare-callout">No signup wall. Settlement is on-chain to your address.</p>
      <div class="compare-wrap">
        <table class="compare-table">
          <thead>
            <tr>
              <th class="sticky-col">Step</th>
              <th>BitPay</th>
              <th>Coinbase Commerce</th>
              <th>NOWPayments</th>
              <th>BTCPay Server</th>
              <th class="highlight-col">
                <span class="ours-pill">Ours</span>
                Trustless Commerce
              </th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td class="sticky-col">Create an account</td>
              <td>${chip("Account", "warn")}</td>
              <td>${chip("Account", "warn")}</td>
              <td>${chip("Account", "warn")}</td>
              <td>${chip("Self-host", "muted")}</td>
              <td class="highlight-col">${chip("None", "ok")}</td>
            </tr>
            <tr>
              <td class="sticky-col">Identity / business checks</td>
              <td>${chip("KYC", "warn")}</td>
              <td>${chip("Verify", "warn")}</td>
              <td>${chip("Often KYC", "warn")}</td>
              <td>${chip("Varies", "muted")}</td>
              <td class="highlight-col">${chip("None", "ok")}</td>
            </tr>
            <tr>
              <td class="sticky-col">Time to first invoice</td>
              <td>${chip("Days", "muted")}</td>
              <td>${chip("Hours–days", "muted")}</td>
              <td>${chip("Hours", "muted")}</td>
              <td>${chip("Setup hours", "muted")}</td>
              <td class="highlight-col">${chip("~1 min", "accent")}</td>
            </tr>
            <tr>
              <td class="sticky-col">Who controls settlement</td>
              <td>${chip("Processor", "muted")}</td>
              <td>${chip("Processor", "muted")}</td>
              <td>${chip("Processor", "muted")}</td>
              <td>${chip("Your node", "muted")}</td>
              <td class="highlight-col">${chip("Your wallet", "accent")}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <section class="section">
      <p class="eyebrow">How it works</p>
      <h2>Trustless invoices that can only settle to you.</h2>
      <p class="section-lede">
        No custodian in the middle. The payment address is derived so your wallet is part of the invoice itself.
      </p>
      <div class="how-grid">
        <article class="how-card how-card-1">
          <div class="how-art-wrap">${howCreateArt()}</div>
          <span class="how-step">1</span>
          <h3>Create the invoice</h3>
          <p>Set the amount and your wallet. Share a pay link — we create the invoice id when payment starts. No account required.</p>
        </article>
        <article class="how-card how-card-2">
          <div class="how-art-wrap">${howPayArt()}</div>
          <span class="how-step">2</span>
          <h3>Customer pays a unique address</h3>
          <p>Checkout activates a deterministic payment address for that invoice on the network they choose.</p>
        </article>
        <article class="how-card how-card-3">
          <div class="how-art-wrap">${howSettleArt()}</div>
          <span class="how-step">3</span>
          <h3>Only your wallet receives settlement</h3>
          <p>CREATE2 salt binds merchant <span class="mono">to</span>. A sweep can take the fee — it cannot redirect your funds.</p>
        </article>
      </div>
    </section>

    <section class="section">
      <div class="security-band">
        <p class="eyebrow">Security guarantee</p>
        <h2>Paid only to you — enforced by the contract, not a promise.</h2>
        <p>
          Each invoice address is derived so the merchant recipient is baked into the CREATE2 salt.
          A sweep can collect the platform fee, but it cannot redirect settlement away from the
          wallet encoded in the invoice. You don’t need to trust a company ledger. Trust the chain.
        </p>
      </div>
    </section>

    <section class="section section-narrow" style="text-align:center">
      <h2>Ready when your customer is.</h2>
      <p class="section-lede" style="margin-left:auto;margin-right:auto">
        Create your first invoice now, or embed a pay button and check status over HTTP when you automate.
      </p>
      <div class="cta-row" style="justify-content:center">
        <a class="tc-btn" href="/create" data-route>Create an invoice</a>
        <a class="tc-btn secondary" href="/create#docs" data-route>View API docs</a>
      </div>
    </section>

    <footer class="site-footer">
      <span>Trustless Commerce</span>
      <span>
        <a href="/create" data-route>Create</a>
        ·
        <a href="/merchant" data-route>Merchant</a>
        ·
        <a href="${SITE.agentSkillUrl}" rel="alternate noopener noreferrer" target="_blank" data-agent-skill="trustless-commerce-invoice">AI skill</a>
      </span>
    </footer>
  `;
}
