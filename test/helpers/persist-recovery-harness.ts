import { createServer, type IncomingMessage, type Server } from "node:http";
import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Contract, JsonRpcProvider, Wallet, ethers as ethersLib, getAddress } from "ethers";
import { createApp, type App } from "../../commerce/server/app.js";
import { loadConfig } from "../../commerce/server/config.js";
import { resetRateLimitBuckets } from "../../commerce/server/rate-limit.js";
import { SweeperWorker, type SweeperConfig } from "../../commerce/sweeper/worker.js";
import { WalletDeployerWorker, type WalletDeployerConfig } from "../../commerce/wallet-deployer/worker.js";
import { deriveWalletSalt, predictWalletAddress } from "../../commerce/shared/wallet-address.js";
import { ENTRYPOINT_V09, ERC7821_BATCH_MODE, encodeBatch, encodeErc20Transfer } from "../../commerce/shared/userop.js";

export const HH_DEPLOYER_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
export const PRODUCT_CHAIN_ID = "11155111";
export const FEE_BPS = 50;
export const PAY_UNITS = 1_000_000n; // $1.00 USDC (6 decimals)

const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function transfer(address to, uint256 amount) returns (bool)",
  "function mint(address to, uint256 amount)",
] as const;

export type PersistRecoveryStack = {
  sweeperAddress: string;
  forwarderImplementation: string;
  factoryAddress: string;
  implementationAddress: string;
  recoveryAddress: string;
  usdcAddress: string;
  feeRecipient: string;
  owner: Wallet;
  payer: Wallet;
  collector: Wallet;
};

export type JsonRpcHandle = { url: string; close: () => Promise<void> };

export function expectedMerchantAmount(paid: bigint, feeBps = FEE_BPS): bigint {
  return paid - (paid * BigInt(feeBps)) / 10_000n;
}

export async function startJsonRpcServer(
  provider: { send(method: string, params?: unknown[]): Promise<unknown> }
): Promise<JsonRpcHandle> {
  const server: Server = createServer((req, res) => {
    void handleJsonRpc(provider, req, res);
  });
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("expected TCP address");
  return {
    url: `http://127.0.0.1:${addr.port}`,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}

async function handleJsonRpc(
  provider: { send(method: string, params?: unknown[]): Promise<unknown> },
  req: IncomingMessage,
  res: import("node:http").ServerResponse
): Promise<void> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}") as unknown;
    const respond = async (msg: { id?: unknown; method?: string; params?: unknown[] }) => {
      try {
        const result = await provider.send(msg.method ?? "", msg.params ?? []);
        return { jsonrpc: "2.0", id: msg.id ?? 1, result };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { jsonrpc: "2.0", id: msg.id ?? 1, error: { message, code: -32000 } };
      }
    };
    res.writeHead(200, { "content-type": "application/json" });
    if (Array.isArray(parsed)) {
      const out = [];
      for (const msg of parsed as Array<{ id?: unknown; method?: string; params?: unknown[] }>) {
        out.push(await respond(msg));
      }
      res.end(JSON.stringify(out));
      return;
    }
    res.end(JSON.stringify(await respond(parsed as { id?: unknown; method?: string; params?: unknown[] })));
  } catch (error) {
    res.writeHead(400, { "content-type": "application/json" });
    res.end(JSON.stringify({ jsonrpc: "2.0", id: null, error: { message: String(error) } }));
  }
}

export async function deployPersistRecoveryStack(ethers: {
  getSigners: () => Promise<Wallet[]>;
  getContractFactory: (name: string) => Promise<{
    deploy: (...args: unknown[]) => Promise<{
      waitForDeployment?: () => Promise<void>;
      getAddress: () => Promise<string>;
      interface: { parseLog: (log: unknown) => { name: string; args: Record<string, string> } | null };
    }>;
  }>;
  getContractAt: (name: string, address: string) => Promise<{ forwarderImplementation?: () => Promise<string> }>;
}): Promise<PersistRecoveryStack> {
  const [owner, payer, collector] = await ethers.getSigners();
  const Deployer = await ethers.getContractFactory("CommerceSystemDeployer");
  const systemDeployer = await Deployer.deploy();
  await systemDeployer.waitForDeployment?.();
  const tx = await (systemDeployer as unknown as { deploy: Function }).deploy(
    await owner.getAddress(),
    FEE_BPS,
    await owner.getAddress()
  );
  const receipt = await tx.wait();
  const deployed = receipt?.logs
    .map((log: unknown) => {
      try {
        return systemDeployer.interface.parseLog(log);
      } catch {
        return null;
      }
    })
    .find((log: { name: string } | null) => log?.name === "CommerceSystemDeployed");
  if (!deployed) throw new Error("CommerceSystemDeployed not found");
  const sweeperAddress = getAddress(deployed.args.sweeper);
  const sweeper = await ethers.getContractAt("CommerceInvoiceSweeper", sweeperAddress);
  const forwarderImplementation = await (sweeper as { forwarderImplementation: () => Promise<string> }).forwarderImplementation();

  const WalletImpl = await ethers.getContractFactory("Wallet");
  const walletImpl = await WalletImpl.deploy();
  await walletImpl.waitForDeployment?.();
  const Recovery = await ethers.getContractFactory("AdminGuardianRecovery");
  const recovery = await Recovery.deploy(await owner.getAddress(), await owner.getAddress());
  await recovery.waitForDeployment?.();
  const Factory = await ethers.getContractFactory("WalletFactory");
  const factory = await Factory.deploy(
    await walletImpl.getAddress(),
    await recovery.getAddress(),
    3600n,
    await owner.getAddress()
  );
  await factory.waitForDeployment?.();

  const Token = await ethers.getContractFactory("MockERC20");
  const token = await Token.deploy("USD Coin", "USDC", 6);
  await token.waitForDeployment?.();
  const usdcAddress = await token.getAddress();
  await (token as unknown as { mint: Function }).mint(await payer.getAddress(), 50_000n * PAY_UNITS);

  return {
    sweeperAddress,
    forwarderImplementation,
    factoryAddress: await factory.getAddress(),
    implementationAddress: await walletImpl.getAddress(),
    recoveryAddress: await recovery.getAddress(),
    usdcAddress,
    feeRecipient: await owner.getAddress(),
    owner: owner as unknown as Wallet,
    payer: payer as unknown as Wallet,
    collector: collector as unknown as Wallet,
  };
}

export async function listenApp(app: App): Promise<string> {
  await new Promise<void>((resolve) => {
    app.server.listen(0, "127.0.0.1", () => resolve());
  });
  const addr = app.server.address();
  if (!addr || typeof addr === "string") throw new Error("expected TCP address");
  return `http://127.0.0.1:${addr.port}`;
}

export function persistRecoveryApiEnv(input: {
  dbPath: string;
  persistLogDir: string;
  rpcUrl: string;
  stack: PersistRecoveryStack;
}): NodeJS.ProcessEnv {
  return {
    ...process.env,
    PORT: "0",
    ADMIN_API_KEY: "admin-persist-recovery",
    SWEEPER_API_KEY: "sweeper-persist-recovery",
    DB_PATH: input.dbPath,
    PERSIST_LOG_DIR: input.persistLogDir,
    EVM_RPC_URL: input.rpcUrl,
    SWEEPER_ADDRESS: input.stack.sweeperAddress,
    FORWARDER_IMPLEMENTATION: input.stack.forwarderImplementation,
    WALLET_FACTORY_ADDRESS: input.stack.factoryAddress,
    WALLET_IMPLEMENTATION_ADDRESS: input.stack.implementationAddress,
    WALLET_RECOVERY_ADDRESS: input.stack.recoveryAddress,
    WALLET_RPC_URL: input.rpcUrl,
    WALLET_CHAIN_ID: PRODUCT_CHAIN_ID,
    WALLET_BUNDLER_FEE_TOKEN: input.stack.usdcAddress,
    TURNSTILE_SECRET: "",
    RATE_LIMIT_CREATE_PER_SECOND: "500",
    RATE_LIMIT_PUBLIC_PER_SECOND: "500",
    RATE_LIMIT_SWEEPER_PER_SECOND: "500",
  } as NodeJS.ProcessEnv;
}

export async function startPersistApi(env: NodeJS.ProcessEnv): Promise<{ app: App; baseUrl: string }> {
  resetRateLimitBuckets();
  const app = createApp(loadConfig(env));
  const baseUrl = await listenApp(app);
  return { app, baseUrl };
}

export async function registerSweeper(baseUrl: string, address: string, adminKey: string): Promise<void> {
  const res = await fetch(`${baseUrl}/api/admin/sweepers`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": adminKey },
    body: JSON.stringify({
      address,
      label: "persist-recovery-sweeper",
      chains: [PRODUCT_CHAIN_ID],
      enabled: true,
    }),
  });
  if (res.status !== 201 && res.status !== 200) {
    throw new Error(`register sweeper failed: ${res.status} ${await res.text()}`);
  }
}

export async function createPasskeyWallet(
  baseUrl: string,
  factory: string,
  impl: string,
  index: number
): Promise<{ address: string; salt: string; ownerQx: string; ownerQy: string; credentialId: string }> {
  const ownerQx = ethersLib.zeroPadValue(ethersLib.toBeHex(index + 1), 32);
  const ownerQy = ethersLib.zeroPadValue(ethersLib.toBeHex(index + 101), 32);
  const salt = deriveWalletSalt(ownerQx, ownerQy);
  const address = predictWalletAddress(factory, impl, salt);
  const credentialId = `cred-persist-${index}`;
  const res = await fetch(`${baseUrl}/api/wallet/accounts`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      address,
      salt,
      ownerQx,
      ownerQy,
      credentialId,
    }),
  });
  if (res.status !== 201) {
    throw new Error(`create wallet failed: ${res.status} ${await res.text()}`);
  }
  return { address, salt, ownerQx, ownerQy, credentialId };
}

export async function createInvoiceForWallet(
  baseUrl: string,
  wallet: string
): Promise<{ id: string; invoiceAddress: string; selectedTo: string; invoiceSeed: string }> {
  const res = await fetch(`${baseUrl}/api/invoices`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      price: "1.00",
      to: [wallet],
      chains: [PRODUCT_CHAIN_ID],
      tokens: ["USDC"],
      chainId: PRODUCT_CHAIN_ID,
      token: "USDC",
      selectedTo: wallet,
    }),
  });
  if (res.status !== 201) {
    throw new Error(`create invoice failed: ${res.status} ${await res.text()}`);
  }
  const body = (await res.json()) as {
    invoice: { id: string; invoiceAddress: string; selectedTo: string; invoiceSeed: string };
  };
  return body.invoice;
}

export async function payInvoice(
  usdc: Contract,
  payer: Wallet,
  invoiceAddress: string,
  amount = PAY_UNITS
): Promise<void> {
  const tx = await (usdc.connect(payer) as Contract).transfer(invoiceAddress, amount);
  await tx.wait();
}

export function makeSweeperWorker(input: {
  baseUrl: string;
  rpcUrl: string;
  stack: PersistRecoveryStack;
  privateKey: string;
}): SweeperWorker {
  const config: SweeperConfig = {
    serverUrl: input.baseUrl,
    apiKey: "sweeper-persist-recovery",
    sweeperWalletKey: input.privateKey,
    intervalMs: 50,
    maxRetries: 5,
    role: "evm",
    chains: [
      {
        chainId: PRODUCT_CHAIN_ID,
        rpcUrl: input.rpcUrl,
        sweeperAddress: input.stack.sweeperAddress,
        privateKey: input.privateKey,
        tokens: [{ symbol: "USDC", address: input.stack.usdcAddress, decimals: 6 }],
      },
    ],
  };
  return new SweeperWorker(config);
}

export function makeWalletDeployer(input: {
  baseUrl: string;
  rpcUrl: string;
  stack: PersistRecoveryStack;
  privateKey: string;
}): WalletDeployerWorker {
  const config: WalletDeployerConfig = {
    serverUrl: input.baseUrl,
    sweeperApiKey: "sweeper-persist-recovery",
    intervalMs: 50,
    chains: [
      {
        chainId: PRODUCT_CHAIN_ID,
        rpcUrl: input.rpcUrl,
        factoryAddress: input.stack.factoryAddress,
        privateKey: input.privateKey,
        recoveryAddress: input.stack.recoveryAddress,
        feeTokenAddress: input.stack.usdcAddress,
        minBalanceUsdc: 1,
      },
    ],
  };
  return new WalletDeployerWorker(config);
}

export async function tickUntil(
  tick: () => Promise<void>,
  check: () => Promise<boolean>,
  timeoutMs: number,
  intervalMs = 50
): Promise<void> {
  const start = Date.now();
  let lastError: unknown;
  while (Date.now() - start < timeoutMs) {
    if (await check()) return;
    try {
      await tick();
    } catch (error) {
      lastError = error;
    }
    if (await check()) return;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  const extra = lastError instanceof Error ? lastError.stack ?? lastError.message : lastError ? String(lastError) : "";
  throw new Error(`timed out waiting for persist-recovery condition${extra ? `: ${extra}` : ""}`);
}

export async function tokenBalance(rpcUrl: string, token: string, holder: string): Promise<bigint> {
  const provider = new JsonRpcProvider(rpcUrl);
  const erc20 = new Contract(token, ERC20_ABI, provider);
  return BigInt(await erc20.balanceOf(holder));
}

export async function codeAt(rpcUrl: string, address: string): Promise<string> {
  const provider = new JsonRpcProvider(rpcUrl);
  return provider.getCode(address);
}

type HardhatEthers = {
  provider: { send: (method: string, params?: unknown[]) => Promise<unknown> };
  getSigner: (address: string) => Promise<unknown>;
  getContractAt: (name: string, address: string) => Promise<Contract>;
};

/**
 * Execute ERC-20 transfer from a deployed passkey wallet as EntryPoint (Hardhat only).
 * This is the same `Wallet.execute` path a bundler/UserOp uses after recovery.
 */
export async function sendUsdcFromWalletViaEntryPoint(input: {
  ethers: HardhatEthers;
  usdcAddress: string;
  walletAddress: string;
  collector: string;
  amount: bigint;
}): Promise<void> {
  if (input.amount <= 0n) return;
  await input.ethers.provider.send("hardhat_setBalance", [ENTRYPOINT_V09, "0x1000000000000000000"]);
  await input.ethers.provider.send("hardhat_impersonateAccount", [ENTRYPOINT_V09]);
  try {
    const epSigner = await input.ethers.getSigner(ENTRYPOINT_V09);
    const wallet = await input.ethers.getContractAt("Wallet", input.walletAddress);
    const executionData = encodeBatch([
      { target: input.usdcAddress, value: 0n, data: encodeErc20Transfer(input.collector, input.amount) },
    ]);
    const tx = await (wallet.connect(epSigner as never) as Contract).execute(ERC7821_BATCH_MODE, executionData);
    await tx.wait();
  } finally {
    await input.ethers.provider.send("hardhat_stopImpersonatingAccount", [ENTRYPOINT_V09]).catch(() => undefined);
  }
}

export async function drainWalletsToCollector(input: {
  ethers: HardhatEthers;
  rpcUrl: string;
  usdcAddress: string;
  walletAddresses: string[];
  collector: string;
}): Promise<bigint> {
  const before = await tokenBalance(input.rpcUrl, input.usdcAddress, input.collector);
  await input.ethers.provider.send("hardhat_setBalance", [ENTRYPOINT_V09, "0x1000000000000000000"]);
  await input.ethers.provider.send("hardhat_impersonateAccount", [ENTRYPOINT_V09]);
  let sent = 0n;
  try {
    const epSigner = await input.ethers.getSigner(ENTRYPOINT_V09);
    for (const walletAddress of input.walletAddresses) {
      const amount = await tokenBalance(input.rpcUrl, input.usdcAddress, walletAddress);
      if (amount <= 0n) continue;
      const wallet = await input.ethers.getContractAt("Wallet", walletAddress);
      const executionData = encodeBatch([
        { target: input.usdcAddress, value: 0n, data: encodeErc20Transfer(input.collector, amount) },
      ]);
      const tx = await (wallet.connect(epSigner as never) as Contract).execute(ERC7821_BATCH_MODE, executionData);
      await tx.wait();
      const left = await tokenBalance(input.rpcUrl, input.usdcAddress, walletAddress);
      if (left !== 0n) {
        throw new Error(`wallet ${walletAddress} still holds ${left} after collect`);
      }
      sent += amount;
    }
  } finally {
    await input.ethers.provider.send("hardhat_stopImpersonatingAccount", [ENTRYPOINT_V09]).catch(() => undefined);
  }
  const after = await tokenBalance(input.rpcUrl, input.usdcAddress, input.collector);
  if (after !== before + sent) {
    throw new Error(`collector expected ${before + sent}, got ${after}`);
  }
  return sent;
}

export async function mkPersistWorkDir(): Promise<{ dir: string; dbPath: string; persistLogDir: string }> {
  const dir = join(tmpdir(), `persist-recovery-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  await mkdir(dir, { recursive: true });
  return { dir, dbPath: join(dir, "live.db"), persistLogDir: join(dir, "persist-logs") };
}

export async function rmWorkDir(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true });
}
