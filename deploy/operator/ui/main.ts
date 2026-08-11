import { BrowserProvider, Contract, JsonRpcProvider, getAddress } from "ethers";
import type { OperatorConfig, LogEvent, EvChainConfig } from "../lib/types";

const API = ""; // same-origin via Vite proxy → :8790

type PlanResponse = {
  chainKey: string;
  chain: EvChainConfig;
  plan: {
    salt: string;
    predictedSweeper: string;
    factory: string;
    deployCalldata: string;
    constructorArgs: [string, number, string];
  };
  abi: unknown[];
};

declare global {
  interface Window {
    ethereum?: {
      request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
      on?: (event: string, cb: (...args: unknown[]) => void) => void;
    };
  }
}

const state = {
  config: null as OperatorConfig | null,
  wallet: "" as string,
  plan: null as PlanResponse | null,
  selectedChain: "sepolia",
  steps: {
    config: false,
    wallet: false,
    compile: false,
    deploy: false,
    verify: false,
  },
};

const app = document.querySelector<HTMLElement>("#app")!;

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function render(): void {
  const c = state.config;
  const evmChains = c
    ? Object.entries(c.chains).filter(([, v]) => v.kind === "evm" && v.enabled !== false)
    : [];

  app.innerHTML = `
    <h1>Deploy Console</h1>
    <p class="sub">
      Local-only operator UI. Reads <span class="mono">deploy/operator/config.yaml</span>.
      CREATE2 salt comes from your seed — MetaMask only pays gas. No private keys in the config.
    </p>
    <div class="layout">
      <div class="panel">
        <h2>Steps</h2>
        <div class="steps">
          ${step("config", "1. Config + seed", state.steps.config, configBody())}
          ${step("wallet", "2. Connect deployer wallet", state.steps.wallet, walletBody())}
          ${step("compile", "3. Compile artifacts", state.steps.compile, compileBody())}
          ${step("deploy", "4. Deploy (CREATE2)", state.steps.deploy, deployBody(evmChains))}
          ${step("verify", "5. Verify + Solana helpers", state.steps.verify, verifyBody())}
        </div>
        <div id="err" class="err"></div>
      </div>
      <div class="panel">
        <h2>Live log</h2>
        <div class="row" style="margin-top:0">
          <button type="button" id="clear-log">Clear</button>
          <span class="pill" id="log-status">connecting…</span>
        </div>
        <div class="log" id="log"></div>
      </div>
    </div>
  `;
  wire();
}

function step(id: string, title: string, done: boolean, body: string): string {
  const tickClass = done ? "done" : id === "deploy" && state.plan ? "running" : "";
  return `
    <div class="step ${tickClass ? "active" : ""}" data-step="${id}">
      <div class="tick ${tickClass}">${done ? "✓" : ""}</div>
      <div>
        <strong>${title}</strong>
        ${body}
      </div>
    </div>`;
}

function configBody(): string {
  const c = state.config;
  if (!c) return `<p class="sub">Loading…</p>`;
  return `
    <label>Seed (CREATE2 salt material — not a private key)</label>
    <input id="seed" value="${esc(c.seed)}" />
    <label>Fee recipient</label>
    <input id="feeRecipient" class="mono" value="${esc(c.feeRecipient)}" />
    <label>Owner</label>
    <input id="owner" class="mono" value="${esc(c.owner)}" />
    <label>Fee bps</label>
    <input id="feeBps" type="number" value="${c.feeBps}" />
    <div class="row">
      <button type="button" class="primary" id="save-config">Save config.yaml</button>
      <button type="button" id="reload-config">Reload</button>
      <span class="pill ${state.steps.config ? "ok" : "warn"}">${state.steps.config ? "ready" : "edit + save"}</span>
    </div>`;
}

function walletBody(): string {
  return `
    <p class="sub" style="margin:0.35rem 0">Gas payer only. Prefer a funded throwaway for testnet.</p>
    <div class="row">
      <button type="button" class="primary" id="connect">Connect MetaMask</button>
      <span class="mono">${state.wallet ? esc(state.wallet) : "not connected"}</span>
    </div>`;
}

function compileBody(): string {
  return `
    <div class="row">
      <button type="button" class="primary" id="compile">hardhat compile</button>
      <button type="button" id="solana-build">solana:build</button>
    </div>`;
}

function deployBody(evmChains: [string, EvChainConfig][]): string {
  const options = evmChains
    .map(
      ([k, v]) =>
        `<option value="${esc(k)}" ${k === state.selectedChain ? "selected" : ""}>${esc(k)} (${v.chainId})</option>`
    )
    .join("");
  const predicted = state.plan?.plan.predictedSweeper ?? "";
  const existing = state.config?.chains[state.selectedChain]?.sweeper ?? "";
  return `
    <label>EVM chain</label>
    <select id="chain">${options}</select>
    <div class="chain-list">
      <div class="chain-item"><span>Predicted sweeper</span><span class="mono">${esc(predicted || "—")}</span></div>
      <div class="chain-item"><span>In config</span><span class="mono">${esc(existing || "—")}</span></div>
    </div>
    <div class="row">
      <button type="button" id="plan">Plan CREATE2</button>
      <button type="button" class="primary" id="deploy" ${state.plan && state.wallet ? "" : "disabled"}>Deploy with MetaMask</button>
    </div>`;
}

function verifyBody(): string {
  const sweeper = state.config?.chains[state.selectedChain]?.sweeper ?? state.plan?.plan.predictedSweeper ?? "";
  const sol = state.config?.solana;
  return `
    <div class="row">
      <button type="button" id="verify" ${sweeper ? "" : "disabled"}>Verify on explorer (CLI)</button>
      <button type="button" id="read-forwarder" ${sweeper ? "" : "disabled"}>Read forwarderImplementation</button>
    </div>
    <p class="sub" style="margin-top:0.75rem">Solana (no Tron deploy) — program id keypair is in-repo; wallet/authority is separate.</p>
    <div class="chain-item"><span>programId</span><span class="mono">${esc(sol?.programId || "—")}</span></div>
    <div class="row">
      <button type="button" id="solana-refresh">Refresh Solana artifact</button>
      <button type="button" id="save-solana-authority">Set authority = connected EVM? (manual)</button>
    </div>
    <label>Solana authority (base58)</label>
    <input id="sol-authority" class="mono" value="${esc(sol?.authority || "")}" placeholder="Phantom pubkey" />
    <div class="row">
      <button type="button" id="save-solana">Save Solana fields</button>
    </div>`;
}

function wire(): void {
  document.querySelector("#clear-log")?.addEventListener("click", () => {
    const log = document.querySelector("#log");
    if (log) log.textContent = "";
  });
  document.querySelector("#reload-config")?.addEventListener("click", () => void loadConfig());
  document.querySelector("#save-config")?.addEventListener("click", () => void saveConfigFromForm());
  document.querySelector("#connect")?.addEventListener("click", () => void connectWallet());
  document.querySelector("#compile")?.addEventListener("click", () => void post("/api/run/compile"));
  document.querySelector("#solana-build")?.addEventListener("click", () => void post("/api/run/solana-build"));
  document.querySelector("#chain")?.addEventListener("change", (e) => {
    state.selectedChain = (e.target as HTMLSelectElement).value;
    state.plan = null;
    render();
  });
  document.querySelector("#plan")?.addEventListener("click", () => void loadPlan());
  document.querySelector("#deploy")?.addEventListener("click", () => void deployEvm());
  document.querySelector("#verify")?.addEventListener("click", () => void verifyEvm());
  document.querySelector("#read-forwarder")?.addEventListener("click", () => void readForwarder());
  document.querySelector("#solana-refresh")?.addEventListener("click", () => void refreshSolana());
  document.querySelector("#save-solana")?.addEventListener("click", () => void saveSolana());
}

async function loadConfig(): Promise<void> {
  const res = await fetch(`${API}/api/config`);
  const body = (await res.json()) as { config: OperatorConfig };
  state.config = body.config;
  state.steps.config = isConfigReady(body.config);
  if (!state.selectedChain || !body.config.chains[state.selectedChain]) {
    state.selectedChain = Object.keys(body.config.chains)[0] ?? "sepolia";
  }
  render();
}

function isConfigReady(c: OperatorConfig): boolean {
  if (!c.seed || c.seed.includes("replace-with")) return false;
  if (!/^0x[0-9a-fA-F]{40}$/.test(c.feeRecipient) || /^0x0{40}$/i.test(c.feeRecipient)) return false;
  if (!/^0x[0-9a-fA-F]{40}$/.test(c.owner) || /^0x0{40}$/i.test(c.owner)) return false;
  return true;
}

async function saveConfigFromForm(): Promise<void> {
  if (!state.config) return;
  const seed = (document.querySelector("#seed") as HTMLInputElement).value.trim();
  const feeRecipient = getAddress((document.querySelector("#feeRecipient") as HTMLInputElement).value.trim());
  const owner = getAddress((document.querySelector("#owner") as HTMLInputElement).value.trim());
  const feeBps = Number((document.querySelector("#feeBps") as HTMLInputElement).value);
  state.config = { ...state.config, seed, feeRecipient, owner, feeBps };
  const res = await fetch(`${API}/api/config`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ config: state.config }),
  });
  if (!res.ok) {
    showErr(await res.text());
    return;
  }
  state.steps.config = true;
  state.plan = null;
  appendLocal("success", "config.yaml saved");
  render();
}

async function connectWallet(): Promise<void> {
  if (!window.ethereum) {
    showErr("MetaMask (or another EIP-1193 wallet) not found");
    return;
  }
  const accounts = (await window.ethereum.request({ method: "eth_requestAccounts" })) as string[];
  state.wallet = getAddress(accounts[0]!);
  state.steps.wallet = true;
  appendLocal("info", `wallet ${state.wallet}`);
  render();
}

async function loadPlan(): Promise<void> {
  const res = await fetch(`${API}/api/plan/evm?chain=${encodeURIComponent(state.selectedChain)}`);
  const body = await res.json();
  if (!res.ok) {
    showErr(body.error ?? JSON.stringify(body));
    return;
  }
  state.plan = body as PlanResponse;
  appendLocal("info", `predicted ${state.plan.plan.predictedSweeper}`);
  render();
}

async function deployEvm(): Promise<void> {
  if (!state.plan || !window.ethereum) return;
  const provider = new BrowserProvider(window.ethereum);
  const network = await provider.getNetwork();
  const wanted = BigInt(state.plan.chain.chainId);
  if (network.chainId !== wanted) {
    showErr(`Wallet on chain ${network.chainId}, need ${wanted}. Switch network in MetaMask.`);
    return;
  }
  const signer = await provider.getSigner();
  const code = await provider.getCode(state.plan.plan.predictedSweeper);
  if (code && code !== "0x") {
    appendLocal("warn", "Predicted address already has code — skipping deploy, reading forwarder");
    await persistAfterDeploy(state.plan.plan.predictedSweeper, "");
    return;
  }
  appendLocal("info", `sending CREATE2 deploy via ${state.plan.plan.factory}`);
  const tx = await signer.sendTransaction({
    to: state.plan.plan.factory,
    data: state.plan.plan.deployCalldata,
  });
  appendLocal("info", `tx ${tx.hash}`);
  const receipt = await tx.wait();
  appendLocal("success", `confirmed block ${receipt?.blockNumber}`);
  await persistAfterDeploy(state.plan.plan.predictedSweeper, tx.hash);
  state.steps.deploy = true;
  render();
}

async function persistAfterDeploy(sweeper: string, deployTx: string): Promise<void> {
  const chain = state.config?.chains[state.selectedChain];
  if (!chain) return;
  const rpc = new JsonRpcProvider(chain.rpcUrl);
  const abi = [
    "function forwarderImplementation() view returns (address)",
  ];
  const c = new Contract(sweeper, abi, rpc);
  const forwarderImplementation = (await c.forwarderImplementation()) as string;
  appendLocal("info", `forwarderImplementation ${forwarderImplementation}`);
  const res = await fetch(`${API}/api/config/evm-result`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      chainKey: state.selectedChain,
      sweeper,
      forwarderImplementation,
      deployTx,
    }),
  });
  const body = await res.json();
  if (!res.ok) {
    showErr(body.error ?? JSON.stringify(body));
    return;
  }
  state.config = body.config;
  state.steps.deploy = true;
}

async function verifyEvm(): Promise<void> {
  if (!state.plan && !state.config) return;
  const address =
    state.config?.chains[state.selectedChain]?.sweeper || state.plan?.plan.predictedSweeper;
  const args = state.plan?.plan.constructorArgs ?? [
    state.config!.feeRecipient,
    state.config!.feeBps,
    state.config!.owner,
  ];
  if (!address) return;
  await post("/api/run/verify-evm", {
    chainKey: state.selectedChain,
    address,
    constructorArgs: args,
  });
  state.steps.verify = true;
  render();
}

async function readForwarder(): Promise<void> {
  const sweeper = state.config?.chains[state.selectedChain]?.sweeper;
  const chain = state.config?.chains[state.selectedChain];
  if (!sweeper || !chain) return;
  const rpc = new JsonRpcProvider(chain.rpcUrl);
  const c = new Contract(sweeper, ["function forwarderImplementation() view returns (address)"], rpc);
  const fwd = await c.forwarderImplementation();
  appendLocal("success", `forwarderImplementation ${fwd}`);
}

async function refreshSolana(): Promise<void> {
  const res = await fetch(`${API}/api/solana/program`);
  const body = await res.json();
  appendLocal("info", JSON.stringify(body));
  if (state.config?.solana && body.programId) {
    state.config.solana.programId = body.programId;
    render();
  }
}

async function saveSolana(): Promise<void> {
  if (!state.config?.solana) return;
  const authority = (document.querySelector("#sol-authority") as HTMLInputElement).value.trim();
  const res = await fetch(`${API}/api/config/solana-result`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      programId: state.config.solana.programId,
      authority,
      feeRecipient: authority,
    }),
  });
  const body = await res.json();
  if (!res.ok) {
    showErr(body.error ?? JSON.stringify(body));
    return;
  }
  state.config = body.config;
  appendLocal("success", "solana fields saved");
  render();
}

async function post(path: string, body?: unknown): Promise<void> {
  await fetch(`${API}${path}`, {
    method: "POST",
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
}

function showErr(msg: string): void {
  const el = document.querySelector("#err");
  if (el) el.textContent = msg;
  appendLocal("error", msg);
}

function appendLocal(stream: LogEvent["stream"], line: string): void {
  const log = document.querySelector("#log");
  if (!log) return;
  const div = document.createElement("div");
  div.className = stream;
  div.textContent = `[${stream}] ${line}`;
  log.appendChild(div);
  log.scrollTop = log.scrollHeight;
}

function connectLogs(): void {
  const es = new EventSource(`${API}/api/logs/stream`);
  const status = () => document.querySelector("#log-status");
  es.onopen = () => {
    const el = status();
    if (el) {
      el.textContent = "live";
      el.className = "pill ok";
    }
  };
  es.onerror = () => {
    const el = status();
    if (el) {
      el.textContent = "reconnecting";
      el.className = "pill warn";
    }
  };
  es.onmessage = (ev) => {
    const event = JSON.parse(ev.data) as LogEvent;
    const log = document.querySelector("#log");
    if (!log) return;
    const div = document.createElement("div");
    div.className = event.stream;
    div.textContent = event.line;
    log.appendChild(div);
    log.scrollTop = log.scrollHeight;
    if (event.line.includes("Compiled") || event.line === "exit 0") {
      state.steps.compile = true;
    }
  };
}

connectLogs();
void loadConfig();
