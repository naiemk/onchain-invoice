import { JsonRpcProvider, Wallet, getBytes, isHexString, parseEther } from "ethers";
import type { BrowserContext } from "@playwright/test";

export const E2E_EOA_ADDRESS = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
export const E2E_EOA_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
export const E2E_CHAIN_ID = 11155111;

export type E2eEoaSession = {
  address: string;
  privateKey: string;
  signedTypes: string[];
  /** Chain id the shim reported at each typed-data signature. */
  chainIdsAtSign: number[];
};

type RpcFailure = { __tcE2eRpcError: true; code: number; message: string };

type TypedPayload = {
  domain: Record<string, unknown>;
  types: Record<string, unknown>;
  primaryType?: string;
  message: Record<string, unknown>;
};

function rpcFailure(code: number, message: string): RpcFailure {
  return { __tcE2eRpcError: true, code, message };
}

function chainIdHex(chainId: number): string {
  return `0x${chainId.toString(16)}`;
}

function readChainId(params?: unknown[]): number | null {
  const first = params?.[0];
  const hex =
    first && typeof first === "object" && "chainId" in first ? String((first as { chainId?: unknown }).chainId ?? "") : "";
  if (!/^0x[0-9a-fA-F]+$/.test(hex)) return null;
  const id = Number(hex);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function isAddress(value: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(value);
}

/** MetaMask sends `[address, json]` or, on some wallets, the JSON first. */
function readTypedData(params?: unknown[]): TypedPayload | null {
  const candidates = [params?.[1], params?.[0]];
  for (const raw of candidates) {
    const payload = typeof raw === "string" ? (raw.trim().startsWith("{") ? JSON.parse(raw) : null) : raw;
    if (!payload || typeof payload !== "object" || !("types" in payload) || !("message" in payload)) continue;
    return payload as TypedPayload;
  }
  return null;
}

/** MetaMask `personal_sign` is `[message, address]`. Message is hex bytes or UTF-8 text. */
function readPersonalMessage(params?: unknown[]): string | Uint8Array {
  const first = String(params?.[0] ?? "");
  const second = String(params?.[1] ?? "");
  const raw = isAddress(first) && !isAddress(second) ? second : first;
  if (isHexString(raw)) return getBytes(raw);
  return raw;
}

export async function installE2eEoa(
  context: BrowserContext,
  rpcUrl: string,
  privateKey = E2E_EOA_KEY,
  options: { chainId?: number } = {}
): Promise<E2eEoaSession> {
  const provider = new JsonRpcProvider(rpcUrl);
  const wallet = new Wallet(privateKey, provider);
  const signedTypes: string[] = [];
  const chainIdsAtSign: number[] = [];
  let chainId = options.chainId ?? E2E_CHAIN_ID;
  const knownChains = new Set<number>([chainId]);

  await context.exposeFunction(
    "tcE2eEoaRequest",
    async (method: string, params?: unknown[]) => {
      if (method === "eth_requestAccounts" || method === "eth_accounts") return [wallet.address];
      if (method === "eth_chainId") return chainIdHex(chainId);
      if (method === "net_version") return String(chainId);
      if (method === "eth_signTypedData_v4" || method === "eth_signTypedData_v3" || method === "eth_signTypedData") {
        const payload = readTypedData(params);
        if (!payload) return rpcFailure(-32602, "Invalid typed data");
        const types = { ...payload.types };
        delete types.EIP712Domain;
        const primary = String(payload.primaryType ?? "");
        if (primary) signedTypes.push(primary);
        chainIdsAtSign.push(chainId);
        return wallet.signTypedData(payload.domain, types, payload.message);
      }
      if (method === "personal_sign") return wallet.signMessage(readPersonalMessage(params));
      if (method === "wallet_switchEthereumChain") {
        const next = readChainId(params);
        if (next == null) return rpcFailure(-32602, "Expected chainId");
        if (!knownChains.has(next)) {
          return rpcFailure(4902, "Unrecognized chain ID. Try adding the chain using wallet_addEthereumChain first.");
        }
        chainId = next;
        return null;
      }
      if (method === "wallet_addEthereumChain") {
        const next = readChainId(params);
        if (next == null) return rpcFailure(-32602, "Expected chainId");
        knownChains.add(next);
        return null;
      }
      if (method === "eth_sendTransaction") {
        const tx = (params?.[0] ?? {}) as { to?: string; data?: string; value?: string };
        const sent = await wallet.sendTransaction({
          to: tx.to,
          data: tx.data,
          value: tx.value ?? 0n,
        });
        await sent.wait();
        return sent.hash;
      }
      return provider.send(method, Array.isArray(params) ? params : []);
    }
  );

  await context.addInitScript(() => {
    const w = window as Window & {
      tcE2eEoaRequest?: (method: string, params?: unknown[]) => Promise<unknown>;
      ethereum?: {
        isMetaMask?: boolean;
        request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
        on: (event: string, listener: (...args: unknown[]) => void) => void;
        removeListener: (event: string, listener: (...args: unknown[]) => void) => void;
      };
    };
    const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
    let lastAccounts = "";
    let lastChain = "";
    const emit = (event: string, ...args: unknown[]) => {
      for (const listener of listeners.get(event) ?? []) listener(...args);
    };
    w.ethereum = {
      isMetaMask: true,
      request: async ({ method, params }) => {
        if (!w.tcE2eEoaRequest) throw new Error("e2e eoa missing");
        const result = await w.tcE2eEoaRequest(method, params);
        if (result && typeof result === "object" && "__tcE2eRpcError" in result) {
          const failure = result as { code?: number; message?: string };
          const error = new Error(failure.message || "wallet request failed") as Error & { code?: number };
          error.code = failure.code;
          throw error;
        }
        // Emit only when the value changes. Wagmi re-reads accounts and chain
        // from these events, so echoing every eth_accounts call loops forever.
        if (method === "eth_requestAccounts" || method === "eth_accounts") {
          const next = JSON.stringify(result);
          if (next !== lastAccounts) {
            lastAccounts = next;
            emit("accountsChanged", result);
          }
        }
        if (method === "wallet_switchEthereumChain") {
          const hex = (params?.[0] as { chainId?: string } | undefined)?.chainId ?? "";
          if (hex && hex.toLowerCase() !== lastChain) {
            lastChain = hex.toLowerCase();
            emit("chainChanged", hex);
          }
        }
        return result;
      },
      on: (event, listener) => {
        const set = listeners.get(event) ?? new Set();
        set.add(listener);
        listeners.set(event, set);
      },
      removeListener: (event, listener) => {
        listeners.get(event)?.delete(listener);
      },
    };
    const announce = () => {
      window.dispatchEvent(
        new CustomEvent("eip6963:announceProvider", {
          detail: Object.freeze({
            info: {
              uuid: "tc-e2e-metamask",
              name: "MetaMask",
              icon: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg'/>",
              rdns: "io.metamask",
            },
            provider: w.ethereum,
          }),
        })
      );
    };
    window.addEventListener("eip6963:requestProvider", announce);
    announce();
  });

  return { address: wallet.address, privateKey, signedTypes, chainIdsAtSign };
}

export async function fundEoaNative(rpcUrl: string, fromKey: string, to: string, amount = parseEther("1")): Promise<void> {
  const provider = new JsonRpcProvider(rpcUrl);
  const from = new Wallet(fromKey, provider);
  const tx = await from.sendTransaction({ to, value: amount });
  await tx.wait();
}

/** Leave the EOA with too little ETH to cover addMethod gas. */
export async function drainEoaNative(rpcUrl: string, privateKey: string, to: string): Promise<void> {
  const provider = new JsonRpcProvider(rpcUrl);
  const wallet = new Wallet(privateKey, provider);
  const [balance, fee] = await Promise.all([provider.getBalance(wallet.address), provider.getFeeData()]);
  const maxFee = fee.maxFeePerGas ?? fee.gasPrice ?? 1_000_000_000n;
  const maxPriority = fee.maxPriorityFeePerGas ?? 1_000_000_000n;
  const gasLimit = 21_000n;
  const cost = gasLimit * maxFee;
  if (balance <= cost) return;
  const tx = await wallet.sendTransaction({
    to,
    value: balance - cost,
    type: 2,
    gasLimit,
    maxFeePerGas: maxFee,
    maxPriorityFeePerGas: maxPriority > maxFee ? maxFee : maxPriority,
  });
  await tx.wait();
}
