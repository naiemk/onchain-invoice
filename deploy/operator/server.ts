/**
 * Local-only deploy operator API.
 * Serves config + CREATE2 plans, streams CLI logs (compile / verify / solana build),
 * never stores private keys.
 */
import { config as loadDotenv } from "dotenv";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { spawn } from "node:child_process";
import { readFileSync, existsSync, mkdirSync, rmSync, readdirSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createReadStream } from "node:fs";
import { ensureConfig, loadConfig, saveConfig, CONFIG_PATH, OPERATOR_ROOT } from "./lib/config.ts";
import { loadSweeperArtifact, planSweeperCreate2, DEFAULT_CREATE2_FACTORY } from "./lib/create2.ts";
import type { LogEvent, OperatorConfig } from "./lib/types.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../..");
loadDotenv({ path: resolve(REPO_ROOT, ".env") });
const PORT = Number(process.env.DEPLOY_CONSOLE_PORT ?? 8790);
const HARDHAT_BIN = resolve(REPO_ROOT, "node_modules/.bin/hardhat");
const DEFAULT_SEPOLIA_RPC = "https://ethereum-sepolia-rpc.publicnode.com";

/** Serialize Hardhat CLI — concurrent compile/verify races on cache/compile-cache.json.tmp. */
let hardhatQueue: Promise<unknown> = Promise.resolve();
function withHardhatLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = hardhatQueue.then(fn, fn);
  hardhatQueue = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

function prepareHardhatCache(): void {
  const cacheDir = resolve(REPO_ROOT, "cache");
  mkdirSync(cacheDir, { recursive: true });
  for (const name of readdirSync(cacheDir)) {
    if (name.endsWith(".tmp")) {
      rmSync(join(cacheDir, name), { force: true });
    }
  }
}

type SseClient = ServerResponse;
const logClients = new Set<SseClient>();

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const data = JSON.stringify(body, null, 2);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": "*",
  });
  res.end(data);
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolveBody, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolveBody(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function broadcast(event: LogEvent): void {
  const payload = `data: ${JSON.stringify(event)}\n\n`;
  for (const client of logClients) {
    client.write(payload);
  }
}

function logLine(stream: LogEvent["stream"], line: string): void {
  const event: LogEvent = { ts: new Date().toISOString(), stream, line };
  console.error(`[${stream}] ${line}`);
  broadcast(event);
}

function runCommand(
  command: string,
  args: string[],
  opts: { cwd?: string; env?: NodeJS.ProcessEnv } = {}
): Promise<number> {
  return new Promise((resolvePromise) => {
    logLine("info", `$ ${command} ${args.join(" ")}`);
    const child = spawn(command, args, {
      cwd: opts.cwd ?? REPO_ROOT,
      env: { ...process.env, ...opts.env },
      shell: false,
    });
    child.stdout.on("data", (buf: Buffer) => {
      for (const line of buf.toString("utf8").split(/\r?\n/)) {
        if (line.length) logLine("stdout", line);
      }
    });
    child.stderr.on("data", (buf: Buffer) => {
      for (const line of buf.toString("utf8").split(/\r?\n/)) {
        if (line.length) logLine("stderr", line);
      }
    });
    child.on("close", (code) => {
      logLine(code === 0 ? "success" : "error", `exit ${code ?? "?"}`);
      resolvePromise(code ?? 1);
    });
  });
}

function cors(req: IncomingMessage, res: ServerResponse): boolean {
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-methods", "GET,POST,PUT,OPTIONS");
  res.setHeader("access-control-allow-headers", "content-type");
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return true;
  }
  return false;
}

/** eth_call sweeper.forwarderImplementation() via JSON-RPC (server-side — avoids browser RPC CORS/403). */
async function readForwarderImplementation(rpcUrl: string, sweeper: string): Promise<string> {
  // selector(forwarderImplementation()) = 0xe38d60a1
  const data = "0xe38d60a1";
  const rpcRes = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "eth_call",
      params: [{ to: sweeper, data }, "latest"],
    }),
  });
  if (!rpcRes.ok) {
    throw new Error(`RPC HTTP ${rpcRes.status} from ${rpcUrl}`);
  }
  const body = (await rpcRes.json()) as { result?: string; error?: { message?: string } };
  if (body.error?.message) throw new Error(body.error.message);
  const result = body.result ?? "";
  if (!result || result === "0x" || result.length < 66) {
    throw new Error(`empty eth_call result for forwarderImplementation`);
  }
  return `0x${result.slice(-40)}`;
}

async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (cors(req, res)) return;
  const url = new URL(req.url ?? "/", `http://127.0.0.1:${PORT}`);
  const path = url.pathname;

  try {
    if (req.method === "GET" && path === "/api/health") {
      sendJson(res, 200, { ok: true, configPath: CONFIG_PATH });
      return;
    }

    if (req.method === "GET" && path === "/api/config") {
      sendJson(res, 200, { path: CONFIG_PATH, config: ensureConfig() });
      return;
    }

    if (req.method === "PUT" && path === "/api/config") {
      const body = JSON.parse(await readBody(req)) as { config: OperatorConfig };
      saveConfig(body.config);
      logLine("success", `Wrote ${CONFIG_PATH}`);
      sendJson(res, 200, { ok: true, path: CONFIG_PATH });
      return;
    }

    if (req.method === "GET" && path === "/api/plan/evm") {
      const config = loadConfig();
      const chainKey = url.searchParams.get("chain") ?? "";
      const chain = config.chains[chainKey];
      if (!chain || chain.kind !== "evm") {
        sendJson(res, 400, { error: `Unknown EVM chain: ${chainKey}` });
        return;
      }
      if (!config.seed || config.seed.includes("replace-with")) {
        sendJson(res, 400, { error: "Set a real seed in config.yaml first" });
        return;
      }
      if (!/^0x[0-9a-fA-F]{40}$/.test(config.feeRecipient) || /^0x0{40}$/i.test(config.feeRecipient)) {
        sendJson(res, 400, { error: "Set feeRecipient to a non-zero address in config.yaml" });
        return;
      }
      if (!/^0x[0-9a-fA-F]{40}$/.test(config.owner) || /^0x0{40}$/i.test(config.owner)) {
        sendJson(res, 400, { error: "Set owner to a non-zero address in config.yaml" });
        return;
      }
      const { bytecode, abi } = loadSweeperArtifact(REPO_ROOT);
      const plan = planSweeperCreate2({
        seed: config.seed,
        chainId: chain.chainId,
        feeRecipient: config.feeRecipient,
        feeBps: config.feeBps,
        owner: config.owner,
        bytecode,
        factory: config.create2Factory || DEFAULT_CREATE2_FACTORY,
      });
      sendJson(res, 200, {
        chainKey,
        chain,
        plan,
        abi,
        note: "MetaMask pays gas only. CREATE2 address is fixed by seed + constructor args.",
      });
      return;
    }

    if (req.method === "POST" && path === "/api/config/evm-result") {
      const body = JSON.parse(await readBody(req)) as {
        chainKey: string;
        sweeper: string;
        forwarderImplementation?: string;
        deployTx?: string;
      };
      const config = loadConfig();
      const chain = config.chains[body.chainKey];
      if (!chain) {
        sendJson(res, 400, { error: "unknown chain" });
        return;
      }
      if (!body.sweeper || !/^0x[0-9a-fA-F]{40}$/.test(body.sweeper)) {
        sendJson(res, 400, { error: "sweeper address required" });
        return;
      }

      let forwarderImplementation = body.forwarderImplementation?.trim() ?? "";
      if (!forwarderImplementation || /^0x0{40}$/i.test(forwarderImplementation)) {
        try {
          forwarderImplementation = await readForwarderImplementation(chain.rpcUrl, body.sweeper);
          logLine("info", `forwarderImplementation ${forwarderImplementation}`);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          logLine("warn", `Could not read forwarderImplementation (${message}); saving sweeper only`);
          forwarderImplementation = chain.forwarderImplementation ?? "";
        }
      }

      chain.sweeper = body.sweeper;
      if (forwarderImplementation) {
        chain.forwarderImplementation = forwarderImplementation;
      }
      if (body.deployTx) {
        chain.deployTx = body.deployTx;
      }
      chain.deployedAt = new Date().toISOString();
      saveConfig(config);
      logLine("success", `Wrote ${CONFIG_PATH}`);
      logLine("success", `Saved ${body.chainKey} sweeper=${body.sweeper}`);
      sendJson(res, 200, { ok: true, config, path: CONFIG_PATH });
      return;
    }

    if (req.method === "POST" && path === "/api/config/solana-result") {
      const body = JSON.parse(await readBody(req)) as {
        programId?: string;
        authority?: string;
        feeRecipient?: string;
        configPda?: string;
        initializeTx?: string;
      };
      const config = loadConfig();
      if (!config.solana) {
        sendJson(res, 400, { error: "solana section missing in config" });
        return;
      }
      Object.assign(config.solana, body, { deployedAt: new Date().toISOString() });
      saveConfig(config);
      logLine("success", `Saved solana programId=${config.solana.programId}`);
      sendJson(res, 200, { ok: true, config });
      return;
    }

    if (req.method === "GET" && path === "/api/solana/program") {
      const keypairPath = resolve(REPO_ROOT, "solana/deploy/commerce_invoice-keypair.json");
      const soPath = resolve(REPO_ROOT, "solana/target/deploy/commerce_invoice.so");
      let programId = "";
      if (existsSync(keypairPath)) {
        const raw = JSON.parse(readFileSync(keypairPath, "utf8")) as number[];
        // Derive pubkey via a tiny inline — UI also shows from config
        const { Keypair } = await import("@solana/web3.js");
        programId = Keypair.fromSecretKey(Uint8Array.from(raw)).publicKey.toBase58();
      }
      sendJson(res, 200, {
        programId,
        keypairPath,
        soPath,
        soExists: existsSync(soPath),
        keypairExists: existsSync(keypairPath),
      });
      return;
    }

    if (req.method === "GET" && path === "/api/solana/so") {
      const soPath = resolve(REPO_ROOT, "solana/target/deploy/commerce_invoice.so");
      if (!existsSync(soPath)) {
        sendJson(res, 404, { error: "commerce_invoice.so missing — run Build first" });
        return;
      }
      res.writeHead(200, {
        "content-type": "application/octet-stream",
        "access-control-allow-origin": "*",
      });
      createReadStream(soPath).pipe(res);
      return;
    }

    if (req.method === "GET" && path === "/api/solana/program-keypair") {
      // Localhost-only convenience: program id keypair is already in the repo (not upgrade authority).
      const keypairPath = resolve(REPO_ROOT, "solana/deploy/commerce_invoice-keypair.json");
      if (!existsSync(keypairPath)) {
        sendJson(res, 404, { error: "program keypair missing" });
        return;
      }
      sendJson(res, 200, JSON.parse(readFileSync(keypairPath, "utf8")));
      return;
    }

    if (req.method === "POST" && path === "/api/run/compile") {
      sendJson(res, 202, { ok: true });
      void withHardhatLock(async () => {
        prepareHardhatCache();
        await runCommand(HARDHAT_BIN, ["compile"]);
      });
      return;
    }

    if (req.method === "POST" && path === "/api/run/solana-build") {
      sendJson(res, 202, { ok: true });
      void (async () => {
        const bin = resolve(
          process.env.HOME ?? "",
          ".local/share/solana/install/active_release/bin"
        );
        await runCommand("cargo-build-sbf", [], {
          cwd: resolve(REPO_ROOT, "solana/programs/commerce-invoice"),
          env: { PATH: `${bin}:${process.env.PATH ?? ""}` },
        });
      })();
      return;
    }

    if (req.method === "POST" && path === "/api/run/verify-evm") {
      const body = JSON.parse(await readBody(req)) as {
        chainKey: string;
        address: string;
        constructorArgs: [string, number, string];
      };
      sendJson(res, 202, { ok: true });
      const config = loadConfig();
      const chain = config.chains[body.chainKey];
      const network = body.chainKey === "sepolia" ? "sepolia" : body.chainKey;
      if (!process.env.ETHERSCAN_API_KEY?.trim()) {
        logLine(
          "warn",
          "ETHERSCAN_API_KEY not set in environment — Etherscan may fail; Sourcify/Blockscout still attempted"
        );
      }
      const rpcUrl = chain?.rpcUrl?.trim() || DEFAULT_SEPOLIA_RPC;
      const env: NodeJS.ProcessEnv = {
        ...process.env,
        // Always override — root .env may still point at a 403'd provider (e.g. drpc).
        SEPOLIA_RPC_URL: body.chainKey === "sepolia" ? rpcUrl : process.env.SEPOLIA_RPC_URL,
        BASE_RPC_URL: body.chainKey === "base" ? rpcUrl : process.env.BASE_RPC_URL,
        BSC_RPC_URL: body.chainKey === "bsc" ? rpcUrl : process.env.BSC_RPC_URL,
        EVM_8453_RPC_URL: body.chainKey === "base" ? rpcUrl : process.env.EVM_8453_RPC_URL,
        EVM_56_RPC_URL: body.chainKey === "bsc" ? rpcUrl : process.env.EVM_56_RPC_URL,
      };
      logLine("info", `verify ${network} using rpc=${rpcUrl}`);
      void withHardhatLock(async () => {
        prepareHardhatCache();
        // Warm production artifacts (verify defaults to that profile) under the same lock.
        await runCommand(HARDHAT_BIN, ["compile", "--build-profile", "production"], { env });
        await runCommand(
          HARDHAT_BIN,
          [
            "verify",
            "--network",
            network,
            "--contract",
            "contracts/commerce/CommerceInvoiceSweeper.sol:CommerceInvoiceSweeper",
            body.address,
            body.constructorArgs[0],
            String(body.constructorArgs[1]),
            body.constructorArgs[2],
          ],
          { env }
        );
        const forwarder = chain?.forwarderImplementation?.trim();
        if (forwarder) {
          logLine("info", `verify forwarderImplementation ${forwarder}`);
          await runCommand(
            HARDHAT_BIN,
            [
              "verify",
              "--network",
              network,
              "--contract",
              "contracts/commerce/CommerceForwarder.sol:CommerceForwarder",
              forwarder,
              body.address,
            ],
            { env }
          );
        }
      });
      return;
    }

    if (req.method === "GET" && path === "/api/logs/stream") {
      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive",
        "access-control-allow-origin": "*",
      });
      res.write(`data: ${JSON.stringify({ ts: new Date().toISOString(), stream: "info", line: "log stream connected" })}\n\n`);
      logClients.add(res);
      req.on("close", () => logClients.delete(res));
      return;
    }

    sendJson(res, 404, { error: "not found" });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logLine("error", message);
    sendJson(res, 500, { error: message });
  }
}

ensureConfig();
createServer((req, res) => {
  void handler(req, res);
}).listen(PORT, "127.0.0.1", () => {
  console.error(`Deploy console API http://127.0.0.1:${PORT}`);
  console.error(`Config: ${CONFIG_PATH}`);
  console.error(`Operator root: ${OPERATOR_ROOT}`);
});
