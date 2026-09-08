import { expect, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { Contract, JsonRpcProvider, Wallet } from "ethers";
import { apiBase, isTestnetE2e, loadLocalStack, sleep, triggerWorker, withWorkerTicks, type LocalStack } from "./stack.js";
import { emptyDeviceKeys, installE2eWebAuthn, type DeviceKeys } from "./webauthn-shim.js";

const ERC20_ABI = [
  "function mint(address to, uint256 amount)",
  "function transfer(address to, uint256 amount) returns (bool)",
  "function balanceOf(address) view returns (uint256)",
] as const;

export type DeviceSession = {
  context: BrowserContext;
  page: Page;
  keys: DeviceKeys;
};

export async function openDevice(browser: Browser): Promise<DeviceSession> {
  const keys = emptyDeviceKeys();
  const context = await browser.newContext();
  await installE2eWebAuthn(context, keys);
  const page = await context.newPage();
  return { context, page, keys };
}

export async function createWalletFromUi(page: Page, label: string): Promise<string> {
  await page.goto("/wallet/create");
  await page.getByTestId("device-name").fill(label);
  await page.getByTestId("wallet-accept-terms").click();
  await page.getByTestId("wallet-accept-security-checks").click();
  await expect(page.getByTestId("wallet-create-btn")).toBeEnabled({ timeout: 15_000 });
  const created = page.waitForResponse(
    (res) =>
      res.url().includes("/api/wallet/accounts") &&
      res.request().method() === "POST" &&
      res.status() === 201
  );
  await page.getByTestId("wallet-create-btn").click();
  await page.getByTestId("wallet-create-disclaimer-skip").click();
  await page.getByTestId("wallet-create-disclaimer-finish").click();
  const res = await created;
  const body = (await res.json()) as { account?: { address?: string } };
  const address = body.account?.address;
  if (!address) throw new Error("wallet create did not return address");
  await expect(page).toHaveURL(/\/wallet\/?$/, { timeout: 30_000 });
  return address;
}

export async function fundUsdc(address: string, amountAtoms: bigint, stack?: LocalStack): Promise<void> {
  const env = stack ?? (await loadLocalStack());
  const provider = new JsonRpcProvider(env.rpcUrl);
  const owner = new Wallet(env.ownerKey, provider);
  const token = new Contract(env.usdcAddress, ERC20_ABI, owner);
  const tx = isTestnetE2e() ? await token.transfer(address, amountAtoms) : await token.mint(address, amountAtoms);
  await tx.wait();
}

export async function payInvoiceUsdc(invoiceAddress: string, amountAtoms: bigint, stack?: LocalStack): Promise<void> {
  const env = stack ?? (await loadLocalStack());
  const provider = new JsonRpcProvider(env.rpcUrl);
  const payer = new Wallet(env.payerKey, provider);
  const token = new Contract(env.usdcAddress, ERC20_ABI, payer);
  const before = BigInt(await token.balanceOf(invoiceAddress));
  const tx = await token.transfer(invoiceAddress, amountAtoms);
  await tx.wait();
  const after = BigInt(await token.balanceOf(invoiceAddress));
  if (after < before + amountAtoms) {
    throw new Error(
      `invoice ${invoiceAddress} USDC did not increase by ${amountAtoms} (before=${before} after=${after})`
    );
  }
}

export async function usdcBalance(address: string, stack?: LocalStack): Promise<bigint> {
  const env = stack ?? (await loadLocalStack());
  const provider = new JsonRpcProvider(env.rpcUrl);
  const token = new Contract(env.usdcAddress, ERC20_ABI, provider);
  return BigInt(await token.balanceOf(address));
}

export async function pokeWalletBalance(address: string): Promise<void> {
  const res = await fetch(`${apiBase()}/api/wallet/balance?wallet=${encodeURIComponent(address)}`);
  if (!res.ok) {
    throw new Error(`balance poke failed: ${res.status} ${await res.text()}`);
  }
}

export async function waitForDeployed(address: string, timeoutMs = 30_000): Promise<void> {
  const base = apiBase();
  const stack = await loadLocalStack();
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await pokeWalletBalance(address).catch(() => undefined);
    await triggerWorker("deployer", stack).catch(() => undefined);
    const res = await fetch(`${base}/api/wallet/accounts/${address}`);
    if (res.ok) {
      const body = (await res.json()) as { account?: { deployedChains?: string[] } };
      if (body.account?.deployedChains?.includes("11155111")) return;
    }
    await sleep(200);
  }
  throw new Error(`timed out waiting for wallet-deployer createAccount ${address}`);
}

export async function waitForInvoiceStatus(
  invoiceId: string,
  statuses: string[],
  timeoutMs = 30_000
): Promise<{ id: string; status: string; invoiceAddress: string }> {
  const base = apiBase();
  const stack = await loadLocalStack();
  const deadline = Date.now() + timeoutMs;
  let last = "unfetched";
  while (Date.now() < deadline) {
    await triggerWorker("sweeper", stack).catch(() => undefined);
    const res = await fetch(`${base}/api/invoices/${encodeURIComponent(invoiceId)}`);
    if (res.ok) {
      const body = (await res.json()) as {
        invoice?: { id: string; status: string; invoiceAddress: string };
        id?: string;
        status?: string;
        invoiceAddress?: string;
      };
      const invoice = body.invoice ??
        (body.id && body.status
          ? { id: body.id, status: body.status, invoiceAddress: body.invoiceAddress ?? "" }
          : null);
      if (invoice) {
        last = invoice.status;
        if (statuses.includes(invoice.status)) return invoice;
      } else {
        last = "missing invoice fields";
      }
    } else {
      last = `HTTP ${res.status}`;
    }
    await sleep(200);
  }
  throw new Error(`timed out waiting for invoice ${invoiceId} in ${statuses.join("/")} (last: ${last})`);
}

export async function waitForUserOpIncluded(userOpHash: string, timeoutMs = 30_000): Promise<void> {
  const base = apiBase();
  const stack = await loadLocalStack();
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await triggerWorker("bundler", stack).catch(() => undefined);
    const res = await fetch(`${base}/api/wallet/userops/${userOpHash}`);
    if (res.ok) {
      const body = (await res.json()) as { userOp?: { status: string; rejectReason?: string | null } };
      const status = body.userOp?.status;
      if (status === "included") return;
      if (status === "failed" || status === "rejected") {
        throw new Error(`userOp ${status}: ${body.userOp?.rejectReason ?? status}`);
      }
    }
    await sleep(200);
  }
  throw new Error(`timed out waiting for userOp ${userOpHash}`);
}

export async function pairGuestDevice(host: DeviceSession, guest: DeviceSession, deviceName: string): Promise<void> {
  await host.page.goto("/wallet/security");
  await expect(host.page.getByTestId("devices-card")).toBeVisible({ timeout: 30_000 });
  await host.page.getByRole("button", { name: "Pair another device" }).click();
  await expect(host.page.getByTestId("pair-device-dialog")).toBeVisible();
  const link = host.page.locator("[data-testid='pair-device-dialog'] code");
  await expect(link).toHaveAttribute("title", /\/wallet\/pair\?payload=/, { timeout: 30_000 });
  const deepLink = await link.getAttribute("title");
  if (!deepLink) throw new Error("pairing dialog had no deep link");
  await guest.page.goto(deepLink);
  await guest.page.locator("#pair-device-name").fill(deviceName);
  await guest.page.locator("#pair-submit").click();
  await expect(host.page.getByTestId("pair-confirm")).toBeEnabled({ timeout: 60_000 });
  await host.page.getByTestId("pair-confirm").click();
  const paired = host.page.getByText("Device paired.");
  const pairErr = host.page.locator("[data-testid='pair-device-dialog'] [role='status']");
  await withWorkerTicks(["bundler"], async () => {
    await expect(paired.or(pairErr)).toBeVisible({ timeout: 30_000 });
  });
  if (await pairErr.isVisible() && !(await paired.isVisible())) {
    throw new Error(`pairing failed: ${(await pairErr.textContent()) ?? "unknown"}`);
  }
  await expect(guest.page).toHaveURL(/\/wallet\/?$/, { timeout: 60_000 });
}

export async function confirmSimpleSend(page: Page, recipient: string, amount: string): Promise<void> {
  await page.goto("/wallet/send");
  await expect(page.locator("#send-recipient")).toBeEnabled({ timeout: 120_000 });
  await page.locator("#send-recipient").fill(recipient);
  await page.locator("#send-amount").fill(amount);
  await page.getByRole("button", { name: "Review payment" }).click();
  await page.getByRole("button", { name: "Send with passkey" }).click();
  const sent = page.getByText("Payment sent");
  const failed = page.getByRole("status").filter({ hasText: /timed out|failed|rejected|insufficient|invalid/i });
  await withWorkerTicks(["bundler"], async () => {
    await expect(sent.or(failed)).toBeVisible({ timeout: 30_000 });
  });
  if (await failed.isVisible() && !(await sent.isVisible())) {
    throw new Error(`send failed: ${(await failed.textContent()) ?? "unknown"}`);
  }
  await expect(sent).toBeVisible();
}

async function signAndExecuteProposal(page: Page): Promise<void> {
  const detail = page.locator("#proposal-detail");
  await expect(detail).toBeVisible({ timeout: 30_000 });
  await page.locator("#sign-proposal").click();
  const execute = page.locator("#execute-proposal");
  await withWorkerTicks(["bundler"], async () => {
    const deadline = Date.now() + 30_000;
    let clicked = false;
    while (Date.now() < deadline) {
      const text = (await detail.textContent()) ?? "";
      if (/executed/i.test(text)) return;
      if (!clicked && (await execute.isEnabled())) {
        await execute.click();
        clicked = true;
      }
      await page.waitForTimeout(200);
    }
    throw new Error(`proposal did not reach executed (${((await detail.textContent()) ?? "").slice(0, 200)})`);
  });
}

export async function executeSuperTransfer(page: Page, recipient: string, amount: string): Promise<void> {
  await page.goto("/wallet/send");
  await expect(page.getByTestId("super-wallet-pay")).toBeVisible({ timeout: 30_000 });
  await page.locator("#prop-recipient").fill(recipient);
  await page.locator("#prop-amount").fill(amount);
  await page.locator("#review-proposal").click();
  await page.locator("#create-proposal").click();
  await signAndExecuteProposal(page);
}

export async function executeSuperContractCall(page: Page, target: string, data: string): Promise<void> {
  await page.goto("/wallet/send");
  await expect(page.getByTestId("super-wallet-pay")).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "Contract call" }).click();
  await page.locator("#prop-call-target").fill(target);
  await page.locator("#prop-call-data").fill(data);
  await page.locator("#create-call-proposal").click();
  await signAndExecuteProposal(page);
}

export function superJoinUrl(origin: string, walletAddress: string, chainId: string): string {
  const payload = `tcsw-join:v1:${chainId}:${walletAddress}`;
  const encoded = Buffer.from(payload).toString("base64url");
  return `${origin.replace(/\/$/, "")}/wallet/join-super?payload=${encoded}`;
}

export async function addSuperEntity(host: DeviceSession, email: string): Promise<void> {
  await host.page.goto("/wallet/access");
  await expect(host.page.getByTestId("access-page")).toBeVisible({ timeout: 30_000 });
  await host.page.locator("#add-entity").click();
  const dialog = host.page.getByRole("dialog");
  await dialog.locator("#entity-email-dialog").fill(email);
  await withWorkerTicks(["bundler"], async () => {
    await dialog.getByRole("button", { name: "Add entity" }).click();
    await expect(host.page.getByText(email, { exact: true })).toBeVisible({ timeout: 30_000 });
  });
}

export async function enrollSuperEntity(
  host: DeviceSession,
  guest: DeviceSession,
  email: string,
  walletAddress: string,
  origin: string,
  chainId: string
): Promise<void> {
  await guest.page.goto(superJoinUrl(origin, walletAddress, chainId));
  await guest.page.locator("#join-email").fill(email);
  await guest.page.locator("#join-passkey").click();
  await expect(guest.page.locator("#join-wait")).toBeVisible({ timeout: 15_000 });
  await host.page.goto("/wallet/access");
  await expect(host.page.getByRole("button", { name: "Approve key" })).toBeVisible({ timeout: 15_000 });
  await withWorkerTicks(["bundler"], async () => {
    await host.page.getByRole("button", { name: "Approve key" }).click();
    await expect(guest.page).toHaveURL(/\/wallet\/?$/, { timeout: 30_000 });
  });
}

export async function setSuperThreshold(host: DeviceSession, threshold: number, entityCount: number): Promise<void> {
  await host.page.goto("/wallet/access");
  await expect(host.page.getByTestId("access-page")).toBeVisible({ timeout: 30_000 });
  await host.page.getByRole("button", { name: "Policy" }).click();
  const dialog = host.page.getByRole("dialog");
  await dialog.locator("#policy-threshold-dialog").fill(String(threshold));
  await withWorkerTicks(["bundler"], async () => {
    await dialog.getByRole("button", { name: "Apply on-chain" }).click();
    const applied = host.page.getByText(`Active · ${threshold}-of-${entityCount} entities`);
    const failed = host.page.locator("#super-status.text-destructive");
    await expect(applied.or(failed)).toBeVisible({ timeout: 30_000 });
    if (await failed.isVisible() && !(await applied.isVisible())) {
      throw new Error(`set threshold failed: ${(await failed.textContent()) ?? "unknown"}`);
    }
  });
}

export async function createSuperPayProposal(page: Page, recipient: string, amount: string): Promise<string> {
  await page.goto("/wallet/send");
  await expect(page.getByTestId("super-wallet-pay")).toBeVisible({ timeout: 30_000 });
  await page.locator("#prop-recipient").fill(recipient);
  await page.locator("#prop-amount").fill(amount);
  await page.locator("#review-proposal").click();
  await page.locator("#create-proposal").click();
  await expect(page.locator("#proposal-detail")).toBeVisible({ timeout: 30_000 });
  const id = new URL(page.url()).searchParams.get("id");
  if (!id) throw new Error("proposal id missing from URL");
  return id;
}

export async function openSuperProposal(page: Page, proposalId: string): Promise<void> {
  await page.goto(`/wallet/send?id=${proposalId}`);
  await expect(page.locator("#proposal-detail")).toBeVisible({ timeout: 30_000 });
}

export async function signSuperProposal(page: Page): Promise<void> {
  await expect(page.locator("#proposal-detail")).toBeVisible({ timeout: 30_000 });
  await page.locator("#sign-proposal").click();
  await expect(page.getByText(/Signature recorded|Proposal executed/i)).toBeVisible({ timeout: 30_000 });
}

export async function expectExecuteDisabled(page: Page): Promise<void> {
  await expect(page.locator("#execute-proposal")).toBeDisabled();
}

export async function executeSuperProposal(page: Page): Promise<void> {
  await withWorkerTicks(["bundler"], async () => {
    const executed = page.getByText("Proposal executed");
    if (await executed.isVisible()) return;
    await expect(page.locator("#execute-proposal")).toBeEnabled({ timeout: 15_000 });
    await page.locator("#execute-proposal").click();
    await expect(executed).toBeVisible({ timeout: 30_000 });
  });
}

export async function executeProposalExpectNoSignatures(walletAddress: string, proposalId: string): Promise<void> {
  const res = await fetch(`${apiBase()}/api/wallet/${walletAddress}/proposals/${proposalId}/execute`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  if (res.status !== 400 || body.error !== "no_signatures") {
    throw new Error(`expected no_signatures, got ${res.status} ${JSON.stringify(body)}`);
  }
}
