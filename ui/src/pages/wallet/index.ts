import { renderWalletHome } from "./home.js";
import { renderWalletCreate } from "./create.js";
import { renderWalletSecurity } from "./security.js";
import { renderWalletPair } from "./pair.js";
import { renderWalletSend } from "./send.js";
import { renderWalletReceive } from "./receive.js";

export async function renderWallet(root: HTMLElement): Promise<void> {
  const path = location.pathname;
  if (path === "/wallet/security") {
    await renderWalletSecurity(root);
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
  await renderWalletHome(root);
}
