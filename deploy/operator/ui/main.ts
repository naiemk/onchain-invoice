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

/** MetaMask / explorer metadata for product EVM rails. */
const CHAIN_META: Record<
  string,
  {
    label: string;
    mainnet: boolean;
    envPrefix: string;
    nativeCurrency: { name: string; symbol: string; decimals: number };
    blockExplorerUrls: string[];
  }
> = {
  base: {
    label: "Base Mainnet",
    mainnet: true,
    envPrefix: "EVM_8453",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    blockExplorerUrls: ["https://basescan.org"],
  },
  bsc: {
    label: "BNB Smart Chain",
    mainnet: true,
    envPrefix: "EVM_56",
    nativeCurrency: { name: "BNB", symbol: "BNB", decimals: 18 },
    blockExplorerUrls: ["https://bscscan.com"],
  },
  sepolia: {
    label: "Sepolia (testnet)",
    mainnet: false,
    envPrefix: "EVM_11155111",
    nativeCurrency: { name: "Sepolia Ether", symbol: "ETH", decimals: 18 },
    blockExplorerUrls: ["https://sepolia.etherscan.io"],
  },
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
  /** Live MetaMask chainId (decimal), or null if unknown / disconnected. */
  walletChainId: null as number | null,
  plan: null as PlanResponse | null,
  selectedChain: "base",
  walletListenersBound: false,
  steps: {
    config: false,
    wallet: false,
    compile: false,
    deploy: false,
    verify: false,
  },
};

function chainKeyForId(chainId: number): string | null {
  if (state.config) {
    for (const [k, v] of Object.entries(state.config.chains)) {
      if (v.kind === "evm" && v.chainId === chainId) return k;
    }
  }
  const known: Record<number, string> = { 8453: "base", 56: "bsc", 11155111: "sepolia" };
  return known[chainId] ?? null;
}

function labelForChainId(chainId: number | null): string {
  if (chainId == null) return "not connected";
  const key = chainKeyForId(chainId);
  if (key) {
    const chain = state.config?.chains[key];
    return chainLabel(key, chain ?? { kind: "evm", chainId, rpcUrl: "" });
  }
  return `Unknown chain (${chainId})`;
}

function selectedChainId(): number | null {
  const chain = state.config?.chains[state.selectedChain];
  return chain?.kind === "evm" ? chain.chainId : null;
}

function networksMatch(): boolean {
  const wanted = selectedChainId();
  return wanted != null && state.walletChainId === wanted;
}

function chainLabel(key: string, chain?: EvChainConfig): string {
  const meta = CHAIN_META[key];
  if (meta) return `${meta.label} (${chain?.chainId ?? "?"})`;
  return `${key} (${chain?.chainId ?? "?"})`;
}

function pickDefaultChain(c: OperatorConfig): string {
  const enabled = Object.entries(c.chains).filter(([, v]) => v.kind === "evm" && v.enabled !== false);
  const undeployedMainnet = enabled.find(
    ([k, v]) => CHAIN_META[k]?.mainnet && !v.sweeper?.trim()
  );
  if (undeployedMainnet) return undeployedMainnet[0];
  const undeployed = enabled.find(([, v]) => !v.sweeper?.trim());
  if (undeployed) return undeployed[0];
  const mainnet = enabled.find(([k]) => CHAIN_META[k]?.mainnet);
  return mainnet?.[0] ?? enabled[0]?.[0] ?? "base";
}

const app = document.querySelector<HTMLElement>("#app")!;

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/** Keep the live log across full re-renders (chainChanged / wallet updates). */
function preserveLog(): string {
  return document.querySelector("#log")?.innerHTML ?? "";
}

function networkBar(): string {
  const selected = selectedChainId();
  const walletLabel = labelForChainId(state.walletChainId);
  const targetLabel =
    selected != null
      ? chainLabel(state.selectedChain, state.config?.chains[state.selectedChain])
      : "—";
  const match = networksMatch();
  const connected = Boolean(state.wallet);
  let statusClass = "mismatch";
  let statusText = "wallet offline";
  if (connected && match) {
    statusClass = "match";
    statusText = "ready to deploy";
  } else if (connected && state.walletChainId != null) {
    statusClass = "mismatch";
    statusText = "wrong network — switch before deploy";
  } else if (connected) {
    statusClass = "mismatch";
    statusText = "reading wallet network…";
  }
  const selectedMeta = CHAIN_META[state.selectedChain];
  const railTone = selectedMeta?.mainnet ? "mainnet" : "testnet";

  return `
    <div class="network-bar ${statusClass}" id="network-bar">
      <div class="network-bar-main">
        <div class="network-slot">
          <span class="network-slot-label">Wallet connected to</span>
          <strong class="network-slot-value">${esc(connected ? walletLabel : "not connected")}</strong>
        </div>
        <div class="network-arrow" aria-hidden="true">→</div>
        <div class="network-slot">
          <span class="network-slot-label">Deploy target</span>
          <strong class="network-slot-value ${railTone}">${esc(targetLabel)}</strong>
        </div>
      </div>
      <div class="network-bar-side">
        <span class="pill ${match ? "ok" : connected ? "bad" : "warn"}">${esc(statusText)}</span>
        ${
          connected && !match
            ? `<button type="button" class="primary" id="switch-chain-top">Switch wallet to target</button>`
            : ""
        }
      </div>
    </div>`;
}

function render(): void {
  const c = state.config;
  const evmChains = c
    ? Object.entries(c.chains).filter(([, v]) => v.kind === "evm" && v.enabled !== false)
    : [];
  const selectedMeta = CHAIN_META[state.selectedChain];
  const savedLog = preserveLog();
  const mainnetHint = selectedMeta?.mainnet
    ? `<p class="banner warn">Mainnet deploy — gas is real. Confirm feeRecipient / owner / seed before sending. Wallet must show the same network as the deploy target.</p>`
    : "";

  app.innerHTML = `
    <h1>Deploy Console</h1>
    <p class="sub">
      Local-only operator UI. Reads <span class="mono">deploy/operator/config.yaml</span>.
      CREATE2 salt comes from your seed — MetaMask only pays gas. No private keys in the config.
      Product mainnet EVM rails: <strong>Base</strong> + <strong>BNB</strong> (Tron needs no contract).
    </p>
    ${networkBar()}
    ${mainnetHint}
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
        <h2>Chain status</h2>
        ${chainStatusPanel(evmChains)}
        <h2 style="margin-top:1.25rem">Live log</h2>
        <div class="row" style="margin-top:0">
          <button type="button" id="clear-log">Clear</button>
          <span class="pill" id="log-status">connecting…</span>
        </div>
        <div class="log" id="log">${savedLog}</div>
      </div>
    </div>
  `;
  wire();
}

function chainStatusPanel(evmChains: [string, EvChainConfig][]): string {
  if (!evmChains.length) return `<p class="sub">No enabled EVM chains in config.</p>`;
  const rows = evmChains
    .map(([k, v]) => {
      const deployed = Boolean(v.sweeper?.trim());
      const meta = CHAIN_META[k];
      const envHint = meta
        ? `${meta.envPrefix}_SWEEPER_ADDRESS`
        : `EVM_${v.chainId}_SWEEPER_ADDRESS`;
      const walletHere = state.walletChainId === v.chainId;
      return `
        <div class="status-row ${k === state.selectedChain ? "selected" : ""} ${walletHere ? "wallet-here" : ""}" data-pick-chain="${esc(k)}">
          <div>
            <strong>${esc(chainLabel(k, v))}</strong>
            <div class="mono muted">${esc(envHint)}</div>
            ${walletHere ? `<div class="wallet-here-tag">wallet is here</div>` : ""}
          </div>
          <span class="pill ${deployed ? "ok" : "warn"}">${deployed ? "deployed" : "pending"}</span>
        </div>
        ${
          deployed
            ? `<div class="status-addr mono">${esc(v.sweeper!)}${
                v.forwarderImplementation
                  ? `<br/><span class="muted">fwd ${esc(v.forwarderImplementation)}</span>`
                  : ""
              }</div>`
            : ""
        }`;
    })
    .join("");
  return `<div class="status-list">${rows}</div>`;
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
  const match = networksMatch();
  const walletLabel = labelForChainId(state.walletChainId);
  return `
    <p class="sub" style="margin:0.35rem 0">Gas payer only. For mainnet, fund with native gas on the target chain (ETH on Base, BNB on BSC).</p>
    <div class="chain-list">
      <div class="chain-item"><span>Account</span><span class="mono">${state.wallet ? esc(state.wallet) : "—"}</span></div>
      <div class="chain-item"><span>Wallet network</span><span class="mono ${match ? "ok-text" : "bad-text"}">${esc(state.wallet ? walletLabel : "not connected")}</span></div>
    </div>
    <div class="row">
      <button type="button" class="primary" id="connect">Connect MetaMask</button>
      <button type="button" id="switch-chain" ${state.wallet ? "" : "disabled"}>Switch to deploy target</button>
      <span class="pill ${!state.wallet ? "warn" : match ? "ok" : "bad"}">${
        !state.wallet ? "disconnected" : match ? "on target" : "wrong network"
      }</span>
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
        `<option value="${esc(k)}" ${k === state.selectedChain ? "selected" : ""}>${esc(chainLabel(k, v))}</option>`
    )
    .join("");
  const predicted = state.plan?.plan.predictedSweeper ?? "";
  const existing = state.config?.chains[state.selectedChain]?.sweeper ?? "";
  const meta = CHAIN_META[state.selectedChain];
  const envHint = meta
    ? `After deploy → ${meta.envPrefix}_SWEEPER_ADDRESS / ${meta.envPrefix}_FORWARDER_IMPLEMENTATION`
    : "";
  const canDeploy = Boolean(state.plan && state.wallet && networksMatch());
  const mismatchNote =
    state.plan && state.wallet && !networksMatch()
      ? `<p class="banner warn" style="margin-top:0.6rem">Deploy blocked until wallet is on ${esc(chainLabel(state.selectedChain, state.config?.chains[state.selectedChain]))}.</p>`
      : "";
  return `
    <label>EVM chain</label>
    <select id="chain">${options}</select>
    <div class="chain-list">
      <div class="chain-item"><span>Predicted sweeper</span><span class="mono">${esc(predicted || "—")}</span></div>
      <div class="chain-item"><span>In config</span><span class="mono">${esc(existing || "—")}</span></div>
    </div>
    ${envHint ? `<p class="sub" style="margin:0.4rem 0 0">${esc(envHint)}</p>` : ""}
    ${mismatchNote}
    <div class="row">
      <button type="button" id="plan">Plan CREATE2</button>
      <button type="button" class="primary" id="deploy" ${canDeploy ? "" : "disabled"}>Deploy with MetaMask</button>
    </div>`;
}

function resolvedSweeper(): string {
  // config.yaml uses sweeper: "" as a placeholder — empty string must not block the CREATE2 plan.
  const fromConfig = state.config?.chains[state.selectedChain]?.sweeper?.trim() ?? "";
  return fromConfig || state.plan?.plan.predictedSweeper || "";
}

function verifyBody(): string {
  const sweeper = resolvedSweeper();
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
  document.querySelector("#switch-chain")?.addEventListener("click", () => void switchToSelectedChain());
  document.querySelector("#switch-chain-top")?.addEventListener("click", () => void switchToSelectedChain());
  document.querySelector("#compile")?.addEventListener("click", () => void post("/api/run/compile"));
  document.querySelector("#solana-build")?.addEventListener("click", () => void post("/api/run/solana-build"));
  document.querySelector("#chain")?.addEventListener("change", (e) => {
    state.selectedChain = (e.target as HTMLSelectElement).value;
    state.plan = null;
    render();
  });
  document.querySelectorAll("[data-pick-chain]").forEach((el) => {
    el.addEventListener("click", () => {
      const key = (el as HTMLElement).dataset.pickChain;
      if (!key || key === state.selectedChain) return;
      state.selectedChain = key;
      state.plan = null;
      render();
    });
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
  const current = body.config.chains[state.selectedChain];
  if (!current || current.kind !== "evm" || current.enabled === false) {
    state.selectedChain = pickDefaultChain(body.config);
  }
  await refreshWalletNetwork({ silent: true });
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

function bindWalletListeners(): void {
  if (state.walletListenersBound || !window.ethereum?.on) return;
  state.walletListenersBound = true;
  window.ethereum.on("chainChanged", (chainIdHex) => {
    const hex = String(chainIdHex);
    state.walletChainId = Number.parseInt(hex, 16);
    appendLocal("info", `wallet network → ${labelForChainId(state.walletChainId)}`);
    render();
  });
  window.ethereum.on("accountsChanged", (accounts) => {
    const list = accounts as string[];
    if (!list?.length) {
      state.wallet = "";
      state.walletChainId = null;
      state.steps.wallet = false;
      appendLocal("warn", "wallet disconnected");
      render();
      return;
    }
    state.wallet = getAddress(list[0]!);
    state.steps.wallet = true;
    void refreshWalletNetwork();
  });
}

async function refreshWalletNetwork(opts?: { silent?: boolean }): Promise<void> {
  if (!window.ethereum) {
    state.walletChainId = null;
    if (!opts?.silent) render();
    return;
  }
  bindWalletListeners();
  try {
    const accounts = (await window.ethereum.request({ method: "eth_accounts" })) as string[];
    if (accounts?.[0]) {
      state.wallet = getAddress(accounts[0]);
      state.steps.wallet = true;
    }
    const chainIdHex = (await window.ethereum.request({ method: "eth_chainId" })) as string;
    state.walletChainId = Number.parseInt(chainIdHex, 16);
  } catch {
    state.walletChainId = null;
  }
  if (!opts?.silent) render();
}

async function connectWallet(): Promise<void> {
  if (!window.ethereum) {
    showErr("MetaMask (or another EIP-1193 wallet) not found");
    return;
  }
  bindWalletListeners();
  const accounts = (await window.ethereum.request({ method: "eth_requestAccounts" })) as string[];
  state.wallet = getAddress(accounts[0]!);
  state.steps.wallet = true;
  appendLocal("info", `wallet ${state.wallet}`);
  await refreshWalletNetwork({ silent: true });
  try {
    await switchToSelectedChain();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    appendLocal("warn", `Could not switch network: ${message}`);
    render();
  }
}

function walletErrorCode(error: unknown): number | undefined {
  if (!error || typeof error !== "object") return undefined;
  const e = error as { code?: number; data?: { originalError?: { code?: number } }; error?: { code?: number } };
  return e.code ?? e.data?.originalError?.code ?? e.error?.code;
}

async function switchToSelectedChain(): Promise<void> {
  if (!window.ethereum) {
    showErr("MetaMask (or another EIP-1193 wallet) not found");
    return;
  }
  const chain = state.config?.chains[state.selectedChain];
  if (!chain || chain.kind !== "evm") {
    showErr("Select an EVM chain first");
    return;
  }
  const hexId = `0x${chain.chainId.toString(16)}`;
  try {
    await window.ethereum.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: hexId }],
    });
  } catch (error) {
    const code = walletErrorCode(error);
    if (code === 4001) {
      throw new Error("User rejected network switch");
    }
    if (code !== 4902) throw error;
    const meta = CHAIN_META[state.selectedChain];
    await window.ethereum.request({
      method: "wallet_addEthereumChain",
      params: [
        {
          chainId: hexId,
          chainName: meta?.label ?? state.selectedChain,
          nativeCurrency: meta?.nativeCurrency ?? { name: "Ether", symbol: "ETH", decimals: 18 },
          rpcUrls: [chain.rpcUrl],
          blockExplorerUrls: meta?.blockExplorerUrls ?? (chain.explorer ? [chain.explorer] : undefined),
        },
      ],
    });
  }
  state.walletChainId = chain.chainId;
  appendLocal("success", `wallet on ${chainLabel(state.selectedChain, chain)}`);
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
  appendLocal("info", `predicted ${state.plan.plan.predictedSweeper} on ${chainLabel(state.selectedChain, state.plan.chain)}`);
  render();
}

async function deployEvm(): Promise<void> {
  if (!state.plan || !window.ethereum) return;
  if (!networksMatch()) {
    try {
      await switchToSelectedChain();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      showErr(`Switch MetaMask to the target chain first: ${message}`);
      return;
    }
  }
  if (!networksMatch()) {
    showErr(`Wallet on chain ${state.walletChainId}, need ${selectedChainId()}. Switch network before deploy.`);
    return;
  }
  const provider = new BrowserProvider(window.ethereum);
  const network = await provider.getNetwork();
  const wanted = BigInt(state.plan.chain.chainId);
  if (network.chainId !== wanted) {
    showErr(`Wallet on chain ${network.chainId}, need ${wanted}. Use “Switch to deploy target”.`);
    return;
  }
  // Plan must match currently selected chain (stale plan after switching targets).
  if (state.plan.chainKey !== state.selectedChain || state.plan.chain.chainId !== Number(wanted)) {
    showErr("Plan is stale for this chain — click Plan CREATE2 again.");
    state.plan = null;
    render();
    return;
  }
  const signer = await provider.getSigner();
  const code = await provider.getCode(state.plan.plan.predictedSweeper);
  if (code && code !== "0x") {
    appendLocal("warn", "Predicted address already has code — skipping deploy, reading forwarder");
    await persistAfterDeploy(state.plan.plan.predictedSweeper, "");
    render();
    return;
  }
  appendLocal(
    "info",
    `sending CREATE2 on ${chainLabel(state.selectedChain, state.plan.chain)} via ${state.plan.plan.factory}`
  );
  const tx = await signer.sendTransaction({
    to: state.plan.plan.factory,
    data: state.plan.plan.deployCalldata,
  });
  appendLocal("info", `tx ${tx.hash}`);
  const receipt = await tx.wait();
  appendLocal("success", `confirmed block ${receipt?.blockNumber}`);
  await persistAfterDeploy(state.plan.plan.predictedSweeper, tx.hash);
  render();
}

async function persistAfterDeploy(sweeper: string, deployTx: string): Promise<void> {
  if (!state.config?.chains[state.selectedChain]) return;

  // Prefer MetaMask provider (already on the target chain). Fall back to server-side RPC write.
  let forwarderImplementation = "";
  try {
    const provider =
      window.ethereum && state.wallet
        ? new BrowserProvider(window.ethereum)
        : new JsonRpcProvider(state.config.chains[state.selectedChain]!.rpcUrl);
    const c = new Contract(sweeper, ["function forwarderImplementation() view returns (address)"], provider);
    forwarderImplementation = (await c.forwarderImplementation()) as string;
    appendLocal("info", `forwarderImplementation ${forwarderImplementation}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    appendLocal("warn", `Browser RPC could not read forwarder (${message}); server will retry`);
  }

  const res = await fetch(`${API}/api/config/evm-result`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      chainKey: state.selectedChain,
      sweeper,
      forwarderImplementation: forwarderImplementation || undefined,
      deployTx: deployTx || undefined,
    }),
  });
  const body = await res.json();
  if (!res.ok) {
    showErr(body.error ?? JSON.stringify(body));
    return;
  }
  state.config = body.config;
  state.steps.deploy = true;
  appendLocal("success", `config.yaml updated → ${body.path ?? "deploy/operator/config.yaml"}`);
  if (body.config?.chains?.[state.selectedChain]?.forwarderImplementation) {
    appendLocal(
      "info",
      `saved forwarderImplementation ${body.config.chains[state.selectedChain].forwarderImplementation}`
    );
  }
}

async function verifyEvm(): Promise<void> {
  if (!state.plan && !state.config) return;
  const address = resolvedSweeper();
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
  const sweeper = resolvedSweeper();
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
