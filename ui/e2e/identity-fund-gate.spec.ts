/**
 * A one-method identity hides its receive address. A second on-chain method reveals it.
 */
import { test, expect } from "@playwright/test";
import { loadLocalStack } from "./helpers/stack.js";
import { addSecondPasskeyOnChain, createWalletFromUi, openDevice } from "./helpers/wallet.js";

test("receive stays hidden until a second on-chain method", async ({ browser }) => {
  const stack = await loadLocalStack();
  const host = await openDevice(browser);
  try {
    await createWalletFromUi(host.page, "Fund Gate");
    await host.page.goto("/wallet/receive");
    await expect(host.page.getByTestId("receive-needs-second-method")).toBeVisible();
    await expect(host.page.getByTestId("receive-address")).toHaveCount(0);

    await host.page.goto("/wallet/send");
    await expect(host.page.getByTestId("send-needs-second-method")).toBeVisible();
    await expect(host.page.locator("#send-recipient")).toBeDisabled();

    await addSecondPasskeyOnChain(host, stack);
    await host.page.goto("/wallet/receive");
    await expect(host.page.getByTestId("receive-address")).toBeVisible({ timeout: 30_000 });
    await expect(host.page.getByTestId("receive-needs-second-method")).toHaveCount(0);
  } finally {
    await host.context.close();
  }
});
