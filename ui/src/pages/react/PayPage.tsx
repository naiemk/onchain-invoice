import { LegacyMount } from "@/components/LegacyMount";
import { renderPay } from "@/pages/pay.js";

/** Pay checkout — legacy renderer inside shadcn shell. */
export function PayPage() {
  return (
    <div className="legacy-page min-h-[60vh]">
      <LegacyMount render={renderPay} />
    </div>
  );
}
