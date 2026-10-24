import { SITE } from "@/shared/site";

export interface LandingContent {
  path: string;
  metaTitle: string;
  metaDescription: string;
  eyebrow: string;
  h1: string;
  lede: string;
  primaryCta: { label: string; to: string };
  secondaryCta: { label: string; to: string; external?: boolean };
  steps: { title: string; body: string }[];
  points: { title: string; body: string }[];
  faq: { q: string; a: string }[];
  related: string[];
}

const STATUS_FAQ = {
  q: "Which networks and stablecoins are live?",
  a: "The create flow shows exactly which networks and tokens are enabled on this deployment. Testnet support and mainnet rollout are tracked publicly in the roadmap, so check it before taking real payments.",
};
const FEE_FAQ = {
  q: "What does it cost?",
  a: "There is no account fee to create an invoice. When an invoice is swept, the sweeper contract sends the amount minus a platform fee to your address (default 0.5% with per-token minimums, as documented in the repository README); confirm the current rate in the docs before launch.",
};

export const ROADMAP_URL = `${SITE.githubUrl}/blob/main/ROADMAP.md`;

export const LANDING_PAGES: LandingContent[] = [
  {
    path: "/stablecoin-payments",
    metaTitle: "Accept Stablecoin Payments, Non-Custodial | Trustless Commerce",
    metaDescription:
      "Accept USDC and USDT payments that settle to your own address. Each invoice gets a unique on-chain deposit address, with no account required to create one.",
    eyebrow: "Stablecoin payments",
    h1: "Accept stablecoin payments straight to your wallet",
    lede: "Create an invoice, share the pay link, and get paid in stablecoins. Funds are swept to the address you chose, not held in a Trustless Commerce account.",
    primaryCta: { label: "Create an invoice", to: "/create" },
    secondaryCta: { label: "Explore the API", to: "/developers/crypto-payment-api" },
    steps: [
      { title: "Create", body: "Enter an amount and your receiving address. No account or sign-up is needed to create an invoice." },
      { title: "Customer pays", body: "The customer sends a supported stablecoin to the invoice's unique deposit address, or uses the hosted checkout." },
      { title: "Payment detected", body: "The invoice moves from awaiting_payment to paid once the transfer is seen on-chain." },
      { title: "You receive funds", body: "A sweeper forwards the payment, minus the platform fee, to your address and the invoice becomes swept." },
    ],
    points: [
      { title: "Non-custodial payout", body: "The deposit address is derived deterministically from your receiving address and the invoice id, so the sweeper cannot redirect funds to another recipient." },
      { title: "Hosted checkout", body: "Share a pay link or embed checkout; customers do not need to create an account." },
      { title: "Clear states", body: "Created, awaiting payment, paid, partially paid and swept are distinct, so you always know whether money has arrived or settled." },
    ],
    faq: [
      STATUS_FAQ,
      FEE_FAQ,
      { q: "Is this custodial?", a: "No. Payments go to a per-invoice address and are swept to the receiving address you set. Read the security page for the trust model and its limits." },
    ],
    related: ["/crypto-invoices", "/crypto-payment-links", "/developers/crypto-payment-api", "/security"],
  },
  {
    path: "/crypto-invoices",
    metaTitle: "Create Crypto Invoices (USDC, USDT) | Trustless Commerce",
    metaDescription:
      "Create a crypto invoice in about a minute: set an amount, choose your receiving address, and send the pay link. Track created, paid and swept states.",
    eyebrow: "Crypto invoices",
    h1: "Create and send a crypto invoice",
    lede: "Bill clients in stablecoins with a shareable invoice. Each one has its own deposit address and a status you can check at any time.",
    primaryCta: { label: "Create a crypto invoice", to: "/create" },
    secondaryCta: { label: "Read the invoice docs", to: `${SITE.docsUrl}invoice-types/`, external: true },
    steps: [
      { title: "Set the amount and title", body: "Price the invoice in a stablecoin and optionally allow partial payments." },
      { title: "Choose where you get paid", body: "Enter your own address. Multi-network invoices can list both EVM and Tron addresses." },
      { title: "Send the link", body: "Share the pay link with your customer. They pay from any compatible wallet." },
      { title: "Track status", body: "Watch the invoice move from awaiting payment to paid to swept in your merchant view or through the API." },
    ],
    points: [
      { title: "No sign-up to create", body: "Creating an invoice does not require connecting a wallet or making an account." },
      { title: "Payment states you can trust", body: "Paid means the transfer was observed; swept means the payout to your address completed." },
      { title: "Works for people and software", body: "Use the web builder, or call the same flow from the API or an AI agent." },
    ],
    faq: [
      STATUS_FAQ,
      FEE_FAQ,
      { q: "Can customers pay part of an invoice?", a: "Yes, if you enable partial payments when creating it. Such invoices can show a paid_partial state." },
    ],
    related: ["/crypto-payment-links", "/stablecoin-payments", "/developers/crypto-payment-api"],
  },
  {
    path: "/crypto-payment-links",
    metaTitle: "Crypto Payment Links for Stablecoins | Trustless Commerce",
    metaDescription:
      "Generate a shareable crypto payment link for USDC or USDT. Customers open the hosted checkout and pay to a unique address that settles to you.",
    eyebrow: "Payment links",
    h1: "Share a crypto payment link",
    lede: "Turn an amount into a link you can paste into chat, email or a website button. The checkout page tells your customer exactly what to send and where.",
    primaryCta: { label: "Create a payment link", to: "/create" },
    secondaryCta: { label: "See the integrations", to: "/integrations" },
    steps: [
      { title: "Build the link", body: "Choose amount, token, network and your receiving address in the invoice builder." },
      { title: "Share it", body: "Send the link anywhere, or embed the checkout on your own page." },
      { title: "Customer pays", body: "The checkout shows the deposit address and updates when payment is detected." },
    ],
    points: [
      { title: "One link per order", body: "Use your own order reference so each link maps back to a sale in your system." },
      { title: "Embeddable checkout", body: "The pay page is designed to be embedded on merchant sites." },
      { title: "Platform plugins", body: "WooCommerce, Shopify and other platform adapters are listed on the integrations page with their current status." },
    ],
    faq: [STATUS_FAQ, FEE_FAQ],
    related: ["/crypto-invoices", "/stablecoin-payments", "/integrations"],
  },
  {
    path: "/developers/crypto-payment-api",
    metaTitle: "Crypto Invoice & Stablecoin Payment API | Trustless Commerce",
    metaDescription:
      "Create stablecoin invoices with one POST /api/invoices call and poll status with GET /api/invoices/:id. Non-custodial per-invoice addresses, rate limits documented.",
    eyebrow: "Developers",
    h1: "A crypto invoice API for stablecoin checkout",
    lede: "One request creates an invoice with its deposit address and pay link. Poll its status, or hand the integration skill to your coding agent.",
    primaryCta: { label: "Read the API docs", to: `${SITE.docsUrl}api/`, external: true },
    secondaryCta: { label: "Developer overview", to: "/developers" },
    steps: [
      { title: "POST /api/invoices", body: "Send price, receiving addresses, chains, tokens and your own clientInvoiceId. The response includes invoiceAddress, a payLink and the awaiting_payment status." },
      { title: "Show checkout", body: "Redirect the customer to the pay link or render the address and amount yourself." },
      { title: "GET /api/invoices/:id", body: "Poll for status and events. Treat paid as received funds and swept as settled to the merchant." },
    ],
    points: [
      { title: "Server-assigned seeds", body: "The API assigns the invoice seed; client-supplied seeds are rejected, so ids cannot be chosen or replayed." },
      { title: "Documented rate limits", body: "Create is limited to roughly one request per second per IP; 429 responses include Retry-After headers." },
      { title: "Agent-ready", body: "A published skill file describes the create and status flow for AI agents." },
    ],
    faq: [
      STATUS_FAQ,
      { q: "Do I need an API key to create invoices?", a: "No. Create and status endpoints are public and rate limited. Merchant listing is wallet-signed." },
      { q: "Are there webhooks?", a: "Platform integrations use webhook-style notifications; see the platform integration docs for the current contract, and use status polling otherwise." },
    ],
    related: ["/developers", "/integrations", "/crypto-invoices"],
  },
];

export function landingFor(path: string): LandingContent | undefined {
  return LANDING_PAGES.find((p) => p.path === path);
}
