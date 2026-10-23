import { Link } from "react-router-dom";
import { PageHero } from "@/components/PageHero";
import { SITE } from "@/shared/site";

export interface Guide {
  path: string;
  metaTitle: string;
  metaDescription: string;
  h1: string;
  lede: string;
  sections: { heading: string; body: string; code?: string }[];
  cta: { label: string; to: string };
}

export const GUIDES: Guide[] = [
  {
    path: "/guides/accept-usdc-payments",
    metaTitle: "How to Accept USDC Payments on Your Website | Trustless Commerce",
    metaDescription:
      "Step-by-step: create a USDC invoice with one API call, send the customer to checkout, and confirm payment by polling status. Testnet example included.",
    h1: "How to accept USDC payments on your website",
    lede: "This guide uses the public invoice API. The example targets Ethereum Sepolia testnet; check the create flow for networks enabled on mainnet before taking real payments.",
    sections: [
      {
        heading: "1. Create an invoice",
        body: "Send one POST request with the price, your receiving address, the chain and token. Replace 0x… with your own address. Do not send an invoice seed; the API assigns one.",
        code: `POST /api/invoices
Content-Type: application/json

{
  "price": "10.00",
  "to": ["0x…"],
  "chains": ["11155111"],
  "tokens": ["USDC"],
  "clientInvoiceId": "order-1",
  "chainId": "11155111",
  "token": "USDC",
  "selectedTo": "0x…",
  "title": "Order",
  "allowPartial": false,
  "paymentMode": "crypto"
}`,
      },
      {
        heading: "2. Send the customer to checkout",
        body: "The response contains invoice.invoiceAddress, a payLink and the status awaiting_payment. Redirect the customer to the pay link, or show the address and amount yourself.",
      },
      {
        heading: "3. Confirm payment",
        body: "Poll GET /api/invoices/:id. Treat paid as funds received on-chain and swept as settled to your address. Partially paid invoices show paid_partial when partial payments are allowed.",
        code: "GET /api/invoices/:id",
      },
      {
        heading: "4. Respect rate limits",
        body: "Creating invoices is limited to roughly one request per second per IP. A 429 response includes Retry-After; back off instead of retrying immediately.",
      },
    ],
    cta: { label: "Create an invoice", to: "/create" },
  },
];

export function guideFor(path: string): Guide | undefined {
  return GUIDES.find((g) => g.path === path);
}

export function GuidePage({ guide }: { guide: Guide }) {
  const ld = {
    "@context": "https://schema.org",
    "@type": "TechArticle",
    headline: guide.h1,
    description: guide.metaDescription,
    mainEntityOfPage: `${SITE.origin}${guide.path}`,
  };
  return (
    <article className="mx-auto max-w-3xl px-4 pb-14 pt-10 md:px-8">
      <PageHero breadcrumb="Guide" title={guide.h1} lede={guide.lede} />
      {guide.sections.map((s) => (
        <section key={s.heading} className="mt-8 space-y-3">
          <h2 className="text-xl font-semibold">{s.heading}</h2>
          <p className="text-sm text-muted-foreground md:text-base">{s.body}</p>
          {s.code && (
            <pre className="overflow-x-auto rounded-lg border border-border bg-muted p-4 text-xs">
              <code>{s.code}</code>
            </pre>
          )}
        </section>
      ))}
      <p className="mt-10 flex flex-wrap gap-x-5 gap-y-1 text-sm">
        <Link className="font-medium underline underline-offset-4" to={guide.cta.to}>
          {guide.cta.label}
        </Link>
        <Link className="underline underline-offset-4" to="/developers/crypto-payment-api">
          Payment API
        </Link>
        <Link className="underline underline-offset-4" to="/tools/crypto-invoice-generator">
          Free invoice generator
        </Link>
      </p>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(ld) }} />
    </article>
  );
}
