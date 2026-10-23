import { useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { PageHero } from "@/components/PageHero";
import { PageCard } from "@/components/PageSplit";
import { SITE } from "@/shared/site";

export const GENERATOR_META = {
  title: "Free Crypto Invoice Generator (USDC, USDT) | Trustless Commerce",
  description:
    "Draft a crypto invoice in your browser and print or save it as a PDF. Nothing is uploaded or stored. Turn it into a payable link when you are ready.",
};

const FAQ = [
  { q: "Is my invoice data stored or sent anywhere?", a: "No. The preview is generated in your browser. The fields are not put in the URL, saved, or sent to analytics." },
  { q: "Can my customer pay this PDF?", a: "The PDF is a record only. To accept a payment, create a payable invoice with its own deposit address and pay link." },
  { q: "Which stablecoins and networks are supported?", a: "The create flow lists what is enabled on this deployment; see the public roadmap for rollout status." },
];

export function InvoiceGeneratorPage() {
  const [seller, setSeller] = useState("");
  const [customer, setCustomer] = useState("");
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [token, setToken] = useState("USDC");
  const [number, setNumber] = useState("INV-001");
  const today = new Date().toISOString().slice(0, 10);

  const faqLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: FAQ.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })),
  };

  return (
    <div className="mx-auto max-w-5xl px-4 pb-14 pt-10 md:px-8">
      <div className="print:hidden">
        <PageHero
          breadcrumb="Free tool"
          title="Free crypto invoice generator"
          lede="Fill in the details, check the preview, then print or save it as a PDF. It all stays in your browser."
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <PageCard className="space-y-4 print:hidden">
          {[
            ["Invoice number", number, setNumber],
            ["From (your name or business)", seller, setSeller],
            ["Bill to", customer, setCustomer],
            ["Amount", amount, setAmount],
          ].map(([label, value, set]) => (
            <div key={label as string} className="space-y-1.5">
              <Label>{label as string}</Label>
              <Input
                value={value as string}
                inputMode={label === "Amount" ? "decimal" : undefined}
                onChange={(e) => (set as (v: string) => void)(e.target.value)}
              />
            </div>
          ))}
          <div className="space-y-1.5">
            <Label>Stablecoin</Label>
            <select
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={token}
              onChange={(e) => setToken(e.target.value)}
            >
              <option>USDC</option>
              <option>USDT</option>
            </select>
          </div>
          <div className="space-y-1.5">
            <Label>Description</Label>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={4} />
          </div>
          <div className="flex flex-wrap gap-3">
            <Button onClick={() => window.print()}>Print / Save as PDF</Button>
            <Button asChild variant="secondary">
              <Link to="/create">Make it payable</Link>
            </Button>
          </div>
        </PageCard>

        <PageCard id="invoice-preview" aria-label="Invoice preview" className="space-y-4">
          <h2 className="text-xl font-semibold">Invoice {number}</h2>
          <p className="text-sm text-muted-foreground">Date: {today}</p>
          <p className="text-sm">
            <span className="font-medium">From:</span> {seller || "—"}
          </p>
          <p className="text-sm">
            <span className="font-medium">Bill to:</span> {customer || "—"}
          </p>
          <p className="whitespace-pre-wrap text-sm">{description || "—"}</p>
          <p className="text-lg font-semibold">
            Total: {amount || "0.00"} {token}
          </p>
          <p className="text-xs text-muted-foreground">
            Draft for your records. Payment instructions are only valid on a payable invoice created with Trustless Commerce.
          </p>
        </PageCard>
      </div>

      <section className="mt-16 space-y-4 print:hidden">
        <h2 className="text-2xl font-semibold tracking-tight">Questions</h2>
        <dl className="space-y-4">
          {FAQ.map((f) => (
            <div key={f.q}>
              <dt className="text-base font-semibold">{f.q}</dt>
              <dd className="mt-1 text-sm text-muted-foreground">{f.a}</dd>
            </div>
          ))}
        </dl>
        <p className="text-sm text-muted-foreground">
          See also <Link className="underline" to="/crypto-invoices">crypto invoices</Link> and the{" "}
          <Link className="underline" to="/guides/accept-usdc-payments">guide to accepting USDC</Link>.{" "}
          <a className="underline" href={`${SITE.githubUrl}/blob/main/ROADMAP.md`} target="_blank" rel="noopener noreferrer">Roadmap</a>
        </p>
      </section>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqLd) }} />
    </div>
  );
}
