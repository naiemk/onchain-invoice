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
  const created = await createIdentityWalletFromUi(page, label);
  return created.address;
}

export async function createIdentityWalletFromUi(
  page: Page,
  label: string
): Promise<{ address: string; email: string }> {
  const email = `${label.replace(/\s+/g, "-").toLowerCase()}-${Date.now()}@example.com`;
  await page.goto("/wallet");
  await page.locator("#identity-email").fill(email);
  await page.getByRole("button", { name: /^next$/i }).click();
  const sendCode = page.getByRole("button", { name: /send code/i });
  const otpField = page.locator("#identity-otp");
  await expect(sendCode.or(otpField)).toBeVisible({ timeout: 15_000 });
  if (await sendCode.isVisible()) {
    const started = page.waitForResponse(
      (res) => res.url().includes("/api/identity/email/start") && res.request().method() === "POST"
    );
    await sendCode.click();
    await started;
  }
  const otpRes = await fetch(`${apiBase()}/api/identity/email/dev-otp`);
  const otp = (await otpRes.json()) as { code?: string };
  if (!otp.code) throw new Error("dev OTP not available");
  await otpField.fill(otp.code);
  await page.getByRole("button", { name: /verify code/i }).click();
  await expect(page.getByRole("button", { name: /create first wallet/i })).toBeVisible({ timeout: 15_000 });
  await page.locator("#auth-agree-terms").click();
  await page.locator("#auth-agree-privacy").click();
  const created = page.waitForResponse(
    (res) =>
      res.url().includes("/api/identity/passkey/register") &&
      res.request().method() === "POST" &&
      res.status() === 201
  );
  await page.getByRole("button", { name: /create first wallet/i }).click();
  const res = await created;
  const body = (await res.json()) as { wallets?: { address?: string }[] };
  const address = body.wallets?.[0]?.address;
  if (!address) throw new Error("wallet create did not return address");
  await expect(page).toHaveURL(/\/wallet\/?$/, { timeout: 30_000 });
  return { address, email };
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
  const identity = await host.page.evaluate(async () => {
    const res = await fetch("/api/identity/me", { credentials: "include" });
    if (!res.ok) throw new Error(`identity me ${res.status}`);
    return (await res.json()) as { identityId: string; email?: string };
  });
  const hostAddress = await host.page.evaluate(() => {
    const active = localStorage.getItem("tc-wallet-active");
    const registryRaw = localStorage.getItem("tc-wallet-registry");
    const registry = registryRaw ? (JSON.parse(registryRaw) as Array<{ address?: string }>) : [];
    if (active) {
      const found = registry.find((w) => w.address?.toLowerCase() === active.toLowerCase());
      if (found?.address) return found.address;
    }
    const legacy = localStorage.getItem("tc-wallet-session");
    if (legacy) {
      const parsed = JSON.parse(legacy) as { address?: string };
      if (parsed.address) return parsed.address;
    }
    return registry[0]?.address ?? null;
  });
  if (!identity?.identityId) throw new Error("host has no identity");
  if (hostAddress) {
    await fundUsdc(hostAddress, 5_000_000n);
    await waitForDeployed(hostAddress).catch(() => undefined);
  }

  const qs = new URLSearchParams({ identityId: identity.identityId });
  if (identity.email) qs.set("email", identity.email);
  await guest.page.goto(`/wallet/pair?${qs}`);
  await guest.page.locator("#pair-device-name").fill(deviceName);
  await guest.page.locator("#pair-submit").click();
  await expect(guest.page.locator("#pair-qr")).toBeVisible({ timeout: 20_000 });
  await guest.page.getByRole("button", { name: "Show full link" }).click();
  const copy = guest.page.getByTestId("pair-copy-link");
  await expect(copy).toBeVisible();
  const pairUrl = await copy.getAttribute("data-url");
  if (!pairUrl) throw new Error("pairing wizard had no link");

  await host.page.goto("/wallet/security");
  await expect(host.page.getByTestId("devices-card")).toBeVisible({ timeout: 30_000 });
  await host.page.getByRole("button", { name: "Scan pairing QR code" }).click();
  await expect(host.page.getByTestId("pair-device-dialog")).toBeVisible();
  const paste = host.page.getByTestId("pair-paste-url");
  await host.page.getByRole("button", { name: "Paste URL instead" }).click({ timeout: 5_000 }).catch(() => undefined);
  await expect(paste).toBeVisible({ timeout: 10_000 });
  await paste.fill(pairUrl);
  await expect(host.page.getByTestId("pair-confirm")).toBeVisible({ timeout: 15_000 });
  await host.page.getByTestId("pair-confirm").click();
  const executed = host.page.getByTestId("pair-tx-executed");
  const pairErr = host.page.getByTestId("pair-error");
  await withWorkerTicks(["bundler"], async () => {
    await expect(executed.or(pairErr)).toBeVisible({ timeout: 60_000 });
  });
  if (await pairErr.isVisible() && !(await executed.isVisible())) {
    throw new Error(`pairing failed: ${(await pairErr.textContent()) ?? "unknown"}`);
  }

  await expect(guest.page.getByText("You are paired.")).toBeVisible({ timeout: 60_000 });
  await guest.page.getByRole("button", { name: "Log in to wallet" }).click();
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
    await dialog.getByRole("button", { name: "Add team member" }).click();
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

export async function signOut(host: DeviceSession): Promise<void> {
  await host.page.goto("/wallet");
  await host.page.getByTestId("wallet-switcher").click();
  await host.page.getByRole("menuitem", { name: "Sign out" }).click();
  await host.page.goto("/wallet");
}

export async function setStoreRecoveryOperator(superAddress: string, stack?: LocalStack): Promise<void> {
  const env = stack ?? (await loadLocalStack());
  if (!env.storeAddress) throw new Error("local stack missing IdentityStore address");
  const provider = new JsonRpcProvider(env.rpcUrl);
  const owner = new Wallet(env.ownerKey, provider);
  const store = new Contract(env.storeAddress, ["function setRecoveryOperator(address)"], owner);
  const tx = await store.setRecoveryOperator(superAddress);
  await tx.wait();
}

export async function increaseChainTime(seconds: number, stack?: LocalStack): Promise<void> {
  const env = stack ?? (await loadLocalStack());
  const provider = new JsonRpcProvider(env.rpcUrl);
  await provider.send("evm_increaseTime", [seconds]);
  await provider.send("evm_mine", []);
}

export async function convertIdentitySuper(
  host: DeviceSession,
  extraEmails: string[],
  threshold = 2
): Promise<void> {
  await host.page.goto("/wallet/super-wallet");
  await expect(host.page.getByTestId("enable-identity-super")).toBeVisible({ timeout: 30_000 });
  await host.page.locator("#super-extra-emails").fill(extraEmails.join("\n"));
  await host.page.getByTestId("super-threshold").fill(String(threshold));
  await withWorkerTicks(["bundler"], async () => {
    await host.page.getByTestId("enable-identity-super").click();
    await expect(host.page).toHaveURL(/\/wallet\/?$/, { timeout: 60_000 });
  });
  await expect(host.page.getByTestId("super-wallet-shield")).toBeVisible({ timeout: 30_000 });
}

export async function startEmailRestore(page: Page, email: string): Promise<void> {
  await page.goto("/wallet/recover");
  await page.getByRole("tab", { name: "With email" }).click();
  await page.locator("#recover-ack-no-device").click();
  await page.getByRole("button", { name: "Start recovery" }).click();
  await expect(page.getByTestId("email-recover-dialog")).toBeVisible();
  await page.locator("#recover-email").fill(email);
  const started = page.waitForResponse(
    (res) =>
      res.url().includes("/api/wallet/recovery/email/start") && res.request().method() === "POST" && res.ok()
  );
  await page.getByRole("button", { name: "Next" }).click();
  await started;
  const otpRes = await fetch(`${apiBase()}/api/identity/email/dev-otp`);
  const otp = (await otpRes.json()) as { code?: string };
  if (!otp.code) throw new Error("dev OTP not available");
  await page.locator("#recover-otp").fill(otp.code);
  await page.getByRole("button", { name: "Next" }).click();
  await expect(page.getByRole("button", { name: "Continue with passkey" })).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: "Continue with passkey" }).click();
  await expect(page.getByText(/Recovery started|already an owner/i)).toBeVisible({ timeout: 30_000 });
}

export async function signOperatorRestoreFromUi(host: DeviceSession): Promise<void> {
  await host.page.goto("/wallet");
  await expect(host.page.getByTestId("identity-operator-restores")).toBeVisible({ timeout: 30_000 });
  await withWorkerTicks(["bundler"], async () => {
    const btn = host.page.getByTestId("sign-identity-restore");
    await btn.click();
    await expect
      .poll(async () => {
        const err = host.page.locator('[data-testid="identity-operator-restores"] .text-destructive');
        if (await err.isVisible()) {
          const text = (await err.textContent())?.trim();
          if (text) throw new Error(`operator restore sign failed: ${text}`);
        }
        const cardGone = (await host.page.getByTestId("identity-operator-restores").count()) === 0;
        if (cardGone) return true;
        return btn.isEnabled();
      }, { timeout: 60_000 })
      .toBe(true);
  });
}

export async function waitForRestoreCompleted(walletAddress: string, timeoutMs = 60_000): Promise<void> {
  const stack = await loadLocalStack();
  const deadline = Date.now() + timeoutMs;
  let last = "unfetched";
  while (Date.now() < deadline) {
    await increaseChainTime(2, stack).catch(() => undefined);
    await triggerWorker("deployer", stack).catch(() => undefined);
    const res = await fetch(`${apiBase()}/api/wallet/recovery?wallet=${encodeURIComponent(walletAddress)}`);
    if (res.ok) {
      const body = (await res.json()) as {
        request?: { status?: string } | null;
        pendingOwner?: { active?: boolean } | null;
      };
      last = `${body.request?.status ?? "none"} pending=${body.pendingOwner?.active ?? false}`;
      const active = Boolean(body.request) && !["completed", "archived", "cancelled", "rejected"].includes(body.request?.status ?? "");
      if (!active && !body.pendingOwner?.active) return;
    } else {
      last = `HTTP ${res.status}`;
    }
    await sleep(200);
  }
  throw new Error(`timed out waiting for restore on ${walletAddress} (last: ${last})`);
}

export async function loginIdentityFromEmail(page: Page, email: string): Promise<void> {
  await page.goto("/wallet");
  if (await page.getByTestId("wallet-switcher").isVisible().catch(() => false)) return;
  await page.locator("#identity-email").fill(email);
  await page.getByRole("button", { name: /^next$/i }).click();
  await expect(page.getByTestId("wallet-switcher")).toBeVisible({ timeout: 30_000 });
}
