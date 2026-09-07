import { Navigate } from "react-router-dom";
import { useWalletPolicy } from "./wallet-policy";

/** Super Wallet has no recovery. Simple wallets keep Security #recovery. */
export function RecoverPage() {
  const { isSuperWallet } = useWalletPolicy();
  if (isSuperWallet) return <Navigate to="/wallet/access" replace />;
  return <Navigate to="/wallet/security#recovery" replace />;
}
