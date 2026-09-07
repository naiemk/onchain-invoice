/** Map bundler / UserOp reject codes to wallet UI copy. */
export function formatSendRejectReason(
  reason: string | null | undefined,
  t: (key: string, vars?: Record<string, string | number>) => string
): string {
  switch (reason) {
    case "signature_invalid":
      return t("wallet.userOpSignatureInvalid");
    case "insufficient_balance":
      return t("wallet.userOpInsufficientBalance");
    case "simulation_revert":
      return t("wallet.userOpSimulationRevert");
    case "execution_reverted":
      return t("wallet.userOpExecutionReverted");
    case "prefund_failed":
      return t("wallet.userOpPrefundFailed");
    case "no_signatures":
      return t("wallet.proposalsAwaitingSignatures");
    case "already_executed":
      return t("wallet.proposalsExecuted");
    case "rpc_unavailable":
      return t("wallet.bundlerNotConfigured");
    default:
      if (reason?.startsWith("simulation_revert:")) return t("wallet.userOpSimulationRevert");
      return reason && reason !== "failed" && reason !== "rejected"
        ? reason
        : t("wallet.sendFailed");
  }
}
