import { Navigate } from "react-router-dom";

/** Redirect legacy wallet developers route to site-level page. */
export function WalletDevelopersRedirect() {
  return <Navigate to="/developers" replace />;
}
