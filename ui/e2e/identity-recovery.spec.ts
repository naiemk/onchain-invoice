import { test, expect } from "@playwright/test";
import { Wallet } from "ethers";
import { apiBase, loadLocalStack, withWorkerTicks } from "./helpers/stack.js";
import {
  createIdentityWalletFromUi,
  fundUsdc,
  openDevice,
  pairGuestDevice,
  waitForDeployed,
  type DeviceSession,
} from "./helpers/wallet.js";
import { emptyDeviceKeys, installE2eWebAuthn } from "./helpers/webauthn-shim.js";
import { drainEoaNative, fundEoaNative, installE2eEoa } from "./helpers/eoa.js";

test.describe("identity recovery", () => {
  test.describe.configure({ timeout: 180_000 });

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
    expect(host.keys.signCount).toBe(signBeforeProve + 1);
    await host.page.getByRole("button", { name: "Continue with passkey" }).click();
    await expect(host.page.getByText(/A passkey was added/i)).toBeVisible({ timeout: 60_000 });
    expect(host.keys.signCount).toBe(signBeforeProve + 1);
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
    await createIdentityWalletFromUi(host.page, "E2E Eoa Recover");
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
});

async function signOut(host: DeviceSession): Promise<void> {
  await host.page.goto("/wallet");
  await host.page.getByTestId("wallet-switcher").click();
  await host.page.getByRole("menuitem", { name: "Sign out" }).click();
  await host.page.goto("/wallet");
}
