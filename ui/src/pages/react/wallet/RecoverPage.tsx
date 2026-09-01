import { Navigate } from "react-router-dom";

/** Redirect legacy recover route into Security #recovery section. */
export function RecoverPage() {
  return <Navigate to="/wallet/security#recovery" replace />;
}
