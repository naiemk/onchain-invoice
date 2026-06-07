import { spawn, type ChildProcess } from "node:child_process";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { DEMO_DEPLOY_CHAINS, DEMO_HOST, deploymentChains } from "./config.js";
import { deployDemo } from "./deploy.js";
import { DemoRelayNode } from "./relay.js";
import { runDemoServers } from "./server.js";
import { seedDemoInvoiceIfNeeded } from "./seed-demo.js";
import { createDemoSweepNode } from "./sweep.js";

const children: ChildProcess[] = [];

async function main() {
  await run("npm", ["run", "compile"]);
  await resetDemoState();

  const chainNodes = DEMO_DEPLOY_CHAINS.map((chain) => spawnNode(chain.name, requiredRpcPort(chain.rpcPort, chain.name)));
  children.push(...chainNodes);

  // Hardhat binds shortly after spawn; probing too early yields ECONNREFUSED and flaky deploys.
  await sleep(2_000);
  assertHardhatChildrenAlive(chainNodes);

  await Promise.all(DEMO_DEPLOY_CHAINS.map((chain) => waitForRpc(chain.rpcUrl ?? `http://${DEMO_HOST}:${requiredRpcPort(chain.rpcPort, chain.name)}`)));

  const deployment = await deployDemo();
  const servers = await runDemoServers(deployment);
  try {
    await seedDemoInvoiceIfNeeded(deployment);
  } catch (error) {
    console.error("[fastswap-demo] seed demo invoice failed:", error);
  }
  const sweepNode = createDemoSweepNode(deployment);
  const relayNode = new DemoRelayNode(deployment);

  sweepNode.start();
  await relayNode.start();

  for (const chain of deploymentChains(deployment)) {
    console.log(`[fastswap-demo] ${chain.name} RPC`, chain.rpcUrl);
    console.log(`[fastswap-demo] ${chain.tokens.stable.symbol}`, chain.tokens.stable.address);
  }
  console.log("[fastswap-demo] Demo is running. Press Ctrl+C to stop.");

  const stop = async () => {
    relayNode.stop();
    sweepNode.stop();
    await servers.api.close();
    servers.ui.close();
    servers.admin.close();
    for (const child of children) child.kill("SIGTERM");
  };

  process.once("SIGINT", () => void stop().finally(() => process.exit(0)));
  process.once("SIGTERM", () => void stop().finally(() => process.exit(0)));
}

async function resetDemoState() {
  const stateDir = join(process.cwd(), "fastSwapDemo", "state");
  await Promise.all([
    rm(join(stateDir, "deployment.json"), { force: true }),
    rm(join(stateDir, "relay-progress.json"), { force: true }),
    rm(join(stateDir, "fastswap.sqlite"), { force: true }),
    rm(join(stateDir, "fastswap.sqlite-shm"), { force: true }),
    rm(join(stateDir, "fastswap.sqlite-wal"), { force: true }),
    rm(join(stateDir, "sweep-node.sqlite"), { force: true }),
    rm(join(stateDir, "sweep-node.sqlite-shm"), { force: true }),
    rm(join(stateDir, "sweep-node.sqlite-wal"), { force: true }),
  ]);
}

function spawnNode(name: string, port: number) {
  const child = spawn("npx", ["hardhat", "node", "--hostname", DEMO_HOST, "--port", String(port)], {
    cwd: process.cwd(),
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.once("exit", (code, signal) => {
    if (code !== 0 && code !== null) {
      console.error(`[fastswap-demo] ${name} hardhat node exited with code ${code}${signal ? ` (${signal})` : ""}`);
    }
  });
  child.stdout?.on("data", (chunk) => process.stdout.write(`[${name}] ${chunk}`));
  child.stderr?.on("data", (chunk) => process.stderr.write(`[${name}] ${chunk}`));
  return child;
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function assertHardhatChildrenAlive(nodes: ChildProcess[]) {
  for (const child of nodes) {
    const name = child.spawnargs[child.spawnargs.length - 1] ?? "Hardhat";
    if (child.exitCode != null || child.signalCode != null) {
      throw new Error(
        `${name} Hardhat process exited before RPC was ready (code=${child.exitCode} signal=${child.signalCode})`
      );
    }
  }
}

function requiredRpcPort(port: number | undefined, name: string) {
  if (typeof port !== "number") throw new Error(`Missing rpcPort for ${name}`);
  return port;
}

async function waitForRpc(url: string) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_blockNumber", params: [] }),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const body = (await response.json()) as { error?: { message?: string } };
      if (body.error?.message) throw new Error(body.error.message);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  throw new Error(`RPC did not start: ${url}`);
}

function run(command: string, args: string[]) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { cwd: process.cwd(), stdio: "inherit" });
    child.once("exit", (code) => (code === 0 ? resolve() : reject(new Error(`${command} exited ${code}`))));
  });
}

main().catch((error) => {
  console.error(error);
  for (const child of children) child.kill("SIGTERM");
  process.exitCode = 1;
});
