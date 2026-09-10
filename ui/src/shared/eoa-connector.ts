import { createAppKit } from "@reown/appkit";
import { WagmiAdapter } from "@reown/appkit-adapter-wagmi";
import { sepolia } from "@reown/appkit/networks";
import { connect, getAccount, signMessage, signTypedData, disconnect } from "@wagmi/core";
import { BrowserProvider } from "ethers";
import type { WalletPublicConfig } from "../../../commerce/shared/wallet.js";
import type {
  AddKeyTypedData,
  AddOwnerTypedData,
  RecoverTypedData,
  UserOpTypedData,
} from "../../../commerce/shared/wallet-eip712.js";
import {
  addKeyTypedData,
  addOwnerTypedData,
  recoverTypedData,
  userOpTypedData,
} from "../../../commerce/shared/wallet-eip712.js";

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

export async function signPersonalText(message: string): Promise<{ address: string; signature: string }> {
  const address = await connectEoaWallet();
  if (wagmiConfig && projectId()) {
    const signature = await signMessage(wagmiConfig, { account: address as `0x${string}`, message });
    return { address, signature };
  }
  const provider = injectedProvider();
  if (!provider) throw new Error("No injected wallet found");
  const browser = new BrowserProvider(provider);
  const signer = await browser.getSigner();
  const signature = await signer.signMessage(message);
  return { address, signature };
}

type WalletTypedData = AddOwnerTypedData | AddKeyTypedData | UserOpTypedData | RecoverTypedData;

export async function signEoaTypedData(typed: WalletTypedData): Promise<string> {
  const address = await connectEoaWallet();
  const domain = { ...typed.domain, chainId: Number(typed.domain.chainId) };
  if (wagmiConfig && projectId()) {
    return signTypedData(wagmiConfig, {
      account: address as `0x${string}`,
      domain,
      types: typed.types,
      primaryType: typed.primaryType,
      message: typed.message,
    });
  }
  const provider = injectedProvider();
  if (!provider) throw new Error("No injected wallet found");
  const browser = new BrowserProvider(provider);
  const signer = await browser.getSigner();
  return signer.signTypedData(domain, typed.types, typed.message);
}

export async function signAddOwnerTypedData(input: {
  wallet: string;
  owner: string;
  chainId: number | bigint;
}): Promise<string> {
  return signEoaTypedData(addOwnerTypedData(input.wallet, input.owner, input.chainId));
}

export async function signAddKeyTypedData(input: {
  wallet: string;
  entityId: string;
  owner: string;
  chainId: number | bigint;
}): Promise<string> {
  return signEoaTypedData(addKeyTypedData(input.wallet, input.entityId, input.owner, input.chainId));
}

export async function signUserOpTypedData(input: {
  wallet: string;
  userOpHash: string;
  chainId: number | bigint;
}): Promise<string> {
  return signEoaTypedData(userOpTypedData(input.wallet, input.userOpHash, input.chainId));
}

export async function signRecoverTypedData(input: {
  wallet: string;
  challenge: string;
  chainId: number | bigint;
}): Promise<{ address: string; signature: string }> {
  const address = await connectEoaWallet();
  const signature = await signEoaTypedData(
    recoverTypedData(input.wallet, input.challenge, address, input.chainId)
  );
  return { address, signature };
}

export async function disconnectEoaWallet(): Promise<void> {
  if (wagmiConfig && projectId()) {
    await disconnect(wagmiConfig);
  }
}
