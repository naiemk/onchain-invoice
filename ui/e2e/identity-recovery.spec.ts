import { test, expect } from "@playwright/test";
import { Wallet } from "ethers";
import { apiBase, loadLocalStack, withWorkerTicks } from "./helpers/stack.js";
import {
  confirmSimpleSend,
  createIdentityWalletFromUi,
  fundUsdc,
  openDevice,
  pairGuestDevice,
  signOut,
  usdcBalance,
  waitForDeployed,
  type DeviceSession,
} from "./helpers/wallet.js";
import { emptyDeviceKeys, installE2eWebAuthn } from "./helpers/webauthn-shim.js";
import { drainEoaNative, fundEoaNative, installE2eEoa } from "./helpers/eoa.js";

test.describe("identity recovery", () => {
  test.describe.configure({ timeout: 360_000 });

  test("email recovery starts for an identity wallet", async ({ browser }) => {
    const host = await openDevice(browser);
    const { email } = await createIdentityWalletFromUi(host.page, "E2E Email Recover");
    await host.page.goto("/wallet/recover");
    await host.page.getByRole("tab", { name: "With email" }).click();
    await host.page.locator("#recover-ack-no-device").click();
    await host.page.getByRole("button", { name: "Start recovery" }).click();
    await expect(host.page.getByTestId("email-recover-dialog")).toBeVisible();
    await host.page.locator("#recover-email").fill(email);
    const started = host.page.waitForResponse(
      (res) =>
        res.url().includes("/api/wallet/recovery/email/start") &&
        res.request().method() === "POST" &&
        res.ok()
    );
    await host.page.getByRole("button", { name: "Next" }).click();
    await started;
    const otpRes = await fetch(`${apiBase()}/api/identity/email/dev-otp`);
    const otp = (await otpRes.json()) as { code?: string; purpose?: string };
    expect(otp.purpose).toBe("recover");
    expect(otp.code).toBeTruthy();
    await host.page.locator("#recover-otp").fill(otp.code!);
    await host.page.getByRole("button", { name: "Next" }).click();
    await expect(host.page.getByRole("button", { name: "Continue with passkey" })).toBeVisible({ timeout: 15_000 });
    await host.page.getByRole("button", { name: "Continue with passkey" }).click();
    await expect(host.page.getByText(/Recovery started|already an owner/i)).toBeVisible({ timeout: 30_000 });
    await host.context.close();
  });

  test("other keys YubiKey recovery adds a passkey", async ({ browser }) => {
    const host = await openDevice(browser);
    const created = await createIdentityWalletFromUi(host.page, "E2E Yubi Recover");
    await fundUsdc(created.address, 5_000_000n);
    await waitForDeployed(created.address);
    await host.page.goto("/wallet/security");
    await expect(host.page.getByTestId("devices-card")).toBeVisible({ timeout: 30_000 });
    await expect(host.page.getByTestId("identity-recovery-email-card")).toBeVisible();
    await expect(host.page.getByText("Add or update recovery email")).toHaveCount(0);
    await expect(host.page.getByRole("button", { name: "Allow email restore" })).toHaveCount(0);
    await expect(host.page.getByRole("button", { name: "Attach your email" })).toHaveCount(0);
    await host.page.getByRole("button", { name: "Add security key (YubiKey)" }).click();
    await expect(host.page.getByTestId("add-security-key-wizard")).toBeVisible();
    await host.page.getByTestId("yubi-enroll").click();
    await expect(host.page.getByTestId("yubi-continue")).toBeVisible({ timeout: 15_000 });
    await host.page.getByTestId("yubi-continue").click();
    await expect(host.page.getByTestId("yubi-register")).toBeEnabled({ timeout: 15_000 });
    await withWorkerTicks(["bundler"], async () => {
      await host.page.getByTestId("yubi-register").click();
      await expect(host.page.getByTestId("yubi-tx-executed")).toBeVisible({ timeout: 60_000 });
    });

    await signOut(host);
    await host.page.goto("/wallet/recover");
    await host.page.getByRole("tab", { name: "Other keys" }).click();
    await host.page.getByTestId("recover-choose-yubikey").click();
    const createBeforeProve = host.keys.createCount;
    const signBeforeProve = host.keys.signCount;
    await host.page.getByRole("button", { name: "Prove ownership" }).click();
    await expect(host.page.getByRole("button", { name: "Continue with passkey" })).toBeVisible({ timeout: 20_000 });
    await expect(host.page.getByText("Who pays for recovery")).toHaveCount(0);
    expect(host.keys.createCount).toBe(createBeforeProve + 1);
    const assertions = host.keys.signCount - signBeforeProve;
    expect(assertions).toBeGreaterThanOrEqual(1);
    expect(assertions).toBeLessThanOrEqual(2);
    await host.page.getByRole("button", { name: "Continue with passkey" }).click();
    await expect(host.page.getByText(/A passkey was added/i)).toBeVisible({ timeout: 60_000 });
    expect(host.keys.signCount).toBe(signBeforeProve + assertions);
    await sendOneUsdc(host.page);
    await host.context.close();
  });

  test("other keys crypto wallet self-submits addMethodByEoa", async ({ browser }) => {
    const stack = await loadLocalStack();
    const keys = emptyDeviceKeys();
    const context = await browser.newContext();
    await installE2eWebAuthn(context, keys);
    await installE2eEoa(context, stack.rpcUrl);
    const page = await context.newPage();
    const host: DeviceSession = { context, page, keys };
    const created = await createIdentityWalletFromUi(host.page, "E2E Eoa Recover");
    await host.page.goto("/wallet/security");
    await expect(host.page.getByTestId("devices-card")).toBeVisible({ timeout: 30_000 });
    const added = host.page.waitForResponse(
      (res) =>
        res.url().includes("/api/identity/methods") &&
        res.request().method() === "POST" &&
        res.status() === 201
    );
    await host.page.getByRole("button", { name: "Connect wallet" }).click();
    await expect(host.page.getByTestId("connect-wallet-wizard")).toBeVisible();
    await host.page.getByTestId("connect-wallet-connect").click();
    await expect(host.page.getByTestId("connect-wallet-pay-self")).toBeEnabled({ timeout: 15_000 });
    await host.page.getByTestId("connect-wallet-pay-self").check();
    await expect(host.page.getByTestId("connect-wallet-next")).toBeEnabled();
    await host.page.getByTestId("connect-wallet-next").click();
    await host.page.getByTestId("connect-wallet-submit").click();
    await added;

    await signOut(host);
    await host.page.goto("/wallet/recover");
    await host.page.getByRole("tab", { name: "Other keys" }).click();
    await host.page.getByTestId("recover-choose-eoa").click();
    await host.page.getByRole("button", { name: "Prove ownership" }).click();
    await expect(host.page.getByText(/Identity email/i)).toBeVisible({ timeout: 30_000 });
    await expect(host.page.getByTestId("recover-pay-self")).toBeEnabled();
    await expect(host.page.getByTestId("recover-pay-self")).toBeChecked();
    await expect(host.page.getByText("Pay with a selected wallet")).toBeVisible();
    await expect(host.page.getByRole("radio", { name: /Relayer pays/i })).toHaveCount(0);
    await host.page.getByRole("button", { name: "Next" }).click();
    await host.page.getByRole("button", { name: "Continue with passkey" }).click();
    await expect(host.page.getByText(/A passkey was added/i)).toBeVisible({ timeout: 60_000 });
    await fundUsdc(created.address, 5_000_000n, stack);
    await waitForDeployed(created.address);
    const active = await host.page.evaluate(() => localStorage.getItem("tc-wallet-active"));
    expect(active?.toLowerCase()).toBe(created.address.toLowerCase());
    await sendOneUsdc(host.page);
    await context.close();
  });

  test("other keys crypto wallet pays from identity wallet when EOA has no gas", async ({ browser }) => {
    const stack = await loadLocalStack();
    const throwaway = Wallet.createRandom();
    const keys = emptyDeviceKeys();
    const context = await browser.newContext();
    await installE2eWebAuthn(context, keys);
    const eoa = await installE2eEoa(context, stack.rpcUrl, throwaway.privateKey);
    await fundEoaNative(stack.rpcUrl, stack.ownerKey, eoa.address);
    const page = await context.newPage();
    const host: DeviceSession = { context, page, keys };
    const created = await createIdentityWalletFromUi(host.page, "E2E Eoa No Gas");
    await fundUsdc(created.address, 5_000_000n);
    await waitForDeployed(created.address);
    await host.page.goto("/wallet/security");
    await expect(host.page.getByTestId("devices-card")).toBeVisible({ timeout: 30_000 });
    const added = host.page.waitForResponse(
      (res) =>
        res.url().includes("/api/identity/methods") &&
        res.request().method() === "POST" &&
        res.status() === 201
    );
    await host.page.getByRole("button", { name: "Connect wallet" }).click();
    await expect(host.page.getByTestId("connect-wallet-wizard")).toBeVisible();
    await host.page.getByTestId("connect-wallet-connect").click();
    await expect(host.page.getByTestId("connect-wallet-pay-self")).toBeEnabled({ timeout: 15_000 });
    await host.page.getByTestId("connect-wallet-pay-self").check();
    await host.page.getByTestId("connect-wallet-next").click();
    await host.page.getByTestId("connect-wallet-submit").click();
    await added;
    await drainEoaNative(stack.rpcUrl, throwaway.privateKey, stack.ownerAddress);

    await signOut(host);
    await host.page.goto("/wallet/recover");
    await host.page.getByRole("tab", { name: "Other keys" }).click();
    await host.page.getByTestId("recover-choose-eoa").click();
    const typesBeforeProve = eoa.signedTypes.length;
    await host.page.getByRole("button", { name: "Prove ownership" }).click();
    await expect(host.page.getByText(/Identity email/i)).toBeVisible({ timeout: 30_000 });
    await expect(host.page.getByTestId("recover-pay-self")).toBeDisabled();
    await expect(host.page.getByTestId("recover-pay-wallet")).toBeChecked();
    await expect(host.page.getByRole("button", { name: "Next" })).toBeEnabled();
    await expect(host.page.getByRole("radio", { name: /Relayer pays/i })).toHaveCount(0);
    expect(eoa.signedTypes.slice(typesBeforeProve)).toContain("Verify");
    await host.page.getByRole("button", { name: "Next" }).click();
    await withWorkerTicks(["bundler"], async () => {
      await host.page.getByRole("button", { name: "Continue with passkey" }).click();
      await expect(host.page.getByText(/A passkey was added/i)).toBeVisible({ timeout: 60_000 });
    });
    expect(eoa.signedTypes.slice(typesBeforeProve)).toContain("AddMethod");
    await sendOneUsdc(host.page);
    await context.close();
  });

  test("pair reuses a pending passkey after refresh", async ({ browser }) => {
    const host = await openDevice(browser);
    await createIdentityWalletFromUi(host.page, "E2E Reuse Passkey");
    const before = host.keys.createCount;
    await host.page.goto("/wallet/pair");
    await host.page.locator("#pair-submit").click();
    await expect(host.page.locator("#pair-qr")).toBeVisible({ timeout: 20_000 });
    const afterFirst = host.keys.createCount;
    expect(afterFirst).toBe(before + 1);
    await host.page.reload();
    await expect(host.page.locator("#pair-qr")).toBeVisible({ timeout: 20_000 });
    expect(host.keys.createCount).toBe(afterFirst);
    await host.context.close();
  });

  test("pairs a guest device from the new-device wizard", async ({ browser }) => {
    const host = await openDevice(browser);
    const created = await createIdentityWalletFromUi(host.page, "E2E Pair Host");
    await fundUsdc(created.address, 5_000_000n);
    await waitForDeployed(created.address);
    const guest = await openDevice(browser);
    await pairGuestDevice(host, guest, "E2E Guest Phone");
    await expect(guest.page).toHaveURL(/\/wallet\/?$/);
    await host.page.goto("/wallet/security");
    await expect(host.page.getByTestId("devices-card")).toBeVisible({ timeout: 30_000 });
    await expect(host.page.getByTestId("identity-email-card")).toHaveCount(0);
    await expect(host.page.getByText("Attach your email to enable recovery")).toHaveCount(0);
    await expect(host.page.getByTestId("remove-device")).toBeVisible();
    host.page.once("dialog", (dialog) => dialog.accept());
    await withWorkerTicks(["bundler"], async () => {
      await host.page.getByTestId("remove-device").click();
      await expect(host.page.getByTestId("remove-device")).toHaveCount(0, { timeout: 60_000 });
    });
    await expect(host.page.getByText("No other devices yet.")).toBeVisible();
    await guest.context.close();
    await host.context.close();
  });

  test("identity wallet pays to connect an EOA that starts on the wrong chain", async ({ browser }) => {
    const stack = await loadLocalStack();
    const keys = emptyDeviceKeys();
    const context = await browser.newContext();
    await installE2eWebAuthn(context, keys);
    const eoa = await installE2eEoa(context, stack.rpcUrl, undefined, { chainId: 1 });
    const page = await context.newPage();
    const host: DeviceSession = { context, page, keys };
    const created = await createIdentityWalletFromUi(host.page, "E2E Identity Pays");
    await fundUsdc(created.address, 5_000_000n, stack);
    await waitForDeployed(created.address);
    await host.page.goto("/wallet/security");
    await expect(host.page.getByTestId("devices-card")).toBeVisible({ timeout: 30_000 });
    await host.page.getByRole("button", { name: "Connect wallet" }).click();
    await expect(host.page.getByTestId("connect-wallet-wizard")).toBeVisible();
    await host.page.getByTestId("connect-wallet-connect").click();
    await expect(host.page.getByTestId("connect-wallet-pay-wallet")).toBeEnabled({ timeout: 15_000 });
    await host.page.getByTestId("connect-wallet-pay-wallet").check();
    await host.page.getByTestId("connect-wallet-next").click();
    await withWorkerTicks(["bundler"], async () => {
      await host.page.getByTestId("connect-wallet-submit").click();
      await expect(host.page.getByTestId("connect-wallet-tx-executed")).toBeVisible({ timeout: 60_000 });
    });
    expect(eoa.signedTypes).toContain("AddMethod");
    expect(eoa.chainIdsAtSign.length).toBeGreaterThan(0);
    expect(eoa.chainIdsAtSign.every((id) => id === 11155111)).toBe(true);
    const reported = await host.page.evaluate(async () => {
      const ethereum = (window as Window & { ethereum?: { request: (args: { method: string }) => Promise<unknown> } }).ethereum;
      return ethereum?.request({ method: "eth_chainId" });
    });
    expect(reported).toBe("0xaa36a7");
    await closeWizard(host.page, "connect-wallet-wizard");
    await expect(host.page.getByTestId("devices-card").getByText("Wallet", { exact: true })).toBeVisible();
    await context.close();
  });

  test("passkey turns email restore off and another key still recovers", async ({ browser }) => {
    const host = await openDevice(browser);
    const created = await createIdentityWalletFromUi(host.page, "E2E Passkey Disable");
    await fundUsdc(created.address, 5_000_000n);
    await waitForDeployed(created.address);
    await addSecurityKey(host.page);
    await host.page.goto("/wallet/security");
    await expect(host.page.getByTestId("identity-restore-turn-off")).toBeEnabled({ timeout: 15_000 });
    await withWorkerTicks(["bundler"], async () => {
      await host.page.getByTestId("identity-restore-turn-off").click();
      await expect(host.page.getByText(/Email restore is off/i)).toBeVisible({ timeout: 60_000 });
    });
    await host.page.goto("/wallet/recover");
    await host.page.getByRole("tab", { name: "With email" }).click();
    await host.page.locator("#recover-ack-no-device").click();
    await host.page.getByRole("button", { name: "Start recovery" }).click();
    await expect(host.page.getByTestId("email-recover-dialog")).toBeVisible();
    await host.page.locator("#recover-email").fill(created.email);
    await host.page.getByRole("button", { name: "Next" }).click();
    await expect(host.page.getByText(/Email recovery is disabled/i)).toBeVisible({ timeout: 15_000 });
    await host.page.keyboard.press("Escape");
    await signOut(host);
    await host.page.goto("/wallet/recover");
    await host.page.getByRole("tab", { name: "Other keys" }).click();
    await host.page.getByTestId("recover-choose-yubikey").click();
    await host.page.getByRole("button", { name: "Prove ownership" }).click();
    await expect(host.page.getByRole("button", { name: "Continue with passkey" })).toBeVisible({ timeout: 20_000 });
    await host.page.getByRole("button", { name: "Continue with passkey" }).click();
    await expect(host.page.getByText(/A passkey was added/i)).toBeVisible({ timeout: 60_000 });
    await host.page.goto("/wallet");
    await expect(host.page.getByRole("button", { name: "Lock wallet" })).toBeVisible({ timeout: 30_000 });
    await host.context.close();
  });

  test("removes a YubiKey and an EOA, and refuses to remove the last method", async ({ browser }) => {
    const stack = await loadLocalStack();
    const throwaway = Wallet.createRandom();
    const keys = emptyDeviceKeys();
    const context = await browser.newContext();
    await installE2eWebAuthn(context, keys);
    const eoa = await installE2eEoa(context, stack.rpcUrl, throwaway.privateKey);
    await fundEoaNative(stack.rpcUrl, stack.ownerKey, eoa.address);
    const page = await context.newPage();
    const host: DeviceSession = { context, page, keys };
    const created = await createIdentityWalletFromUi(host.page, "E2E Remove Methods");
    await fundUsdc(created.address, 8_000_000n, stack);
    await waitForDeployed(created.address);
    await host.page.goto("/wallet/security");
    await expect(host.page.getByTestId("identity-backup-hint")).toBeVisible({ timeout: 30_000 });
    await expect(host.page.getByTestId("remove-device")).toHaveCount(0);

    await addSecurityKey(host.page);
    await connectWallet(host.page, "self");
    const card = host.page.getByTestId("devices-card");
    await expect(card.getByText("Security key", { exact: true })).toBeVisible();
    await expect(card.getByText("Wallet", { exact: true })).toBeVisible();

    await removeDeviceRow(host.page, "Security key");
    await removeDeviceRow(host.page, "Wallet");
    await expect(host.page.getByTestId("identity-backup-hint")).toBeVisible({ timeout: 15_000 });
    await expect(host.page.getByTestId("remove-device")).toHaveCount(0);

    await signOut(host);
    await host.page.goto("/wallet/recover");
    await host.page.getByRole("tab", { name: "Other keys" }).click();
    await host.page.getByTestId("recover-choose-yubikey").click();
    await host.page.getByRole("button", { name: "Prove ownership" }).click();
    await expect(host.page.getByRole("alert")).toBeVisible({ timeout: 20_000 });
    await expect(host.page.getByRole("button", { name: "Continue with passkey" })).toHaveCount(0);
    await host.page.goto("/wallet/recover");
    await host.page.getByRole("tab", { name: "Other keys" }).click();
    await host.page.getByTestId("recover-choose-eoa").click();
    await host.page.getByRole("button", { name: "Prove ownership" }).click();
    await expect(host.page.getByRole("alert")).toBeVisible({ timeout: 20_000 });
    await expect(host.page.getByRole("button", { name: "Continue with passkey" })).toHaveCount(0);
    await context.close();
  });
});

async function sendOneUsdc(page: DeviceSession["page"]): Promise<void> {
  const stack = await loadLocalStack();
  await page.goto("/wallet");
  await expect(page.getByRole("button", { name: "Lock wallet" })).toBeVisible({ timeout: 30_000 });
  const before = await usdcBalance(stack.collectorAddress, stack);
  await confirmSimpleSend(page, stack.collectorAddress, "1");
  await expect.poll(async () => usdcBalance(stack.collectorAddress, stack), { timeout: 30_000 }).toBe(before + 1_000_000n);
}

async function addSecurityKey(page: DeviceSession["page"]): Promise<void> {
  await page.goto("/wallet/security");
  await expect(page.getByTestId("devices-card")).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "Add security key (YubiKey)" }).click();
  await expect(page.getByTestId("add-security-key-wizard")).toBeVisible();
  await page.getByTestId("yubi-enroll").click();
  await expect(page.getByTestId("yubi-continue")).toBeVisible({ timeout: 15_000 });
  await page.getByTestId("yubi-continue").click();
  await expect(page.getByTestId("yubi-register")).toBeEnabled({ timeout: 15_000 });
  await withWorkerTicks(["bundler"], async () => {
    await page.getByTestId("yubi-register").click();
    await expect(page.getByTestId("yubi-tx-executed")).toBeVisible({ timeout: 60_000 });
  });
  await closeWizard(page, "add-security-key-wizard");
}

function closeWizard(page: DeviceSession["page"], testId: string): Promise<void> {
  return page
    .getByTestId(testId)
    .getByRole("button", { name: "Close", exact: true })
    .filter({ hasNot: page.locator("svg") })
    .click();
}

async function connectWallet(page: DeviceSession["page"], pay: "self" | "wallet"): Promise<void> {
  await page.goto("/wallet/security");
  await expect(page.getByTestId("devices-card")).toBeVisible({ timeout: 30_000 });
  const added = page.waitForResponse(
    (res) => res.url().includes("/api/identity/methods") && res.request().method() === "POST" && res.status() === 201
  );
  await page.getByRole("button", { name: "Connect wallet" }).click();
  await expect(page.getByTestId("connect-wallet-wizard")).toBeVisible();
  await page.getByTestId("connect-wallet-connect").click();
  const choice = page.getByTestId(pay === "self" ? "connect-wallet-pay-self" : "connect-wallet-pay-wallet");
  await expect(choice).toBeEnabled({ timeout: 15_000 });
  await choice.check();
  await page.getByTestId("connect-wallet-next").click();
  if (pay === "wallet") {
    await withWorkerTicks(["bundler"], async () => {
      await page.getByTestId("connect-wallet-submit").click();
      await added;
    });
    return;
  }
  await page.getByTestId("connect-wallet-submit").click();
  await added;
}

async function removeDeviceRow(page: DeviceSession["page"], label: string): Promise<void> {
  const row = page.getByTestId("devices-card").locator("li").filter({ hasText: label });
  await expect(row).toBeVisible();
  page.once("dialog", (dialog) => dialog.accept());
  await withWorkerTicks(["bundler"], async () => {
    await row.getByTestId("remove-device").click();
    await expect(row).toHaveCount(0, { timeout: 60_000 });
  });
}
