import { test, expect, type Page } from "@playwright/test";

const MOCK_EOA = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const MOCK_EOA_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";

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
          if (method === "eth_signTypedData_v4") {
            const [, payload] = (params ?? []) as [string, string];
            const { ethers } = await import("https://cdn.jsdelivr.net/npm/ethers@6.13.5/+esm");
            const parsed = typeof payload === "string" ? JSON.parse(payload) : payload;
            const types = { ...(parsed.types ?? {}) };
            delete types.EIP712Domain;
            const signer = new ethers.Wallet(privateKey);
            return signer.signTypedData(parsed.domain, types, parsed.message);
          }
          throw new Error(`unsupported: ${method}`);
        },
      };
    },
    { address: MOCK_EOA, privateKey: MOCK_EOA_KEY }
  );
}

const E2E_WALLET = "0x96aa0c5a047a3602882d72ad0ab4b080f3c0bc7b";

async function seedSimpleWalletSession(page: Page): Promise<void> {
  const session = {
    address: E2E_WALLET,
    chainId: "11155111",
    salt: `0x${"11".repeat(32)}`,
    qx: `0x${"0a".repeat(32)}`,
    qy: `0x${"0b".repeat(32)}`,
    credentialId: "e2e-cred",
    rawId: "e2e-cred",
    label: "E2E",
  };
  await page.addInitScript((sess) => {
    localStorage.setItem("tc.walletMode", "advanced");
    localStorage.setItem("tc-wallet-registry", JSON.stringify([sess]));
    localStorage.setItem("tc-wallet-active", sess.address);
  }, session);
}

async function mockSuperWalletActiveApis(page: Page): Promise<void> {
  await page.route("**/api/wallet/**/advanced-policy", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        wallet: E2E_WALLET,
        advanced: true,
        supportsAdvanced: true,
        threshold: 2,
        entityCount: 2,
        vetoCount: 0,
        vetoBitmap: "0",
      }),
    });
  });
  await page.route("**/api/wallet/balance**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        wallet: E2E_WALLET,
        totalUsdc: "20000000",
        totalUsd: "$20.00",
        chains: [
          {
            chainId: "11155111",
            networkLabel: "Sepolia",
            balance: "20000000",
            balanceUsd: "$20.00",
            deployed: true,
            feeTokenSymbol: "USDC",
          },
        ],
      }),
    });
  });
  await page.route("**/api/wallet/devices**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ devices: [] }),
    });
  });
  await page.route("**/api/wallet/pairing", async (route) => {
    const body = (route.request().postDataJSON() ?? {}) as { action?: string };
    if (body.action === "create") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          pairing: {
            nonce: "e2e-pair-nonce",
            walletAddress: E2E_WALLET,
            chainId: "11155111",
            expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
          },
        }),
      });
      return;
    }
    if (body.action === "poll") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          pairing: { status: "pending", newOwnerQx: null, newOwnerQy: null, newOwnerCredentialId: null, deviceLabel: null },
        }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ pairing: { status: "expired" } }),
    });
  });
  await page.route("**/api/wallet/**/proposals", async (route) => {
    if (route.request().method() !== "GET") {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ proposals: [] }),
    });
  });
  await page.route("**/api/wallet/**/entities", async (route) => {
    if (route.request().method() !== "GET") {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        entities: [{ entityId: `0x${"aa".repeat(32)}`, label: "admin@example.com" }],
        keys: [],
      }),
    });
  });
}

async function mockSuperWalletUpgradeApis(page: Page): Promise<void> {
  await page.route("**/api/wallet/**/advanced-policy", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        wallet: E2E_WALLET,
        advanced: false,
        supportsAdvanced: true,
        threshold: 1,
        entityCount: 0,
        vetoCount: 0,
        vetoBitmap: "0",
      }),
    });
  });
  await page.route("**/api/wallet/balance**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        wallet: E2E_WALLET,
        totalUsdc: "20000000",
        totalUsd: "$20.00",
        chains: [
          {
            chainId: "11155111",
            networkLabel: "Sepolia",
            balance: "20000000",
            balanceUsd: "$20.00",
            deployed: true,
            feeTokenSymbol: "USDC",
          },
        ],
      }),
    });
  });
}

test.describe("Super Wallet UI", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem("tc.walletMode", "advanced");
    });
    await injectMockEthereum(page);
  });

  test("creates passkey wallet and opens Super Wallet upgrade UI", async ({ page }) => {
    await seedSimpleWalletSession(page);
    await mockSuperWalletUpgradeApis(page);
    await page.goto("/wallet/super-wallet");
    await expect(page.locator("#enable-advanced")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Upgrade to Super Wallet" })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Wallet navigation" })).toContainText("Super Wallet");
  });

  test("Convert to Super Wallet prompts confirm when email is filled", async ({ page }) => {
    await seedSimpleWalletSession(page);
    await mockSuperWalletUpgradeApis(page);
    await page.goto("/wallet/super-wallet");
    await expect(page.locator("#enable-advanced")).toBeVisible();
    await page.locator("#admin-email").fill("admin@example.com");
    await page.locator("#enable-advanced").click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByTestId("super-wallet-confirm-email")).toHaveText("admin@example.com");
    await expect(dialog.getByText(/will not send a verification email/i)).toBeVisible();
    await expect(dialog.getByText(/Email recovery/i)).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Yes, the spelling is correct" })).toBeDisabled();
    await dialog.getByTestId("super-wallet-spelling-check").click();
    await expect(dialog.getByRole("button", { name: "Yes, the spelling is correct" })).toBeEnabled();
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).not.toBeVisible();
  });

  test("hides convert when the wallet implementation lacks Super Wallet", async ({ page }) => {
    await seedSimpleWalletSession(page);
    await page.route("**/api/wallet/**/advanced-policy", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          wallet: E2E_WALLET,
          advanced: false,
          supportsAdvanced: false,
          threshold: 1,
          entityCount: 0,
          vetoCount: 0,
          vetoBitmap: "0",
        }),
      });
    });
    await page.route("**/api/wallet/balance**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          wallet: E2E_WALLET,
          totalUsdc: "0",
          totalUsd: "$0",
          chains: [{ chainId: "11155111", networkLabel: "Sepolia", balance: "0", balanceUsd: "$0", deployed: true, feeTokenSymbol: "USDC" }],
        }),
      });
    });

    await page.goto("/wallet/super-wallet");
    await expect(page.getByRole("heading", { name: "This wallet cannot become a Super Wallet" })).toBeVisible();
    await expect(page.locator("#enable-advanced")).toHaveCount(0);
  });

  test("shows entity key enrollment controls on Access after Super Wallet is active", async ({ page }) => {
    await seedSimpleWalletSession(page);
    await mockSuperWalletActiveApis(page);
    await page.goto("/wallet/access");
    await expect(page.getByTestId("access-page")).toBeVisible();
    await expect(page.locator("#add-entity")).toBeVisible();
  });

  test("blocks last-key and below-threshold identity removal on Access", async ({ page }) => {
    const adminEntityId = `0x${"aa".repeat(32)}`;
    const teammateEntityId = `0x${"bb".repeat(32)}`;
    const adminKeyId = `0x${"11".repeat(32)}`;
    const teammateKeyId = `0x${"22".repeat(32)}`;
    await seedSimpleWalletSession(page);
    await mockSuperWalletActiveApis(page);
    await page.route("**/api/wallet/**/entities", async (route) => {
      if (route.request().method() !== "GET") {
        await route.continue();
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          entities: [
            { entityId: adminEntityId, label: "admin@example.com" },
            { entityId: teammateEntityId, label: "teammate@example.com" },
          ],
          keys: [
            {
              entityId: adminEntityId,
              keyId: adminKeyId,
              keyType: 0,
              qx: `0x${"0a".repeat(32)}`,
              qy: `0x${"0b".repeat(32)}`,
              eoa: null,
            },
            {
              entityId: teammateEntityId,
              keyId: teammateKeyId,
              keyType: 0,
              qx: `0x${"0c".repeat(32)}`,
              qy: `0x${"0d".repeat(32)}`,
              eoa: null,
            },
          ],
        }),
      });
    });
    await page.goto("/wallet/access");
    await expect(page.getByTestId("access-page")).toBeVisible();

    const admin = page.locator(`[data-entity-id="${adminEntityId}"]`);
    await expect(admin.getByTestId("remove-key")).toBeEnabled();
    await expect(admin.getByTestId("last-key-blocked")).toHaveCount(0);
    await expect(admin.getByRole("button", { name: "Add passkey" })).toHaveCount(0);
    await expect(admin.getByTestId("remove-entity")).toHaveCount(0);
    await admin.getByTestId("remove-key").click();
    await expect(page.locator("#super-status")).toContainText("at least one key");

    const teammate = page.locator(`[data-entity-id="${teammateEntityId}"]`);
    await expect(teammate.getByTestId("remove-key")).toBeEnabled();
    await expect(teammate.getByTestId("last-key-blocked")).toHaveCount(0);
    await expect(teammate.getByTestId("remove-entity")).toBeDisabled();
    await expect(teammate.getByTestId("remove-entity-blocked")).toContainText("at least 2 of 2");
  });

  test("locks Super Wallet chrome and Pay proposals after convert", async ({ page }) => {
    await seedSimpleWalletSession(page);
    await mockSuperWalletActiveApis(page);

    await page.goto("/wallet");
    await expect(page.getByTestId("super-wallet-shield")).toBeVisible();
    await expect(page.getByTestId("super-wallet-home-summary")).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Wallet navigation" })).toContainText("Access");
    await expect(page.getByRole("navigation", { name: "Wallet navigation" })).toContainText("Security");
    await expect(page.getByRole("navigation", { name: "Wallet navigation" })).not.toContainText("Super Wallet");
    await expect(page.getByRole("group", { name: "Wallet mode" })).toHaveCount(0);

    await page.goto("/wallet/security");
    await expect(page).toHaveURL(/\/wallet\/security/);
    await expect(page.getByTestId("super-wallet-policy-card")).toBeVisible();
    await expect(page.getByRole("link", { name: "Details" }).first()).toHaveAttribute("href", "/wallet/access");
    await expect(page.getByRole("button", { name: "Pair another device" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Add security key (YubiKey)" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Connect wallet" })).toBeVisible();
    await expect(page.getByTestId("identity-email-card")).toBeVisible();
    await page.getByRole("button", { name: "Pair another device" }).click();
    await expect(page.getByTestId("pair-device-dialog")).toBeVisible();
    await expect(page.getByTestId("pair-copy-link")).toBeVisible();
    await expect(page.getByRole("heading", { name: "I lost this device" })).toHaveCount(0);
    await page.goto("/wallet/recover");
    await expect(page).toHaveURL(/\/wallet\/recover/);
    await expect(page.getByRole("tab", { name: "With email" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Without email" })).toBeVisible();

    await page.goto("/wallet/send");
    await expect(page.getByTestId("super-wallet-pay")).toBeVisible();
    await expect(page.getByRole("button", { name: "Send tokens" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Contract call" })).toBeVisible();
    await expect(page.locator("#send-token")).toBeVisible();
    await expect(page.locator("#prop-amount")).toBeVisible();
    await expect(page.getByRole("button", { name: "Review payment" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Max" })).toBeVisible();

    await page.goto("/wallet/super-wallet");
    await expect(page).toHaveURL(/\/wallet\/?$/);

    await page.goto("/wallet/access");
    await expect(page.getByTestId("access-page")).toBeVisible();
  });

  test("Connect wallet on a simple wallet does not require email or enable Super Wallet", async ({ page }) => {
    await seedSimpleWalletSession(page);
    await mockSuperWalletUpgradeApis(page);
    await page.route("**/api/wallet/devices**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ devices: [] }),
      });
    });
    let emailHits = 0;
    await page.route("**/api/wallet/**/email**", async (route) => {
      emailHits += 1;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ email: null, verified: false }),
      });
    });
    await page.goto("/wallet/security");
    await expect(page.getByRole("button", { name: "Connect wallet" })).toBeVisible();
    await page.getByRole("button", { name: "Connect wallet" }).click();
    await expect(page.locator("#enable-advanced")).toHaveCount(0);
    await expect.poll(() => emailHits).toBe(0);
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
