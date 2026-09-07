import { Navigate } from "react-router-dom";
import { useWalletPolicy } from "./wallet-policy";

/** Super Wallet has no email recovery; land on Security. Simple wallets keep #recovery. */
export function RecoverPage() {
  const { isSuperWallet } = useWalletPolicy();
  if (isSuperWallet) return <Navigate to="/wallet/security" replace />;
  return <Navigate to="/wallet/security#recovery" replace />;
}
