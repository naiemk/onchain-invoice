import { spawn } from "node:child_process";
import { readFile, rm, mkdir, writeFile } from "node:fs/promises";
import { Wallet } from "ethers";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const HARDHAT_PORT = process.env.E2E_HARDHAT_PORT ?? "8545";
const API_PORT = process.env.E2E_API_PORT ?? "8080";
const BUNDLER_TICK_PORT = process.env.E2E_BUNDLER_TICK_PORT ?? "18741";
const SWEEPER_TICK_PORT = process.env.E2E_SWEEPER_TICK_PORT ?? "18742";
const DEPLOYER_TICK_PORT = process.env.E2E_DEPLOYER_TICK_PORT ?? "18743";
const RPC_URL = `http://127.0.0.1:${HARDHAT_PORT}`;
const SERVER_URL = `http://127.0.0.1:${API_PORT}`;
const STACK_PATH = process.env.E2E_STACK_PATH ?? "/tmp/tc-e2e-stack.json";
const DB_PATH = process.env.E2E_DB_PATH ?? "/tmp/tc-e2e-local-stack.db";
const PERSIST_LOG_DIR = process.env.PERSIST_LOG_DIR ?? "/tmp/tc-e2e-persist-logs";
const ACTIVITY_LOG_PATH = process.env.ACTIVITY_LOG_PATH ?? "/tmp/tc-e2e-activity.jsonl";
const HH_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
/** Distinct Hardhat accounts so sweeper / bundler / deployer txs do not collide on nonce. */
const SWEEPER_KEY = "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6";
const BUNDLER_KEY = "0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a";
const DEPLOYER_KEY = "0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba";
const ADMIN_API_KEY = "e2e-admin";
const SWEEPER_API_KEY = "e2e-sweeper";

const children = [];

function spawnInherit(command, args, extraEnv = {}) {
  const child = spawn(command, args, {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, ...extraEnv },
  });
  children.push(child);
  child.on("exit", (code, signal) => {
    if (code && code !== 0) {
      console.error(`${command} ${args.join(" ")} exited ${code} ${signal ?? ""}`);
    }
  });
  return child;
}

async function waitForRpc(timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(RPC_URL, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }),
      });
      const body = await res.json();
      const chainId = Number.parseInt(String(body.result ?? "0x0"), 16);
      if (chainId === 11155111) return;
      if (chainId) {
        throw new Error(`Hardhat chainId is ${chainId}; start the node with --network e2eLocal`);
      }
    } catch (error) {
      if (error instanceof Error && error.message.includes("chainId")) throw error;
    }
    await sleep(500);
  }
  throw new Error(`Hardhat RPC not ready at ${RPC_URL}`);
}

async function waitForTickHealth(port, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/health`);
      if (res.ok) return;
    } catch {
      /* retry */
    }
    await sleep(100);
  }
  throw new Error(`worker tick server not ready at 127.0.0.1:${port}`);
}

async function waitForHealth(timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${SERVER_URL}/api/health`);
      if (res.ok) return;
    } catch {
      /* retry */
    }
    await sleep(300);
  }
  throw new Error(`API health not ready at ${SERVER_URL}`);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function runDeploy() {
  await new Promise((resolvePromise, reject) => {
    const child = spawn("npx", ["hardhat", "run", "ui/e2e/stack/deploy-local-stack.ts", "--network", "localhost"], {
      cwd: root,
      stdio: "inherit",
      env: {
        ...process.env,
        HARDHAT_RPC_URL: RPC_URL,
        E2E_STACK_PATH: STACK_PATH,
        EVM_PRIVATE_KEY: "",
        SWEEPER_PRIVATE_KEY: "",
      },
    });
    child.on("exit", (code) => {
      if (code === 0) resolvePromise();
      else reject(new Error(`deploy-local-stack exited ${code}`));
    });
  });
}

async function registerWorkers(sweeperAddress, bundlerAddress) {
  const headers = { "content-type": "application/json", "x-api-key": ADMIN_API_KEY };
  const sweeper = await fetch(`${SERVER_URL}/api/admin/sweepers`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      address: sweeperAddress,
      label: "e2e-sweeper",
      chains: ["11155111"],
      enabled: true,
    }),
  });
  if (sweeper.status !== 201 && sweeper.status !== 200) {
    throw new Error(`register sweeper failed: ${sweeper.status} ${await sweeper.text()}`);
  }
  const bundler = await fetch(`${SERVER_URL}/api/admin/bundlers`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      address: bundlerAddress,
      label: "e2e-bundler",
      chains: ["11155111"],
      enabled: true,
    }),
  });
  if (bundler.status !== 201 && bundler.status !== 200) {
    throw new Error(`register bundler failed: ${bundler.status} ${await bundler.text()}`);
  }
}

function shutdown() {
  for (const child of children) {
    try {
      child.kill("SIGTERM");
    } catch {
      /* ignore */
    }
  }
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    shutdown();
    process.exit(0);
  });
}
process.on("exit", shutdown);

await waitForRpc();
await rm(DB_PATH, { force: true });
await rm(`${DB_PATH}-wal`, { force: true });
await rm(`${DB_PATH}-shm`, { force: true });
await mkdir(PERSIST_LOG_DIR, { recursive: true });
await runDeploy();

const stack = JSON.parse(await readFile(STACK_PATH, "utf8"));
const sweeperWalletAddress = new Wallet(SWEEPER_KEY).address;
const bundlerAddress = new Wallet(BUNDLER_KEY).address;

const apiEnv = {
  PORT: API_PORT,
  BASE_URL: SERVER_URL,
  DB_PATH,
  PERSIST_LOG_DIR,
  ADMIN_API_KEY,
  SWEEPER_API_KEY,
  EVM_RPC_URL: RPC_URL,
  WALLET_RPC_URL: RPC_URL,
  SWEEPER_ADDRESS: stack.sweeperAddress,
  FORWARDER_IMPLEMENTATION: stack.forwarderImplementation,
  WALLET_FACTORY_ADDRESS: stack.factoryAddress,
  WALLET_IMPLEMENTATION_ADDRESS: stack.implementationAddress,
  WALLET_RECOVERY_ADDRESS: stack.recoveryAddress,
  WALLET_CHAIN_ID: "11155111",
  WALLET_BUNDLER_FEE_TOKEN: stack.usdcAddress,
  WALLET_BUNDLER_FEE_USDC: "100000",
  WALLET_BUNDLER_BENEFICIARY: stack.ownerAddress,
  WALLET_ENTRYPOINT_ADDRESS: stack.entryPointAddress,
  WALLET_FEE_TOKEN_SYMBOL: "USDC",
  WALLET_FEE_TOKEN_DECIMALS: "6",
  TURNSTILE_SECRET: "",
  TURNSTILE_SITE_KEY: "",
  RATE_LIMIT_CREATE_PER_SECOND: "500",
  RATE_LIMIT_PUBLIC_PER_SECOND: "500",
  RATE_LIMIT_SWEEPER_PER_SECOND: "500",
  ONRAMPER_ENABLED: "0",
  ONRAMPER_API_KEY: "",
  ONRAMPER_SECRET_KEY: "",
  ONRAMPER_SIGNING_KEY: "",
  SERVER_URL,
  BUNDLER_WALLET_KEY: BUNDLER_KEY,
  BUNDLER_PRIVATE_KEY: BUNDLER_KEY,
  BUNDLER_ADDRESS: bundlerAddress,
  SWEEPER_WALLET_KEY: SWEEPER_KEY,
  SWEEPER_PRIVATE_KEY: SWEEPER_KEY,
  WALLET_DEPLOYER_PRIVATE_KEY: DEPLOYER_KEY,
  WALLET_GUARDIAN_PRIVATE_KEY: HH_KEY,
  ACTIVITY_LOG_PATH,
  SWEEPER_ROLE: "evm",
  CONFIG_PATH: resolve(root, "ui/e2e/stack/api.yaml"),
  BUNDLER_CONFIG: resolve(root, "ui/e2e/stack/bundler.yaml"),
  SWEEPER_CONFIG: resolve(root, "ui/e2e/stack/sweeper.yaml"),
  WALLET_DEPLOYER_CONFIG: resolve(root, "ui/e2e/stack/wallet-deployer.yaml"),
};

spawnInherit("node", ["commerce-dist/server/index.js"], apiEnv);
await waitForHealth();
await registerWorkers(sweeperWalletAddress, bundlerAddress);

spawnInherit("node", ["commerce-dist/bundler/index.js"], { ...apiEnv, WORKER_TICK_PORT: BUNDLER_TICK_PORT });
spawnInherit("node", ["commerce-dist/sweeper/index.js"], { ...apiEnv, WORKER_TICK_PORT: SWEEPER_TICK_PORT });
spawnInherit("node", ["commerce-dist/wallet-deployer/index.js"], {
  ...apiEnv,
  WORKER_TICK_PORT: DEPLOYER_TICK_PORT,
});
await waitForTickHealth(BUNDLER_TICK_PORT);
await waitForTickHealth(SWEEPER_TICK_PORT);
await waitForTickHealth(DEPLOYER_TICK_PORT);

stack.bundlerTickUrl = `http://127.0.0.1:${BUNDLER_TICK_PORT}/tick`;
stack.sweeperTickUrl = `http://127.0.0.1:${SWEEPER_TICK_PORT}/tick`;
stack.deployerTickUrl = `http://127.0.0.1:${DEPLOYER_TICK_PORT}/tick`;
await writeFile(STACK_PATH, JSON.stringify(stack, null, 2));

console.log(`local-stack API ready at ${SERVER_URL} factory=${stack.factoryAddress} usdc=${stack.usdcAddress}`);
await new Promise(() => {});
