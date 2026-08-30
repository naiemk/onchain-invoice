import { renderWalletHome } from "./home.js";
import { renderWalletCreate } from "./create.js";
import { renderWalletSecurity } from "./security.js";
import { renderWalletPair } from "./pair.js";
import { renderWalletSend } from "./send.js";
import { renderWalletReceive } from "./receive.js";
import { renderWalletDeposit } from "./deposit.js";
import { renderWalletWithdraw } from "./withdraw.js";
import { renderWalletOfframpCashout } from "./offramp-cashout.js";
import { renderWalletRecover } from "./recover.js";
import { renderWalletCash } from "./cash.js";
import { renderWalletGetPaid } from "./get-paid.js";
import { renderWalletDevelopers } from "./developers.js";

export async function renderWallet(root: HTMLElement): Promise<void> {
  const path = location.pathname;
  if (path === "/wallet/security") {
    await renderWalletSecurity(root);
    return;
  }
  if (path === "/wallet/recover") {
    await renderWalletRecover(root);
    return;
  }
  if (path === "/wallet/create") {
    await renderWalletCreate(root);
    return;
  }
  if (path === "/wallet/pair") {
    await renderWalletPair(root);
    return;
  }
  if (path === "/wallet/send") {
    await renderWalletSend(root);
    return;
  }
  if (path === "/wallet/receive") {
    await renderWalletReceive(root);
    return;
  }
  if (path === "/wallet/cash") {
    await renderWalletCash(root);
    return;
  }
  if (path === "/wallet/get-paid") {
    await renderWalletGetPaid(root);
    return;
  }
  if (path === "/wallet/developers") {
    await renderWalletDevelopers(root);
    return;
  }
  if (path === "/wallet/deposit") {
    await renderWalletDeposit(root);
    return;
  }
  if (path === "/wallet/withdraw") {
    await renderWalletWithdraw(root);
    return;
  }
  if (path === "/wallet/offramp/cashout") {
    await renderWalletOfframpCashout(root);
    return;
  }
  await renderWalletHome(root);
}
