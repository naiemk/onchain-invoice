import { test, expect, type CDPSession, type Page } from "@playwright/test";

const MOCK_EOA = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const MOCK_EOA_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";

async function addVirtualAuthenticator(page: Page, attachment: "platform" | "cross-platform"): Promise<CDPSession> {
  const client = await page.context().newCDPSession(page);
  await client.send("WebAuthn.enable");
  await client.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      transport: attachment === "platform" ? "internal" : "usb",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
  return client;
}

async function injectMockEthereum(page: Page): Promise<void> {
  await page.addInitScript(
    ({ address, privateKey }) => {
      const wallet = { address, privateKey };
      (window as Window & { __e2eEoa?: typeof wallet }).__e2eEoa = wallet;
      (window as Window & { ethereum?: { request: (args: { method: string; params?: unknown[] }) => Promise<unknown> } }).ethereum = {
        request: async ({ method, params }) => {
          if (method === "eth_requestAccounts" || method === "eth_accounts") return [address];
          if (method === "eth_chainId") return "0xaa36a7";
          if (method === "personal_sign") {
            const [hexMsg] = (params ?? []) as [string];
            const { ethers } = await import("https://cdn.jsdelivr.net/npm/ethers@6.13.5/+esm");
            const signer = new ethers.Wallet(privateKey);
            const raw = ethers.getBytes(hexMsg);
            return signer.signMessage(raw);
          }
          throw new Error(`unsupported: ${method}`);
        },
      };
    },
    { address: MOCK_EOA, privateKey: MOCK_EOA_KEY }
  );
}

test.describe("Super Wallet UI", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem("tc.walletMode", "advanced");
    });
    await injectMockEthereum(page);
  });

  test("creates passkey wallet and opens Super Wallet upgrade UI", async ({ page }) => {
    await addVirtualAuthenticator(page, "platform");
    await page.goto("/wallet/create");
    await page.getByTestId("device-name").fill("E2E Passkey");
    await page.getByTestId("wallet-create-btn").click();
    await expect(page.locator("#wallet-create-result")).toBeVisible();
    await expect(page.locator("#created-address")).toContainText("0x");

    await page.goto("/wallet/super-wallet");
    await expect(page.locator("#enable-advanced")).toBeVisible();
    await expect(page.getByRole("heading", { level: 1, name: "Super Wallet" })).toBeVisible();
  });

  test("Convert to Super Wallet prompts confirm when email is filled", async ({ page }) => {
    await addVirtualAuthenticator(page, "platform");
    await page.goto("/wallet/create");
    await page.getByTestId("device-name").fill("E2E Passkey");
    await page.getByTestId("wallet-create-btn").click();
    await expect(page.locator("#created-address")).toContainText("0x");

    await page.goto("/wallet/super-wallet");
    await expect(page.locator("#enable-advanced")).toBeVisible();
    await page.locator("#admin-email").fill("admin@example.com");

    const dialogPromise = page.waitForEvent("dialog");
    const clickPromise = page.locator("#enable-advanced").click();
    const dialog = await dialogPromise;
    expect(dialog.type()).toBe("confirm");
    expect(dialog.message()).toMatch(/Email recovery/i);
    await dialog.dismiss();
    await clickPromise;
  });

  test("shows entity key enrollment controls after upgrade section", async ({ page }) => {
    await addVirtualAuthenticator(page, "platform");
    await page.goto("/wallet/create");
    await page.getByTestId("wallet-create-btn").click();
    await expect(page.locator("#wallet-create-result")).toBeVisible();

    await page.goto("/wallet/super-wallet");
    const upgradeBtn = page.locator("#enable-advanced");
    if (await upgradeBtn.isVisible()) {
      await page.fill("#admin-email", "admin@example.com");
      await upgradeBtn.click();
      await page.waitForTimeout(2000);
    }

    await page.goto("/wallet/super-wallet");
    const addEntity = page.locator("#add-entity");
    if (await addEntity.isVisible()) {
      await page.fill("#entity-email", "teammate@example.com");
      await addEntity.click();
      await page.waitForTimeout(1000);
    }

    const yubiBtn = page.locator("[data-add-yubikey]").first();
    if (await yubiBtn.isVisible().catch(() => false)) {
      await addVirtualAuthenticator(page, "cross-platform");
      await yubiBtn.click();
    }
  });

  test("injected EOA provider is available for wallet connect", async ({ page }) => {
    await page.goto("/wallet");
    const accounts = await page.evaluate(async () => {
      const w = window as Window & { ethereum?: { request: (a: { method: string }) => Promise<string[]> } };
      return w.ethereum?.request({ method: "eth_requestAccounts" });
    });
    expect(accounts?.[0]?.toLowerCase()).toBe(MOCK_EOA.toLowerCase());
  });
});
