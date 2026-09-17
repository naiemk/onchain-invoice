import { JsonRpcProvider, Wallet, getBytes, parseEther } from "ethers";
import type { BrowserContext } from "@playwright/test";

export const E2E_EOA_ADDRESS = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
export const E2E_EOA_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";

export type E2eEoaSession = {
  address: string;
  privateKey: string;
  signedTypes: string[];
};

export async function installE2eEoa(
  context: BrowserContext,
  rpcUrl: string,
  privateKey = E2E_EOA_KEY
): Promise<E2eEoaSession> {
  const provider = new JsonRpcProvider(rpcUrl);
  const wallet = new Wallet(privateKey, provider);
  const signedTypes: string[] = [];

  await context.exposeFunction(
    "tcE2eEoaRequest",
    async (method: string, params?: unknown[]) => {
      if (method === "eth_requestAccounts" || method === "eth_accounts") return [wallet.address];
      if (method === "eth_chainId") return "0xaa36a7";
      if (method === "net_version") return "11155111";
      if (method === "eth_signTypedData_v4") {
        const raw = params?.[1];
        const payload = typeof raw === "string" ? JSON.parse(raw) : raw;
        const types = { ...(payload.types ?? {}) };
        delete types.EIP712Domain;
        const primary = String(payload.primaryType ?? "");
        if (primary) signedTypes.push(primary);
        return wallet.signTypedData(payload.domain, types, payload.message);
      }
      if (method === "personal_sign") {
        const hexMsg = String(params?.[0] ?? "0x");
        return wallet.signMessage(getBytes(hexMsg));
      }
      if (method === "wallet_switchEthereumChain" || method === "wallet_addEthereumChain") return null;
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
        on: () => void;
        removeListener: () => void;
      };
    };
    w.ethereum = {
      isMetaMask: true,
      request: ({ method, params }) => {
        if (!w.tcE2eEoaRequest) throw new Error("e2e eoa missing");
        return w.tcE2eEoaRequest(method, params);
      },
      on: () => undefined,
      removeListener: () => undefined,
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

  return { address: wallet.address, privateKey, signedTypes };
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
