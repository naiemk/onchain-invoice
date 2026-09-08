import { readFile } from "node:fs/promises";

export type LocalStack = {
  chainId: string;
  rpcUrl: string;
  sweeperAddress: string;
  forwarderImplementation: string;
  factoryAddress: string;
  implementationAddress: string;
  recoveryAddress: string;
  usdcAddress: string;
  pingAddress: string;
  entryPointAddress: string;
  ownerAddress: string;
  payerAddress: string;
  collectorAddress: string;
  ownerKey: string;
  payerKey: string;
  collectorKey: string;
  bundlerTickUrl?: string;
  sweeperTickUrl?: string;
  deployerTickUrl?: string;
};

export type WorkerTickKind = "bundler" | "sweeper" | "deployer";

const STACK_PATH = process.env.E2E_STACK_PATH ?? "/tmp/tc-e2e-stack.json";

export function isTestnetE2e(): boolean {
  return process.env.E2E_TESTNET === "1" || process.env.E2E_TESTNET === "true";
}

export async function loadLocalStack(): Promise<LocalStack> {
  if (isTestnetE2e()) return loadTestnetStackFromEnv();
  const raw = await readFile(STACK_PATH, "utf8");
  return JSON.parse(raw) as LocalStack;
}

export function apiBase(): string {
  if (isTestnetE2e()) {
    return (process.env.E2E_API_URL ?? "https://testnet.trustless-commerce.com").replace(/\/$/, "");
  }
  const port = process.env.E2E_API_PORT ?? "8080";
  return `http://127.0.0.1:${port}`;
}

export async function sleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

function tickUrl(stack: LocalStack, kind: WorkerTickKind): string | null {
  return (
    (kind === "bundler" ? stack.bundlerTickUrl : kind === "sweeper" ? stack.sweeperTickUrl : stack.deployerTickUrl) ??
    null
  );
}

/** POST /tick on a running node. No-op on testnet (workers poll). */
export async function triggerWorker(kind: WorkerTickKind, stack?: LocalStack): Promise<void> {
  const env = stack ?? (await loadLocalStack());
  const url = tickUrl(env, kind);
  if (!url) return;
  const res = await fetch(url, { method: "POST" });
  if (!res.ok) {
    throw new Error(`${kind} tick failed: ${res.status} ${await res.text()}`);
  }
}

/** Keep triggering nodes until `run` resolves (UserOp / sweep / deploy while the UI waits). */
export async function withWorkerTicks<T>(
  kinds: WorkerTickKind[],
  run: () => Promise<T>,
  stack?: LocalStack
): Promise<T> {
  const env = stack ?? (await loadLocalStack());
  if (!kinds.some((kind) => tickUrl(env, kind))) {
    return run();
  }
  let stopped = false;
  const loop = (async () => {
    while (!stopped) {
      for (const kind of kinds) {
        try {
          await triggerWorker(kind, env);
        } catch {
          /* node still starting or tick in flight */
        }
      }
      await sleep(50);
    }
  })();
  try {
    return await run();
  } finally {
    stopped = true;
    await loop;
  }
}

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`E2E_TESTNET=1 requires ${name}`);
  return value;
}

/** Live Sepolia (or other) stack. Opt-in only — CI uses Hardhat via playwright.config.ts. */
function loadTestnetStackFromEnv(): LocalStack {
  return {
    chainId: process.env.WALLET_CHAIN_ID?.trim() || "11155111",
    rpcUrl: requireEnv("E2E_RPC_URL"),
    sweeperAddress: process.env.SWEEPER_ADDRESS?.trim() || "",
    forwarderImplementation: process.env.FORWARDER_IMPLEMENTATION?.trim() || "",
    factoryAddress: process.env.WALLET_FACTORY_ADDRESS?.trim() || "",
    implementationAddress: process.env.WALLET_IMPLEMENTATION_ADDRESS?.trim() || "",
    recoveryAddress: process.env.WALLET_RECOVERY_ADDRESS?.trim() || "",
    usdcAddress: requireEnv("E2E_USDC"),
    pingAddress: process.env.E2E_PING_ADDRESS?.trim() || "",
    entryPointAddress: process.env.WALLET_ENTRYPOINT_ADDRESS?.trim() || "",
    ownerAddress: process.env.E2E_OWNER_ADDRESS?.trim() || "",
    payerAddress: process.env.E2E_PAYER_ADDRESS?.trim() || "",
    collectorAddress: requireEnv("E2E_COLLECTOR_ADDRESS"),
    ownerKey: process.env.E2E_FUNDER_KEY?.trim() || requireEnv("E2E_OWNER_KEY"),
    payerKey: process.env.E2E_PAYER_KEY?.trim() || process.env.E2E_FUNDER_KEY?.trim() || requireEnv("E2E_OWNER_KEY"),
    collectorKey: process.env.E2E_COLLECTOR_KEY?.trim() || "",
  };
}
