import { LegacyMount } from "@/components/LegacyMount";
import { renderMerchant } from "@/pages/merchant.js";

/** Merchant invoice list — legacy renderer inside shadcn shell. */
export function MerchantPage() {
  return (
    <div className="legacy-page">
      <LegacyMount render={renderMerchant} />
    </div>
  );
}
