import { createAppKit } from "@reown/appkit/react";
import { WagmiAdapter } from "@reown/appkit-adapter-wagmi";
import { base, defineChain, sepolia, type AppKitNetwork } from "@reown/appkit/networks";
import { getAccount, signMessage, signTypedData } from "@wagmi/core";
import { BrowserProvider, Contract, ZeroAddress, getAddress } from "ethers";
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
import {
  IDENTITY_ADD_METHOD_TYPES,
  IDENTITY_VERIFY_TYPES,
  identityEip712Domain,
} from "../../../commerce/shared/identity-store.js";
import { primaryChain } from "./wallet-api.js";

type EthProvider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
};

let appKitModal: ReturnType<typeof createAppKit> | null = null;
let wagmiConfig: ReturnType<WagmiAdapter["wagmiConfig"]> | null = null;
let selectedProvider: EthProvider | null = null;
let lastConfig: WalletPublicConfig | null = null;
let identityNetwork: AppKitNetwork | null = null;

/** Reown public ID — localhost only. Production UI builds must set VITE_REOWN_PROJECT_ID. */
const LOCALHOST_REOWN_PROJECT_ID = "b56e18d47c72ab683b10814fe9495694";

function isE2eInjectedEoa(): boolean {
  return Boolean((window as Window & { tcE2eEoaRequest?: unknown }).tcE2eEoaRequest);
}

function projectId(): string {
  const fromEnv = import.meta.env.VITE_REOWN_PROJECT_ID ?? "";
  if (fromEnv) return fromEnv;
  if (typeof window !== "undefined" && /^(localhost|127\.0\.0\.1)$/i.test(window.location.hostname)) {
    return LOCALHOST_REOWN_PROJECT_ID;
  }
  return "";
}

function injectedProvider(): EthProvider | null {
  const w = window as Window & { ethereum?: EthProvider };
  return w.ethereum ?? null;
}

export function hasWalletConnect(): boolean {
  return Boolean(projectId() && appKitModal);
}

function rpcLooksLocal(rpcUrl: string | null | undefined): boolean {
  return Boolean(rpcUrl && /localhost|127\.0\.0\.1/i.test(rpcUrl));
}

function identityAppKitNetwork(config: WalletPublicConfig): AppKitNetwork {
  const chain = primaryChain(config);
  const id = Number(chain.chainId);
  if (id === 8453 && !rpcLooksLocal(chain.rpcUrl)) return base;
  if (id === 11155111 && !rpcLooksLocal(chain.rpcUrl)) return sepolia;
  const rpc = chain.rpcUrl || "http://127.0.0.1:8545";
  return defineChain({
    id,
    name: id === 11155111 ? "Local Sepolia" : `Chain ${id}`,
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [rpc] } },
    blockExplorers: { default: { name: "Explorer", url: id === 11155111 ? "https://sepolia.etherscan.io" : "https://etherscan.io" } },
    chainNamespace: "eip155",
    caipNetworkId: `eip155:${id}`,
  });
}

function providerErrorCode(err: unknown): number | undefined {
  if (!err || typeof err !== "object") return undefined;
  const e = err as { code?: number; error?: { code?: number }; data?: { originalError?: { code?: number } } };
  return e.code ?? e.error?.code ?? e.data?.originalError?.code;
}

function activeProvider(): EthProvider | null {
  if (selectedProvider) return selectedProvider;
  const fromKit = appKitModal?.getWalletProvider() as EthProvider | undefined;
  if (fromKit?.request) return fromKit;
  return injectedProvider();
}

export async function initEoaConnector(config: WalletPublicConfig): Promise<void> {
  lastConfig = config;
  identityNetwork = identityAppKitNetwork(config);
  if (appKitModal || wagmiConfig) {
    if (appKitModal && identityNetwork) {
      await appKitModal.switchNetwork(identityNetwork, { throwOnFailure: false }).catch(() => undefined);
    }
    return;
  }
  const pid = projectId();
  if (!pid || isE2eInjectedEoa()) return;
  const extras = [sepolia, base].filter((n) => n.id !== identityNetwork!.id);
  const networks = [identityNetwork, ...extras] as [AppKitNetwork, ...AppKitNetwork[]];
  try {
    const adapter = new WagmiAdapter({ networks, projectId: pid });
    wagmiConfig = adapter.wagmiConfig;
    appKitModal = createAppKit({
      adapters: [adapter],
      networks,
      projectId: pid,
      metadata: {
        name: "Trustless Commerce Wallet",
        description: "Connect a wallet to this identity",
        url: window.location.origin,
        icons: [`${window.location.origin}/favicon.ico`],
      },
      features: { analytics: false, email: false, socials: false, onramp: false },
      themeVariables: {
        "--apkt-z-index": 100000,
        "--w3m-z-index": 100000,
      },
    });
  } catch {
    appKitModal = null;
    wagmiConfig = null;
  }
}

async function readProviderChainId(provider: EthProvider): Promise<number | null> {
  try {
    const hex = await provider.request({ method: "eth_chainId" });
    const n = Number(hex);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

/** Switch the connected wallet onto the identity chain before EIP-712 or send. */
export async function ensureEoaChain(input?: {
  chainId?: number | bigint | string;
  rpcUrl?: string | null;
  name?: string;
}): Promise<void> {
  const chain = lastConfig ? primaryChain(lastConfig) : null;
  const id = Number(input?.chainId ?? chain?.chainId ?? 0);
  if (!id) return;
  const rpc = input?.rpcUrl ?? chain?.rpcUrl ?? null;
  const name = input?.name ?? (rpcLooksLocal(rpc) ? "Trustless Commerce Local" : `Chain ${id}`);
  const hex = `0x${id.toString(16)}`;
  if (appKitModal && identityNetwork) {
    await appKitModal.switchNetwork(identityNetwork, { throwOnFailure: false }).catch(() => undefined);
  }
  const provider = activeProvider();
  if (!provider) return;
  const matches = async () => (await readProviderChainId(provider)) === id;
  if (await matches()) return;
  try {
    await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: hex }] });
    if (await matches()) return;
  } catch (err) {
    const code = providerErrorCode(err);
    if (code !== 4902 && code !== -32603) throw err;
  }
  if (!rpc) throw new Error(`Switch your wallet to chain ${id} and try again.`);
  await provider.request({
    method: "wallet_addEthereumChain",
    params: [
      {
        chainId: hex,
        chainName: name,
        nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
        rpcUrls: [rpc],
      },
    ],
  });
  await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: hex }] }).catch(() => undefined);
  if (!(await matches())) {
    const active = await readProviderChainId(provider);
    throw new Error(`Switch your wallet to chain ${id} (it is still on ${active ?? "another network"}).`);
  }
}

async function waitForAppKitAddress(timeoutMs = 120_000): Promise<string> {
  if (!appKitModal) throw new Error("WalletConnect is not configured");
  const already = appKitModal.getAddress();
  if (already && appKitModal.getIsConnectedState()) return already;
  return new Promise((resolve, reject) => {
    let settled = false;
    let sawOpen = appKitModal!.isOpen();
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      unsubAccount();
      unsubState();
      fn();
    };
    const timer = setTimeout(() => finish(() => reject(new Error("Wallet connection timed out"))), timeoutMs);
    const unsubAccount = appKitModal!.subscribeAccount((state) => {
      if (state.isConnected && state.address) {
        selectedProvider = (appKitModal!.getWalletProvider() as EthProvider | undefined) ?? selectedProvider;
        void appKitModal!.close();
        finish(() => resolve(state.address!));
      }
    });
    const unsubState = appKitModal!.subscribeState((state) => {
      if (state.open) sawOpen = true;
      else if (sawOpen && !appKitModal!.getIsConnectedState()) {
        finish(() => reject(new Error("Wallet connection cancelled")));
      }
    });
  });
}

export async function openEoaConnectModal(): Promise<void> {
  if (appKitModal) {
    await appKitModal.open({ view: "Connect" });
    return;
  }
  const provider = activeProvider();
  if (!provider) throw new Error("No injected wallet found");
  await provider.request({ method: "eth_requestAccounts" });
}

export async function getConnectedEoaAddress(): Promise<string | null> {
  const provider = activeProvider();
  if (provider) {
    const accounts = (await provider.request({ method: "eth_accounts" })) as string[];
    if (accounts[0]) return getAddress(accounts[0]);
  }
  if (wagmiConfig && projectId()) {
    const account = getAccount(wagmiConfig);
    return account.address ? getAddress(account.address) : null;
  }
  return null;
}

export async function connectWalletConnect(): Promise<string> {
  if (!appKitModal) throw new Error("WalletConnect is not configured");
  const existing = appKitModal.getAddress();
  if (existing && appKitModal.getIsConnectedState()) {
    selectedProvider = (appKitModal.getWalletProvider() as EthProvider | undefined) ?? selectedProvider;
    return getAddress(existing);
  }
  const pending = waitForAppKitAddress();
  await appKitModal.open({ view: "Connect" });
  return getAddress(await pending);
}

export async function connectEoaWallet(): Promise<string> {
  let address = await getConnectedEoaAddress();
  if (!address) {
    if (appKitModal) {
      address = await connectWalletConnect();
    } else {
      const provider = injectedProvider();
      if (!provider) throw new Error("No injected wallet found");
      selectedProvider = provider;
      const accounts = (await provider.request({ method: "eth_requestAccounts" })) as string[];
      if (!accounts[0]) throw new Error("Wallet not connected");
      address = getAddress(accounts[0]);
    }
  } else if (appKitModal && !appKitModal.getIsConnectedState()) {
    selectedProvider = injectedProvider();
  }
  selectedProvider = (appKitModal?.getWalletProvider() as EthProvider | undefined) ?? selectedProvider ?? injectedProvider();
  await ensureEoaChain();
  return address;
}

export function subscribeEoaAccount(cb: (address: string | null) => void): () => void {
  if (!appKitModal) return () => undefined;
  return appKitModal.subscribeAccount((state) => {
    if (state.isConnected && state.address) {
      selectedProvider = (appKitModal!.getWalletProvider() as EthProvider | undefined) ?? selectedProvider;
      void appKitModal!.close();
      cb(getAddress(state.address));
      return;
    }
    cb(null);
  });
}

async function eoaSigner() {
  const provider = activeProvider();
  if (!provider) throw new Error("No wallet connected");
  const browser = new BrowserProvider(provider);
  return browser.getSigner();
}

export async function signPersonalText(message: string): Promise<{ address: string; signature: string }> {
  const address = await connectEoaWallet();
  if (wagmiConfig && projectId() && getAccount(wagmiConfig).address) {
    const signature = await signMessage(wagmiConfig, { account: address as `0x${string}`, message });
    return { address, signature };
  }
  const signer = await eoaSigner();
  const signature = await signer.signMessage(message);
  return { address, signature };
}

type WalletTypedData = AddOwnerTypedData | AddKeyTypedData | UserOpTypedData | RecoverTypedData;

export async function signEoaTypedData(typed: WalletTypedData): Promise<string> {
  await connectEoaWallet();
  await ensureEoaChain({ chainId: typed.domain.chainId });
  const address = (await getConnectedEoaAddress())!;
  const domain = { ...typed.domain, chainId: Number(typed.domain.chainId) };
  if (wagmiConfig && projectId() && getAccount(wagmiConfig).address) {
    return signTypedData(wagmiConfig, {
      account: address as `0x${string}`,
      domain,
      types: typed.types,
      primaryType: typed.primaryType,
      message: typed.message,
    });
  }
  const signer = await eoaSigner();
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

export async function signIdentityVerifyTypedData(input: {
  store: string;
  chainId: number | bigint;
  message: string;
}): Promise<{ address: string; signature: string }> {
  const address = await connectEoaWallet();
  await ensureEoaChain({ chainId: input.chainId });
  const domain = identityEip712Domain(input.store, input.chainId);
  const signer = await eoaSigner();
  const signature = await signer.signTypedData(domain, IDENTITY_VERIFY_TYPES, { message: input.message });
  return { address, signature };
}

/** Prove the connected account owns this address by signing identity AddMethod typed data. */
export async function signIdentityAddMethodTypedData(input: {
  store: string;
  chainId: number | bigint;
  identityId: string;
  kind: number;
  qx: string;
  qy: string;
  eoa: string;
}): Promise<{ address: string; signature: string }> {
  const address = await connectEoaWallet();
  await ensureEoaChain({ chainId: input.chainId });
  const domain = identityEip712Domain(input.store, input.chainId);
  const signer = await eoaSigner();
  const signature = await signer.signTypedData(domain, IDENTITY_ADD_METHOD_TYPES, {
    identityId: input.identityId,
    kind: input.kind,
    qx: input.qx,
    qy: input.qy,
    eoa: getAddress(input.eoa),
  });
  return { address, signature };
}

const ADD_METHOD_GAS_LIMIT = 150_000n;

/** True when the connected EOA can cover a conservative addMethod gas floor. */
export async function eoaCanCoverAddMethodGas(): Promise<boolean> {
  try {
    const address = await getConnectedEoaAddress();
    if (!address) return false;
    const provider = activeProvider();
    if (!provider) return false;
    const browser = new BrowserProvider(provider);
    const [balance, fee] = await Promise.all([browser.getBalance(address), browser.getFeeData()]);
    const gasPrice = fee.gasPrice ?? fee.maxFeePerGas ?? 1_000_000_000n;
    return balance >= (ADD_METHOD_GAS_LIMIT * gasPrice * 12n) / 10n;
  } catch {
    try {
      return (await readEoaNativeBalance()) > 0n;
    } catch {
      return false;
    }
  }
}

/** Anyone with a valid existing-method authorization can submit addMethod; the EOA pays ETH gas. */
export async function sendIdentityAddMethod(input: {
  store: string;
  identityId: string;
  kind: number;
  qx: string;
  qy: string;
  eoa: string;
  authorization: string;
}): Promise<string> {
  await connectEoaWallet();
  await ensureEoaChain();
  const signer = await eoaSigner();
  const contract = new Contract(
    input.store,
    ["function addMethod(bytes32 identityId, uint8 kind, bytes32 qx, bytes32 qy, address eoa, bytes authorization)"],
    signer
  );
  const tx = await contract.addMethod(
    input.identityId,
    input.kind,
    input.qx,
    input.qy,
    input.eoa,
    input.authorization
  );
  const receipt = await tx.wait();
  return receipt?.hash ?? tx.hash;
}

export async function sendIdentityAddMethodByEoa(input: {
  store: string;
  identityId: string;
  kind: number;
  qx: string;
  qy: string;
  eoa?: string;
}): Promise<string> {
  await connectEoaWallet();
  await ensureEoaChain();
  const signer = await eoaSigner();
  const contract = new Contract(
    input.store,
    ["function addMethodByEoa(bytes32 identityId, uint8 kind, bytes32 qx, bytes32 qy, address eoa)"],
    signer
  );
  const tx = await contract.addMethodByEoa(
    input.identityId,
    input.kind,
    input.qx,
    input.qy,
    input.eoa ?? ZeroAddress
  );
  const receipt = await tx.wait();
  return receipt?.hash ?? tx.hash;
}

export async function readEoaNativeBalance(): Promise<bigint> {
  const address = await getConnectedEoaAddress();
  if (!address) return 0n;
  const provider = activeProvider();
  if (!provider) return 0n;
  const browser = new BrowserProvider(provider);
  return browser.getBalance(address);
}
