import { readFile } from "node:fs/promises";
import { Contract, JsonRpcProvider, Wallet } from "ethers";
import type { WalletAccountRecord } from "../shared/wallet.js";
import { ERC20_ABI } from "../shared/userop.js";
import { ActivityLog } from "../sweeper/activity-log.js";
import { load as loadYaml } from "../sweeper/config-loader.js";
import { isUnsetSecret } from "../sweeper/worker.js";

const FACTORY_ABI = [
  "function createAccount(bytes32 qx, bytes32 qy, bytes32 salt) returns (address)",
  "function predictAddress(bytes32 salt) view returns (address)",
];

export interface WalletDeployerChainConfig {
  chainId: string | number;
  rpcUrl: string;
  factoryAddress: string;
  privateKey: string;
  feeTokenAddress: string;
  minBalanceUsdc?: string | number;
}

export interface WalletDeployerConfig {
  serverUrl: string;
  sweeperApiKey: string;
  intervalMs?: number;
  activityLogPath?: string;
  chains: WalletDeployerChainConfig[];
}

export class WalletDeployerWorker {
  private readonly config: WalletDeployerConfig;
  private readonly activity?: ActivityLog;
  private stopped = false;
  private inFlight: Promise<void> | null = null;

  constructor(config: WalletDeployerConfig) {
    this.config = config;
    if (config.activityLogPath) {
      this.activity = new ActivityLog(config.activityLogPath, "wallet-deployer");
    }
  }

  async start(): Promise<void> {
    while (!this.stopped) {
      this.inFlight = this.tick();
      await this.inFlight;
      this.inFlight = null;
      if (this.stopped) break;
      await sleep(this.config.intervalMs ?? 30_000);
    }
  }

  async stopAndWait(): Promise<void> {
    this.stopped = true;
    if (this.inFlight) await this.inFlight;
  }

  private async tick(): Promise<void> {
    if (isUnsetSecret(this.config.sweeperApiKey)) {
      this.activity?.append("soft-skip", {
        payload: { reason: "SWEEPER_API_KEY unset — fill .env then recreate wallet-deployer-evm" },
      });
      return;
    }
    let anyReady = false;
    for (const chain of this.config.chains) {
      if (this.stopped) return;
      if (!chain.rpcUrl?.trim() || isUnsetSecret(chain.privateKey) || !chain.factoryAddress?.trim()) {
        continue;
      }
      anyReady = true;
      try {
        await this.processChain(chain);
      } catch (error) {
        this.activity?.append("chain-error", {
          chainId: String(chain.chainId),
          payload: { error: String(error) },
        });
      }
    }
    if (!anyReady) {
      this.activity?.append("soft-skip", {
        payload: { reason: "no deployer chain with rpcUrl + WALLET_DEPLOYER_PRIVATE_KEY + factory" },
      });
    }
  }

  private async processChain(chain: WalletDeployerChainConfig): Promise<void> {
    const accounts = await this.fetchUndeployedAccounts(String(chain.chainId));
    if (!accounts.length) return;
    const provider = new JsonRpcProvider(chain.rpcUrl);
    const signer = new Wallet(chain.privateKey, provider);
    const factory = new Contract(chain.factoryAddress, FACTORY_ABI, signer);
    const token = new Contract(chain.feeTokenAddress, ERC20_ABI, provider);
    const minBalance = BigInt(chain.minBalanceUsdc ?? 1);

    for (const account of accounts) {
      if (this.stopped) return;
      try {
        const predicted = await factory.predictAddress(account.salt);
        if (predicted.toLowerCase() !== account.address.toLowerCase()) continue;
        const code = await provider.getCode(account.address);
        if (code !== "0x") {
          await this.markDeployed(account.address, String(chain.chainId));
          continue;
        }
        const balance = BigInt(await token.balanceOf(account.address));
        if (balance < minBalance) continue;
        const tx = await factory.createAccount(account.ownerQx, account.ownerQy, account.salt);
        const receipt = await tx.wait();
        await this.markDeployed(account.address, String(chain.chainId));
        this.activity?.append("wallet-deployed", {
          chainId: String(chain.chainId),
          payload: { address: account.address, txHash: receipt?.hash },
        });
      } catch (error) {
        this.activity?.append("deploy-error", {
          chainId: String(chain.chainId),
          payload: { address: account.address, error: String(error) },
        });
      }
    }
  }

  private async fetchUndeployedAccounts(chainId: string): Promise<WalletAccountRecord[]> {
    const base = this.config.serverUrl.replace(/\/$/, "");
    const response = await fetch(`${base}/api/wallet/deployer/accounts?chainId=${encodeURIComponent(chainId)}`, {
      headers: { "x-api-key": this.config.sweeperApiKey },
    });
    if (!response.ok) {
      throw new Error(`Undeployed list failed: ${response.status} ${await response.text()}`);
    }
    const body = (await response.json()) as { accounts?: WalletAccountRecord[] };
    return body.accounts ?? [];
  }

  private async markDeployed(address: string, chainId: string): Promise<void> {
    const base = this.config.serverUrl.replace(/\/$/, "");
    const response = await fetch(`${base}/api/wallet/accounts/${address}/deployed`, {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        "x-api-key": this.config.sweeperApiKey,
      },
      body: JSON.stringify({ chainId }),
    });
    if (!response.ok) {
      throw new Error(`Mark deployed failed: ${response.status} ${await response.text()}`);
    }
  }
}

export async function loadWalletDeployerConfig(path: string): Promise<WalletDeployerConfig> {
  const doc = path.endsWith(".json")
    ? (JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>)
    : await loadYaml(path);
  const chains = Array.isArray(doc.chains) ? (doc.chains as WalletDeployerChainConfig[]) : [];
  return {
    serverUrl: String(doc.serverUrl ?? process.env.SERVER_URL ?? "http://localhost:8080"),
    sweeperApiKey: String(doc.sweeperApiKey ?? process.env.SWEEPER_API_KEY ?? ""),
    intervalMs: Number(doc.intervalMs ?? 30_000),
    activityLogPath: doc.activityLogPath ? String(doc.activityLogPath) : undefined,
    chains,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
