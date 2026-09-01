import { LegacyMount } from "@/components/LegacyMount";
import { PageHero } from "@/components/PageHero";
import { renderMerchant } from "@/pages/merchant.js";

/** Merchant invoice list — legacy renderer inside redesigned shell. */
export function MerchantPage() {
  return (
    <div className="legacy-page mx-auto max-w-5xl px-4 py-10 md:px-8">
      <PageHero breadcrumb="GET PAID / INVOICES" title="Open invoices." lede="Who owes what, and whether payment landed on-chain." />
      <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
        <LegacyMount render={renderMerchant} />
      </div>
    </div>
  );
}
