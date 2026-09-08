/**
 * Local Hardhat stack journey: create a **new** wallet here (old Sepolia clones are irrelevant).
 * WebAuthn is a per-context P-256 test-key shim, not a CDP virtual authenticator.
 * Nodes do not poll on an interval; tests POST /tick on the running bundler/sweeper/deployer.
 * Default CI path is local Hardhat (`e2eLocal`). Live testnet: `npm run test:ui-e2e:testnet`.
 */
import { test, expect } from "@playwright/test";
import { Contract, Interface, JsonRpcProvider } from "ethers";
import { loadLocalStack, withWorkerTicks } from "./helpers/stack.js";
import {
  addSuperEntity,
  confirmSimpleSend,
  createSuperPayProposal,
  createWalletFromUi,
  enrollSuperEntity,
  executeProposalExpectNoSignatures,
  executeSuperContractCall,
  executeSuperProposal,
  executeSuperTransfer,
  expectExecuteDisabled,
  fundUsdc,
  openDevice,
  openSuperProposal,
  pairGuestDevice,
  payInvoiceUsdc,
  setSuperThreshold,
  signSuperProposal,
  usdcBalance,
  waitForDeployed,
  waitForInvoiceStatus,
  type DeviceSession,
} from "./helpers/wallet.js";

const PING_VALUE = "0x1111111111111111111111111111111111111111111111111111111111111111";

test.describe.serial("local Hardhat stack", () => {
  test.describe.configure({ timeout: 360_000 });

  let stack: Awaited<ReturnType<typeof loadLocalStack>>;
  let host: DeviceSession;
  let guestSimple: DeviceSession;
  let guestSuper: DeviceSession;
  let entityB: DeviceSession;
  let entityC: DeviceSession;
  let walletAddress: string;
  let twoOfThreeProposalId: string;
  let beforeSecondReceive: bigint;

  test.afterAll(async () => {
    await host?.context.close();
    await guestSimple?.context.close();
    await guestSuper?.context.close();
    await entityB?.context.close();
    await entityC?.context.close();
  });

  test("create wallet", async ({ browser }) => {
    stack = await loadLocalStack();
    host = await openDevice(browser);
    walletAddress = await createWalletFromUi(host.page, "E2E Device 1");
    expect(walletAddress).toMatch(/^0x[0-9a-fA-F]{40}$/);
  });

  test("receive USDC and wait for on-chain createAccount", async () => {
    await host.page.goto("/wallet/receive");
    await expect(host.page.getByText("Receive")).toBeVisible();
    await fundUsdc(walletAddress, 20_000_000n, stack);
    await waitForDeployed(walletAddress);
    await host.page.goto("/wallet");
    await expect(host.page.getByText("Active", { exact: true })).toBeVisible({ timeout: 60_000 });
  });

  test("create invoice and get paid", async () => {
    await host.page.goto("/wallet/get-paid");
    await expect(host.page.getByRole("heading", { name: "Get paid" })).toBeVisible();
    await host.page.goto("/create");
    await host.page.locator("#price").fill("5.00");
    await expect(host.page.getByRole("button", { name: "Create pay link" })).toBeEnabled({ timeout: 15_000 });
    await host.page.evaluate(() => {
      window.open = (url?: string | URL) => {
        window.location.assign(String(url ?? ""));
        return null;
      };
    });
    await host.page.getByRole("button", { name: "Create pay link" }).click();
    await expect(host.page.getByRole("button", { name: "Continue to payment" })).toBeVisible({ timeout: 15_000 });
    const created = host.page.waitForResponse(
      (res) =>
        res.url().includes("/api/invoices") &&
        res.request().method() === "POST" &&
        res.status() === 201,
      { timeout: 30_000 }
    );
    await host.page.getByRole("button", { name: "Continue to payment" }).click();
    const res = await created;
    const body = (await res.json()) as {
      invoice?: { id?: string; invoiceAddress?: string; selectedTo?: string };
    };
    expect(body.invoice?.invoiceAddress).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(body.invoice?.selectedTo?.toLowerCase()).toBe(walletAddress.toLowerCase());
    await payInvoiceUsdc(body.invoice!.invoiceAddress!, 5_000_000n, stack);
    const invoice = await waitForInvoiceStatus(body.invoice!.id!, ["paid", "swept"]);
    expect(["paid", "swept"]).toContain(invoice.status);
  });

  test("send USDC", async () => {
    const before = await usdcBalance(stack.collectorAddress, stack);
    await confirmSimpleSend(host.page, stack.collectorAddress, "1");
    await expect.poll(async () => usdcBalance(stack.collectorAddress, stack), { timeout: 30_000 }).toBe(before + 1_000_000n);
  });

  test("add a second WebAuthn owner on the simple wallet", async ({ browser }) => {
    guestSimple = await openDevice(browser);
    await pairGuestDevice(host, guestSimple, "E2E Device 2");
  });

  test("send USDC from the second WebAuthn owner", async () => {
    await expect(guestSimple.page).toHaveURL(/\/wallet/, { timeout: 30_000 });
    const before = await usdcBalance(stack.collectorAddress, stack);
    await confirmSimpleSend(guestSimple.page, stack.collectorAddress, "1");
    await expect.poll(async () => usdcBalance(stack.collectorAddress, stack), { timeout: 30_000 }).toBe(before + 1_000_000n);
  });

  test("convert to Super Wallet", async () => {
    await host.page.goto("/wallet/super-wallet");
    await host.page.locator("#admin-email").fill("e2e-admin@example.com");
    await host.page.locator("#enable-advanced").click();
    await host.page.getByTestId("super-wallet-spelling-check").click();
    await host.page.getByRole("button", { name: "Yes, the spelling is correct" }).click();
    await withWorkerTicks(["bundler"], () => expect(host.page).toHaveURL(/\/wallet\/?$/, { timeout: 20_000 }));
    await expect(host.page.getByTestId("super-wallet-home-summary")).toBeVisible({ timeout: 30_000 });
  });

  test("send USDC from Super Wallet after convert", async () => {
    const before = await usdcBalance(stack.collectorAddress, stack);
    await executeSuperTransfer(host.page, stack.collectorAddress, "1");
    await expect.poll(async () => usdcBalance(stack.collectorAddress, stack), { timeout: 30_000 }).toBe(before + 1_000_000n);
  });

  test("pair another device to the Super Wallet identity", async ({ browser }) => {
    guestSuper = await openDevice(browser);
    await pairGuestDevice(host, guestSuper, "E2E Device 3");
  });

  test("send from the paired Super Wallet device", async () => {
    await expect(guestSuper.page).toHaveURL(/\/wallet/, { timeout: 30_000 });
    const before = await usdcBalance(stack.collectorAddress, stack);
    await executeSuperTransfer(guestSuper.page, stack.collectorAddress, "1");
    await expect.poll(async () => usdcBalance(stack.collectorAddress, stack), { timeout: 30_000 }).toBe(before + 1_000_000n);
  });

  test("contract call via Super Pay", async () => {
    test.skip(!stack.pingAddress, "no e2e ping contract on this stack");
    const data = new Interface(["function ping(bytes32 value)"]).encodeFunctionData("ping", [PING_VALUE]);
    await executeSuperContractCall(host.page, stack.pingAddress, data);
    const provider = new JsonRpcProvider(stack.rpcUrl);
    const ping = new Contract(stack.pingAddress, ["function lastPing() view returns (bytes32)"], provider);
    expect(String(await ping.lastPing()).toLowerCase()).toBe(PING_VALUE);
  });

  test("add two Super Wallet entities", async () => {
    await addSuperEntity(host, "e2e-entity-b@example.com");
    await addSuperEntity(host, "e2e-entity-c@example.com");
    await expect(host.page.getByText("Active · 1-of-3 entities")).toBeVisible();
  });

  test("enroll passkeys for the new entities", async ({ browser }) => {
    entityB = await openDevice(browser);
    entityC = await openDevice(browser);
    const origin = new URL(host.page.url()).origin;
    await enrollSuperEntity(host, entityB, "e2e-entity-b@example.com", walletAddress, origin, stack.chainId);
    await enrollSuperEntity(host, entityC, "e2e-entity-c@example.com", walletAddress, origin, stack.chainId);
  });

  test("set 2-of-3 policy", async () => {
    await setSuperThreshold(host, 2, 3);
  });

  test("create pay; execute without enough signatures fails", async () => {
    twoOfThreeProposalId = await createSuperPayProposal(host.page, stack.collectorAddress, "1");
    await expect(host.page.locator("#proposal-detail").getByText("0 / 2 signatures")).toBeVisible();
    await expectExecuteDisabled(host.page);
    await executeProposalExpectNoSignatures(walletAddress, twoOfThreeProposalId);
  });

  test("two entities sign and execute pays the collector", async () => {
    const before = await usdcBalance(stack.collectorAddress, stack);
    await signSuperProposal(host.page);
    await expect(host.page.locator("#proposal-detail").getByText("1 / 2 signatures")).toBeVisible();
    await expectExecuteDisabled(host.page);
    await openSuperProposal(entityB.page, twoOfThreeProposalId);
    await withWorkerTicks(["bundler"], async () => {
      await signSuperProposal(entityB.page);
      const executed = entityB.page.getByText("Proposal executed");
      if (!(await executed.isVisible())) {
        await executeSuperProposal(entityB.page);
      } else {
        await expect(executed).toBeVisible();
      }
    });
    await expect.poll(async () => usdcBalance(stack.collectorAddress, stack), { timeout: 30_000 }).toBe(before + 1_000_000n);
  });

  test("receive USDC again", async () => {
    beforeSecondReceive = await usdcBalance(walletAddress, stack);
    await fundUsdc(walletAddress, 3_000_000n, stack);
    await expect.poll(async () => usdcBalance(walletAddress, stack), { timeout: 15_000 }).toBe(beforeSecondReceive + 3_000_000n);
    await host.page.goto("/wallet");
    await host.page.getByRole("button", { name: "Refresh" }).click();
    await expect(host.page.getByText("Active", { exact: true })).toBeVisible();
  });
});
