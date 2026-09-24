/**
 * Alice identity wallet + reco1–3 Super Wallet (2-of-3) as IdentityStore recoveryOperator.
 * Four email-restore scenarios against the local Hardhat stack.
 */
import { test, expect } from "@playwright/test";
import { apiBase, loadLocalStack, withWorkerTicks } from "./helpers/stack.js";
import {
  confirmSimpleSend,
  convertIdentitySuper,
  createIdentityWalletFromUi,
  fundUsdc,
  increaseChainTime,
  loginIdentityFromEmail,
  openDevice,
  setStoreRecoveryOperator,
  signOperatorRestoreFromUi,
  signOut,
  startEmailRestore,
  waitForDeployed,
  waitForRestoreCompleted,
  type DeviceSession,
} from "./helpers/wallet.js";
import { emptyDeviceKeys, installE2eWebAuthn } from "./helpers/webauthn-shim.js";
import { installE2eEoa } from "./helpers/eoa.js";

test.describe.serial("identity email restore", () => {
  test.describe.configure({ timeout: 360_000 });

  let reco1: DeviceSession;
  let reco2: DeviceSession;
  let reco3: DeviceSession;
  let superAddress: string;

  test.afterAll(async () => {
    await reco1?.context.close();
    await reco2?.context.close();
    await reco3?.context.close();
  });

  test("reco1–3 convert to 2-of-3 Super and become recoveryOperator", async ({ browser }) => {
    reco1 = await openDevice(browser);
    reco2 = await openDevice(browser);
    reco3 = await openDevice(browser);
    const created1 = await createIdentityWalletFromUi(reco1.page, "Reco One");
    const created2 = await createIdentityWalletFromUi(reco2.page, "Reco Two");
    const created3 = await createIdentityWalletFromUi(reco3.page, "Reco Three");
    superAddress = created1.address;
    await fundUsdc(superAddress, 10_000_000n);
    await waitForDeployed(superAddress);
    await convertIdentitySuper(reco1, [created2.email, created3.email], 2);
    await setStoreRecoveryOperator(superAddress);
  });

  test("unfunded Alice loses her key, 2-of-3 email restore, then logs in", async ({ browser }) => {
    const alice = await openDevice(browser);
    const created = await createIdentityWalletFromUi(alice.page, "Alice Unfunded");
    await signOut(alice);
    const lost = await openDevice(browser);
    await startEmailRestore(lost.page, created.email);
    await signOperatorRestoreFromUi(reco1);
    await signOperatorRestoreFromUi(reco2);
    await waitForRestoreCompleted(created.address);
    await loginIdentityFromEmail(lost.page, created.email);
    await expect(lost.page.getByTestId("wallet-switcher")).toBeVisible();
    await alice.context.close();
    await lost.context.close();
  });

  test("Alice cancels a pending restore with her old key", async ({ browser }) => {
    const alice = await openDevice(browser);
    const created = await createIdentityWalletFromUi(alice.page, "Alice Cancel");
    const lost = await openDevice(browser);
    await startEmailRestore(lost.page, created.email);
    await signOperatorRestoreFromUi(reco1);
    await signOperatorRestoreFromUi(reco2);
    await alice.page.goto("/wallet/security");
    await expect(alice.page.getByTestId("recover-cancel-restore")).toBeVisible({ timeout: 30_000 });
    await alice.page.getByTestId("recover-cancel-restore").click();
    await alice.page.getByTestId("confirm-cancel-restore").click();
    await expect(alice.page.getByText(/Recovery cancelled/i)).toBeVisible({ timeout: 30_000 });
    await withWorkerTicks(["deployer"], async () => {
      await increaseChainTime(2);
      await expect.poll(async () => {
        const res = await fetch(`${apiBase()}/api/wallet/recovery?wallet=${encodeURIComponent(created.address)}`);
        const body = (await res.json()) as { pendingOwner?: { active?: boolean } | null; request?: { status?: string } | null };
        return Boolean(body.pendingOwner?.active) || body.request?.status === "on_chain";
      }).toBe(false);
    });
    await alice.context.close();
    await lost.context.close();
  });

  test("funded Alice restores and pays", async ({ browser }) => {
    const stack = await loadLocalStack();
    const alice = await openDevice(browser);
    const created = await createIdentityWalletFromUi(alice.page, "Alice Funded");
    await fundUsdc(created.address, 5_000_000n);
    await waitForDeployed(created.address);
    await signOut(alice);
    const lost = await openDevice(browser);
    await startEmailRestore(lost.page, created.email);
    await signOperatorRestoreFromUi(reco1);
    await signOperatorRestoreFromUi(reco2);
    await waitForRestoreCompleted(created.address);
    await loginIdentityFromEmail(lost.page, created.email);
    await confirmSimpleSend(lost.page, stack.collectorAddress, "1");
    await alice.context.close();
    await lost.context.close();
  });

  test("disableRestore blocks email recovery", async ({ browser }) => {
    const stack = await loadLocalStack();
    const keys = emptyDeviceKeys();
    const context = await browser.newContext();
    await installE2eWebAuthn(context, keys);
    await installE2eEoa(context, stack.rpcUrl);
    const page = await context.newPage();
    const alice: DeviceSession = { context, page, keys };
    await createIdentityWalletFromUi(alice.page, "Alice Disable");
    await alice.page.goto("/wallet/security");
    await expect(alice.page.getByTestId("devices-card")).toBeVisible({ timeout: 30_000 });
    const added = alice.page.waitForResponse(
      (res) =>
        res.url().includes("/api/identity/methods") && res.request().method() === "POST" && res.status() === 201
    );
    await alice.page.getByRole("button", { name: "Connect wallet" }).click();
    await expect(alice.page.getByTestId("connect-wallet-wizard")).toBeVisible();
    await alice.page.getByTestId("connect-wallet-connect").click();
    await expect(alice.page.getByTestId("connect-wallet-pay-self")).toBeEnabled({ timeout: 15_000 });
    await alice.page.getByTestId("connect-wallet-pay-self").check();
    await alice.page.getByTestId("connect-wallet-next").click();
    await alice.page.getByTestId("connect-wallet-submit").click();
    await added;
    await alice.page.goto("/wallet/security");
    await expect(alice.page.getByTestId("identity-restore-turn-off")).toBeEnabled({ timeout: 15_000 });
    await alice.page.getByTestId("identity-restore-turn-off").click();
    await expect(alice.page.getByText(/Email restore is off/i)).toBeVisible({ timeout: 30_000 });
    await alice.page.goto("/wallet/recover");
    await alice.page.getByRole("tab", { name: "With email" }).click();
    await alice.page.locator("#recover-ack-no-device").click();
    await alice.page.getByRole("button", { name: "Start recovery" }).click();
    await expect(alice.page.getByTestId("email-recover-dialog")).toBeVisible();
    const email = await aliceEmailFromSession(alice);
    await alice.page.locator("#recover-email").fill(email);
    await alice.page.getByRole("button", { name: "Next" }).click();
    await expect(alice.page.getByText(/Email recovery is disabled/i)).toBeVisible({ timeout: 15_000 });
    await context.close();
  });
});

async function aliceEmailFromSession(host: DeviceSession): Promise<string> {
  return host.page.evaluate(async () => {
    const res = await fetch("/api/identity/me", { credentials: "include" });
    if (!res.ok) throw new Error(`identity me ${res.status}`);
    const body = (await res.json()) as { email?: string };
    if (!body.email) throw new Error("alice has no email");
    return body.email;
  });
}
