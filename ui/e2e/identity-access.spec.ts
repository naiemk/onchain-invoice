/**
 * Identity Super Wallet team flow on the local chain.
 * Join, reject, policy, and removal go through the Team and join pages.
 * YubiKey assertions and EOA EIP-712 signatures are the blobs the wallet verifies.
 */
import { test, expect, type Browser, type Page } from "@playwright/test";
import { Contract, JsonRpcProvider } from "ethers";
import { loadLocalStack, withWorkerTicks, type LocalStack } from "./helpers/stack.js";
import { installE2eEoa, type E2eEoaSession } from "./helpers/eoa.js";
import { emptyDeviceKeys, installE2eWebAuthn } from "./helpers/webauthn-shim.js";
import {
  convertIdentitySuper,
  createIdentityWalletFromUi,
  createSuperPayProposal,
  enrollSuperEntity,
  fundUsdc,
  openDevice,
  openSuperProposal,
  setSuperThreshold,
  signSuperProposal,
  superJoinUrl,
  usdcBalance,
  waitForDeployed,
  type DeviceSession,
} from "./helpers/wallet.js";

const STORE_ABI = [
  "function getIdentity(bytes32 identityId) view returns (tuple(bool exists, bool restoreEnabled, uint8 methodCount, uint8 eoaCount, uint8 webauthnCount, uint8 yubikeyCount))",
];
const WALLET_ABI = [
  "function isSigner(bytes32 identityId) view returns (bool)",
  "function threshold() view returns (uint8)",
  "function signerCount() view returns (uint8)",
];

test.describe.serial("identity super wallet team", () => {
  test.describe.configure({ timeout: 600_000 });

  let stack: LocalStack;
  let host: DeviceSession;
  let yubi: DeviceSession;
  let eoaDevice: DeviceSession;
  let eoa: E2eEoaSession;
  let walletAddress: string;
  let origin: string;
  let hostEmail: string;
  let yubiEmail: string;
  let eoaEmail: string;
  let hostIdentity: string;
  let yubiIdentity: string;
  let eoaIdentity: string;

  test.afterAll(async () => {
    await host?.context.close();
    await yubi?.context.close();
    await eoaDevice?.context.close();
  });

  test("a wallet that is not a Super Wallet shows that on the join link", async ({ browser }) => {
    stack = await loadLocalStack();
    host = await openDevice(browser);
    yubi = await openDevice(browser);
    const opened = await openEoaDevice(browser, stack.rpcUrl);
    eoaDevice = opened.device;
    eoa = opened.eoa;

    const createdHost = await createIdentityWalletFromUi(host.page, "E2E Team Admin");
    const createdYubi = await createIdentityWalletFromUi(yubi.page, "E2E Team Yubi");
    const createdEoa = await createIdentityWalletFromUi(eoaDevice.page, "E2E Team Eoa");
    walletAddress = createdHost.address;
    hostEmail = createdHost.email;
    yubiEmail = createdYubi.email;
    eoaEmail = createdEoa.email;
    hostIdentity = await activeIdentity(host.page);
    yubiIdentity = await activeIdentity(yubi.page);
    eoaIdentity = await activeIdentity(eoaDevice.page);
    origin = new URL(host.page.url()).origin;

    await fundUsdc(walletAddress, 30_000_000n, stack);
    await waitForDeployed(walletAddress);

    await yubi.page.goto(superJoinUrl(origin, walletAddress, stack.chainId));
    await expect(yubi.page.getByText("This wallet is not a Super Wallet yet.")).toBeVisible();
  });

  test("rejecting an enrollment does not add a key", async () => {
    await convertIdentitySuper(host, [yubiEmail, eoaEmail], 1);
    const before = await identityCounts(stack, yubiIdentity);

    await yubi.page.goto(superJoinUrl(origin, walletAddress, stack.chainId));
    await yubi.page.locator("#join-email").fill(yubiEmail);
    await yubi.page.locator("#join-yubikey").click();
    await expect(yubi.page.locator("#join-wait")).toBeVisible({ timeout: 20_000 });

    await host.page.goto("/wallet/access");
    await expect(host.page.getByRole("button", { name: "Reject" })).toBeVisible({ timeout: 20_000 });
    let userOps = 0;
    const onRequest = (req: { method: () => string; url: () => string }) => {
      if (req.method() === "POST" && req.url().includes("/api/wallet/userops")) userOps += 1;
    };
    host.page.on("request", onRequest);
    await host.page.getByRole("button", { name: "Reject" }).click();
    await expect(yubi.page.locator("#join-status")).toContainText("Enrollment was rejected or expired.");
    host.page.off("request", onRequest);
    expect(userOps).toBe(0);

    const after = await identityCounts(stack, yubiIdentity);
    expect(after.yubikeyCount).toBe(before.yubikeyCount);
    expect(after.methodCount).toBe(before.methodCount);
  });

  test("YubiKey and EOA joins are approved on chain", async () => {
    await enrollSuperEntity(host, yubi, yubiEmail, walletAddress, origin, stack.chainId, "yubikey");
    await enrollSuperEntity(host, eoaDevice, eoaEmail, walletAddress, origin, stack.chainId, "eoa");

    const yubiChain = await identityCounts(stack, yubiIdentity);
    const eoaChain = await identityCounts(stack, eoaIdentity);
    expect(yubiChain.yubikeyCount).toBe(1);
    expect(eoaChain.eoaCount).toBe(1);
  });

  test("YubiKey and EOA signatures pay a proposal", async () => {
    await setSuperThreshold(host, 2, 3);
    const before = await usdcBalance(stack.collectorAddress, stack);
    const proposalId = await createSuperPayProposal(host.page, stack.collectorAddress, "1");
    const yubiSignsBefore = crossPlatformSignCount(yubi);
    const verifySignsBefore = eoa.signedTypes.filter((type) => type === "Verify").length;

    await openSuperProposal(yubi.page, proposalId);
    await signSuperProposal(yubi.page);
    await expect(yubi.page.locator("#proposal-detail").getByText("1 / 2 signatures")).toBeVisible();

    await openSuperProposal(eoaDevice.page, proposalId);
    const executed = waitForExecute(eoaDevice.page);
    await withWorkerTicks(["bundler"], () => signSuperProposal(eoaDevice.page));
    const signature = await executed;
    expect(signature.toLowerCase().startsWith("0x53555031")).toBe(true);
    expect(crossPlatformSignCount(yubi)).toBeGreaterThan(yubiSignsBefore);
    expect(eoa.signedTypes.filter((type) => type === "Verify").length).toBeGreaterThan(verifySignsBefore);
    expect(eoa.chainIdsAtSign.every((id) => id === 11155111)).toBe(true);

    await expect
      .poll(async () => usdcBalance(stack.collectorAddress, stack), { timeout: 40_000 })
      .toBe(before + 1_000_000n);
  });

  test("lowering a blocking policy removes an entity", async () => {
    await host.page.goto("/wallet/access");
    await proposeThreshold(host.page, "3");
    const raiseId = proposalIdFrom(host.page);
    await signSuperProposal(host.page);
    await openSuperProposal(yubi.page, raiseId);
    await withWorkerTicks(["bundler"], () => signSuperProposal(yubi.page));
    await expect.poll(() => walletThreshold(stack, walletAddress)).toBe(3);

    await host.page.goto("/wallet/access");
    await expect(host.page.getByTestId("remove-entity-blocked").first()).toContainText("at least 3 of 3");

    await proposeThreshold(host.page, "1");
    const lowerId = proposalIdFrom(host.page);
    await signSuperProposal(host.page);
    await openSuperProposal(yubi.page, lowerId);
    await signSuperProposal(yubi.page);
    await openSuperProposal(eoaDevice.page, lowerId);
    await withWorkerTicks(["bundler"], () => signSuperProposal(eoaDevice.page));
    await expect.poll(() => walletThreshold(stack, walletAddress)).toBe(1);

    await host.page.goto("/wallet/access");
    const row = host.page.locator(`[data-entity-id="${eoaIdentity}"]`);
    host.page.once("dialog", (dialog) => dialog.accept());
    await withWorkerTicks(["bundler"], async () => {
      await row.getByTestId("remove-entity").click();
      await expect(host.page.getByText("Active · 1-of-2 entities")).toBeVisible({ timeout: 60_000 });
    });
    expect(await isSigner(stack, walletAddress, eoaIdentity)).toBe(false);
    expect(await isSigner(stack, walletAddress, hostIdentity)).toBe(true);
    expect(await isSigner(stack, walletAddress, yubiIdentity)).toBe(true);
  });

  test("removes a non-last key and blocks the last one", async () => {
    await yubi.page.goto("/wallet/access");
    const row = yubi.page.locator(`[data-entity-id="${yubiIdentity}"]`);
    await expect(row.getByText("Security key")).toBeVisible({ timeout: 20_000 });
    yubi.page.once("dialog", (dialog) => dialog.accept());
    await withWorkerTicks(["bundler"], async () => {
      await row.locator("li", { hasText: "Security key" }).getByTestId("remove-key").click();
      await expect(row.getByText("Security key")).toHaveCount(0, { timeout: 60_000 });
    });
    expect((await identityCounts(stack, yubiIdentity)).yubikeyCount).toBe(0);

    let userOps = 0;
    const onRequest = (req: { method: () => string; url: () => string }) => {
      if (req.method() === "POST" && req.url().includes("/api/wallet/userops")) userOps += 1;
    };
    yubi.page.on("request", onRequest);
    await row.getByTestId("remove-key").click();
    await expect(yubi.page.locator("#super-status")).toContainText("at least one key");
    yubi.page.off("request", onRequest);
    expect(userOps).toBe(0);
    expect((await identityCounts(stack, yubiIdentity)).methodCount).toBeGreaterThan(0);
  });
});

async function openEoaDevice(
  browser: Browser,
  rpcUrl: string
): Promise<{ device: DeviceSession; eoa: E2eEoaSession }> {
  const keys = emptyDeviceKeys();
  const context = await browser.newContext();
  await installE2eWebAuthn(context, keys);
  const eoa = await installE2eEoa(context, rpcUrl);
  const page = await context.newPage();
  return { device: { context, page, keys }, eoa };
}

async function activeIdentity(page: Page): Promise<string> {
  const id = await page.evaluate(() => {
    const active = localStorage.getItem("tc-wallet-active");
    const registry = JSON.parse(localStorage.getItem("tc-wallet-registry") || "[]") as {
      address?: string;
      identityId?: string;
    }[];
    return registry.find((w) => w.address?.toLowerCase() === active?.toLowerCase())?.identityId ?? "";
  });
  if (!id.startsWith("0x")) throw new Error("identity id missing from the wallet session");
  return id;
}

async function identityCounts(stack: LocalStack, identityId: string) {
  if (!stack.storeAddress) throw new Error("local stack missing IdentityStore address");
  const provider = new JsonRpcProvider(stack.rpcUrl);
  const store = new Contract(stack.storeAddress, STORE_ABI, provider);
  const rec = await store.getIdentity(identityId);
  return {
    methodCount: Number(rec.methodCount),
    yubikeyCount: Number(rec.yubikeyCount),
    eoaCount: Number(rec.eoaCount),
  };
}

async function walletThreshold(stack: LocalStack, wallet: string): Promise<number> {
  const provider = new JsonRpcProvider(stack.rpcUrl);
  const contract = new Contract(wallet, WALLET_ABI, provider);
  return Number(await contract.threshold());
}

async function isSigner(stack: LocalStack, wallet: string, identityId: string): Promise<boolean> {
  const provider = new JsonRpcProvider(stack.rpcUrl);
  const contract = new Contract(wallet, WALLET_ABI, provider);
  return Boolean(await contract.isSigner(identityId));
}

function crossPlatformSignCount(device: DeviceSession): number {
  return device.keys.credentials
    .filter((cred) => cred.attachment === "cross-platform")
    .reduce((sum, cred) => sum + cred.signCount, 0);
}

function proposalIdFrom(page: Page): string {
  const id = new URL(page.url()).searchParams.get("id");
  if (!id) throw new Error("proposal id missing from URL");
  return id;
}

async function proposeThreshold(page: Page, next: string): Promise<void> {
  await page.getByRole("button", { name: "Policy" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.locator("#policy-threshold-dialog").fill(next);
  await dialog.getByRole("button", { name: "Apply on-chain" }).click();
  await expect(page.locator("#proposal-detail")).toBeVisible({ timeout: 20_000 });
}

function waitForExecute(page: Page): Promise<string> {
  return page
    .waitForResponse(
      (res) =>
        res.url().includes("/proposals/") &&
        res.url().endsWith("/execute") &&
        res.request().method() === "POST",
      { timeout: 60_000 }
    )
    .then(async (res) => {
      const body = (await res.json()) as {
        error?: string;
        message?: string;
        userOp?: { userOp?: { signature?: string } };
      };
      if (!res.ok()) throw new Error(body.message || body.error || `execute failed ${res.status()}`);
      const signature = body.userOp?.userOp?.signature;
      if (!signature) throw new Error("execute response missing userOp signature");
      return signature;
    });
}
