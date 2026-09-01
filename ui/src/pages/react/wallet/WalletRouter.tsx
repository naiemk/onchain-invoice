import { Navigate, Route, Routes } from "react-router-dom";
import { HomePage } from "./HomePage";
import { CreatePage } from "./CreatePage";
import { SendPage } from "./SendPage";
import { ReceivePage } from "./ReceivePage";
import { CashPage } from "./CashPage";
import { DepositPage } from "./DepositPage";
import { WithdrawPage } from "./WithdrawPage";
import { SecurityPage } from "./SecurityPage";
import { PairPage } from "./PairPage";
import { RecoverPage } from "./RecoverPage";
import { GetPaidPage } from "./GetPaidPage";
import { WalletDevelopersRedirect } from "./WalletDevelopersRedirect";
import { SuperWalletPage } from "./SuperWalletPage";
import { ProposalsPage } from "./ProposalsPage";
import { JoinSuperPage } from "./JoinSuperPage";
import { OfframpCashoutPage } from "./OfframpCashoutPage";
import { InvoicesPage } from "./InvoicesPage";

export function WalletRouter() {
  return (
    <Routes>
      <Route index element={<HomePage />} />
      <Route path="create" element={<CreatePage />} />
      <Route path="security" element={<SecurityPage />} />
      <Route path="recover" element={<RecoverPage />} />
      <Route path="pair" element={<PairPage />} />
      <Route path="join-super" element={<JoinSuperPage />} />
      <Route path="send" element={<SendPage />} />
      <Route path="receive" element={<ReceivePage />} />
      <Route path="cash" element={<CashPage />} />
      <Route path="get-paid" element={<GetPaidPage />} />
      <Route path="developers" element={<WalletDevelopersRedirect />} />
      <Route path="invoices" element={<InvoicesPage />} />
      <Route path="super-wallet" element={<SuperWalletPage />} />
      <Route path="proposals" element={<ProposalsPage />} />
      <Route path="deposit" element={<DepositPage />} />
      <Route path="withdraw" element={<WithdrawPage />} />
      <Route path="offramp/cashout" element={<OfframpCashoutPage />} />
      <Route path="*" element={<Navigate to="/wallet" replace />} />
    </Routes>
  );
}
