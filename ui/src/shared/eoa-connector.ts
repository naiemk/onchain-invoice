import { createAppKit } from "@reown/appkit";
import { WagmiAdapter } from "@reown/appkit-adapter-wagmi";
import { sepolia } from "@reown/appkit/networks";
import { connect, getAccount, signMessage, disconnect } from "@wagmi/core";
import { BrowserProvider, getBytes } from "ethers";
import type { WalletPublicConfig } from "../../../commerce/shared/wallet.js";
import { primaryChain } from "./wallet-api.js";

type EthProvider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
};

let appKitModal: ReturnType<typeof createAppKit> | null = null;
let wagmiConfig: ReturnType<WagmiAdapter["wagmiConfig"]> | null = null;

function projectId(): string {
  return import.meta.env.VITE_REOWN_PROJECT_ID ?? "";
}

function injectedProvider(): EthProvider | null {
  const w = window as Window & { ethereum?: EthProvider };
  return w.ethereum ?? null;
}

export async function initEoaConnector(_config: WalletPublicConfig): Promise<void> {
  if (appKitModal || wagmiConfig) return;
  const pid = projectId();
  if (!pid) return;
  const networks = [sepolia];
  const adapter = new WagmiAdapter({ networks, projectId: pid });
  wagmiConfig = adapter.wagmiConfig;
  appKitModal = createAppKit({
    adapters: [adapter],
    networks,
    projectId: pid,
    metadata: {
      name: "Trustless Commerce Wallet",
      description: "Super Wallet EOA keys",
      url: window.location.origin,
      icons: [`${window.location.origin}/favicon.ico`],
    },
  });
}

export async function openEoaConnectModal(): Promise<void> {
  if (appKitModal) {
    appKitModal.open();
    return;
  }
  const provider = injectedProvider();
  if (!provider) throw new Error("No injected wallet found");
  await provider.request({ method: "eth_requestAccounts" });
}

export async function getConnectedEoaAddress(): Promise<string | null> {
  if (wagmiConfig && projectId()) {
    const account = getAccount(wagmiConfig);
    return account.address ?? null;
  }
  const provider = injectedProvider();
  if (!provider) return null;
  const accounts = (await provider.request({ method: "eth_accounts" })) as string[];
  return accounts[0] ?? null;
}

export async function connectEoaWallet(): Promise<string> {
  await openEoaConnectModal();
  if (wagmiConfig && projectId()) {
    if (!getAccount(wagmiConfig).address) {
      await connect(wagmiConfig, { connector: wagmiConfig.connectors[0]! });
    }
    const account = getAccount(wagmiConfig);
    if (!account.address) throw new Error("Wallet not connected");
    return account.address;
  }
  const provider = injectedProvider();
  if (!provider) throw new Error("No injected wallet found");
  const accounts = (await provider.request({ method: "eth_requestAccounts" })) as string[];
  if (!accounts[0]) throw new Error("Wallet not connected");
  return accounts[0];
}

export async function signUserOpHashPersonal(userOpHash: string): Promise<string> {
  if (wagmiConfig && projectId()) {
    const account = getAccount(wagmiConfig);
    if (!account.address) throw new Error("Wallet not connected");
    return signMessage(wagmiConfig, {
      account: account.address,
      message: { raw: getBytes(userOpHash) },
    });
  }
  const provider = injectedProvider();
  if (!provider) throw new Error("No injected wallet found");
  const browser = new BrowserProvider(provider);
  const signer = await browser.getSigner();
  return signer.signMessage(getBytes(userOpHash));
}

export async function disconnectEoaWallet(): Promise<void> {
  if (wagmiConfig && projectId()) {
    await disconnect(wagmiConfig);
  }
}
