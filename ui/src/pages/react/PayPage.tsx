import { LegacyMount } from "@/components/LegacyMount";
import { PageHero } from "@/components/PageHero";
import { renderPay } from "@/pages/pay.js";

/** Pay checkout — legacy renderer inside redesigned shell. */
export function PayPage() {
  return (
    <div className="legacy-page mx-auto max-w-3xl px-4 py-10 md:px-8">
      <PageHero breadcrumb="CHECKOUT" title="Complete your payment." lede="Send the exact amount on the network shown below." />
      <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
        <LegacyMount render={renderPay} />
      </div>
    </div>
  );
}
