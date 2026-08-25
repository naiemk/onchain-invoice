/**
 * Declarative fiat-field cascade rules for the create-invoice wizard.
 *
 * Dependency graph (pairs = selected chainId:token from step 2):
 *
 *   currency | country | pairs  →  refetch methods, then providers
 *   payment method              →  refetch providers only
 *   provider                    →  local reselect from quotes[] (no refetch)
 *   amount                      →  refetch providers (debounced)
 *   max drift                   →  nothing (stored on invoice; enforced at pay time)
 *
 * Defaults are Auto for method and provider. Auto means omit the explicit value
 * and take the server's `recommended`. A remembered preference overrides Auto
 * only when it still appears in the freshly fetched option list.
 */

export type FiatField =
  | "currency"
  | "country"
  | "pairs"
  | "paymentMethod"
  | "provider"
  | "amount"
  | "drift";

export type FiatAction = "refetchMethods" | "refetchProviders" | "reselectProvider" | "none";

export type FiatCascadeRule = {
  field: FiatField;
  /** Ordered actions to run when `field` changes. */
  actions: FiatAction[];
  /** Reset these selects to remembered-if-still-offered / Auto after refetch. */
  reset?: Array<"paymentMethod" | "provider">;
  /** Debounce ms before running (amount only). */
  debounceMs?: number;
};

/** Single source of truth — mirrored in docs/invoice-types.md and the AI skill. */
export const FIAT_CASCADE_RULES: readonly FiatCascadeRule[] = [
  {
    field: "currency",
    actions: ["refetchMethods", "refetchProviders"],
    reset: ["paymentMethod", "provider"],
  },
  {
    field: "country",
    actions: ["refetchMethods", "refetchProviders"],
    reset: ["paymentMethod", "provider"],
  },
  {
    field: "pairs",
    actions: ["refetchMethods", "refetchProviders"],
    reset: ["paymentMethod", "provider"],
  },
  {
    field: "paymentMethod",
    actions: ["refetchProviders"],
    reset: ["provider"],
  },
  {
    field: "provider",
    actions: ["reselectProvider"],
  },
  {
    field: "amount",
    actions: ["refetchProviders"],
    debounceMs: 400,
  },
  {
    field: "drift",
    actions: ["none"],
  },
] as const;

export function ruleFor(field: FiatField): FiatCascadeRule {
  const rule = FIAT_CASCADE_RULES.find((r) => r.field === field);
  if (!rule) return { field, actions: ["none"] };
  return rule;
}

/** Empty string means Auto — omit from request, take server recommended. */
export const AUTO_VALUE = "";
