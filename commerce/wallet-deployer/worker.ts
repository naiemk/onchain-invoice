import { readFile } from "node:fs/promises";
import { AbiCoder, Contract, JsonRpcProvider, Wallet, getAddress } from "ethers";
import type { WalletAccountRecord, WalletRecoveryJobRecord } from "../shared/wallet.js";
import { encodeWebAuthnSignatureFromJson } from "../shared/webauthn-signature.js";
import { ERC20_ABI } from "../shared/userop.js";
import { ActivityLog } from "../sweeper/activity-log.js";
import { load as loadYaml } from "../sweeper/config-loader.js";
import { isUnsetSecret } from "../sweeper/worker.js";

const FACTORY_ABI = [
  "function createAccount(bytes32 qx, bytes32 qy, bytes32 salt) returns (address)",
  "function predictAddress(bytes32 salt) view returns (address)",
];

const RECOVERY_ABI = [
  "function initiateOwnerRecovery(address wallet, bytes newOwnerPubkey)",
  "function executeOwnerRecovery(address wallet)",
];

const WALLET_ABI = [
  "function pendingOwner() view returns (bytes32 qx, bytes32 qy, uint64 executableAt, bytes32 requestId, bool active)",
  "function cancelPendingOwnerWithSignature(bytes signature)",
  "function paused() view returns (bool)",
];

export interface WalletDeployerChainConfig {
  chainId: string | number;
  rpcUrl: string;
  factoryAddress: string;
  privateKey: string;
  /** Defaults to privateKey (matches deploy-wallet WALLET_ADMIN_GUARDIAN default). */
  guardianPrivateKey?: string;
  recoveryAddress?: string;
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
  private readonly workerId: string;

  constructor(config: WalletDeployerConfig) {
    this.config = config;
    this.workerId = `wallet-deployer-${process.pid}`;
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
        await this.processRecoveryJobs(chain);
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
        if (predicted.toLowerCase() !== account.address.toLowerCase()) {
          await this.trackActivation(account.address, { error: "predicted_address_mismatch" });
          continue;
        }
        const code = await provider.getCode(account.address);
        if (code !== "0x") {
          await this.markDeployed(account.address, String(chain.chainId));
          await this.trackActivation(account.address, { deployed: true });
          // If a recovery initiate is pending for this wallet, process after deploy.
          continue;
        }
        const balance = BigInt(await token.balanceOf(account.address));
        if (balance < minBalance) {
          await this.trackActivation(account.address, { funded: false });
          continue;
        }
        await this.trackActivation(account.address, { funded: true });
        const tx = await factory.createAccount(account.ownerQx, account.ownerQy, account.salt);
        const receipt = await tx.wait();
        await this.markDeployed(account.address, String(chain.chainId));
        await this.trackActivation(account.address, { deployed: true });
        this.activity?.append("wallet-deployed", {
          chainId: String(chain.chainId),
          payload: { address: account.address, txHash: receipt?.hash },
        });
      } catch (error) {
        await this.trackActivation(account.address, { error: String(error) }).catch(() => undefined);
        this.activity?.append("deploy-error", {
          chainId: String(chain.chainId),
          payload: { address: account.address, error: String(error) },
        });
      }
    }
  }

  private async processRecoveryJobs(chain: WalletDeployerChainConfig): Promise<void> {
    const chainId = String(chain.chainId);
    const jobs = await this.fetchRecoveryJobs(chainId);
    if (!jobs.length) return;

    const provider = new JsonRpcProvider(chain.rpcUrl);
    const guardianKey =
      !chain.guardianPrivateKey?.trim() || isUnsetSecret(chain.guardianPrivateKey)
        ? chain.privateKey
        : chain.guardianPrivateKey;
    const guardian = new Wallet(guardianKey, provider);
    const recoveryAddr = chain.recoveryAddress?.trim();
    if (recoveryAddr && isUnsetSecret(recoveryAddr)) {
      // placeholder — skip recovery this tick
      return;
    }

    for (const job of jobs) {
      if (this.stopped) return;
      if (job.chainId !== chainId) continue;
      let claimed: WalletRecoveryJobRecord;
      try {
        claimed = await this.claimRecoveryJob(job);
      } catch {
        continue;
      }
      try {
        if (claimed.kind === "initiate") {
          await this.runInitiate(claimed, chain, guardian, recoveryAddr, provider);
        } else if (claimed.kind === "cancel") {
          await this.runCancel(claimed, guardian, provider);
        } else if (claimed.kind === "execute") {
          await this.runExecute(claimed, guardian, recoveryAddr, provider);
        }
      } catch (error) {
        await this.trackRecoveryJob({
          id: claimed.id,
          status: "failed",
          error: String(error),
          expectedVersion: claimed.version,
        });
        this.activity?.append("recovery-error", {
          chainId,
          payload: { jobId: claimed.id, kind: claimed.kind, error: String(error) },
        });
      }
    }

    // Auto-queue execute when timelock elapsed for active pending owners on known jobs.
    await this.maybeQueueExecutes(chain, provider);
  }

  private async runInitiate(
    job: WalletRecoveryJobRecord,
    chain: WalletDeployerChainConfig,
    guardian: Wallet,
    recoveryAddr: string | undefined,
    provider: JsonRpcProvider
  ): Promise<void> {
    if (!job.newQx || !job.newQy) {
      throw new Error("initiate job missing new owner coords");
    }
    if (!recoveryAddr) {
      throw new Error("recoveryAddress not configured on deployer chain");
    }
    // Ensure wallet is deployed first (CREATE2 salt is original owner).
    const code = await provider.getCode(job.walletAddress);
    if (code === "0x") {
      const accounts = await this.fetchUndeployedAccounts(String(chain.chainId));
      const account = accounts.find((a) => a.address.toLowerCase() === job.walletAddress.toLowerCase());
      if (!account) {
        // Not funded yet — leave pending for retry (re-queue as pending).
        await this.trackRecoveryJob({
          id: job.id,
          status: "pending",
          error: "wallet_not_deployed_yet",
          expectedVersion: job.version,
        });
        return;
      }
      const signer = new Wallet(chain.privateKey, provider);
      const factory = new Contract(chain.factoryAddress, FACTORY_ABI, signer);
      const token = new Contract(chain.feeTokenAddress, ERC20_ABI, provider);
      const minBalance = BigInt(chain.minBalanceUsdc ?? 1);
      const balance = BigInt(await token.balanceOf(account.address));
      if (balance < minBalance) {
        await this.trackRecoveryJob({
          id: job.id,
          status: "pending",
          error: "wallet_unfunded",
          expectedVersion: job.version,
        });
        return;
      }
      const deployTx = await factory.createAccount(account.ownerQx, account.ownerQy, account.salt);
      await deployTx.wait();
      await this.markDeployed(account.address, String(chain.chainId));
    }

    const recovery = new Contract(recoveryAddr, RECOVERY_ABI, guardian);
    const pubkey = AbiCoder.defaultAbiCoder().encode(["bytes32", "bytes32"], [job.newQx, job.newQy]);
    const tx = await recovery.initiateOwnerRecovery(getAddress(job.walletAddress), pubkey);
    const receipt = await tx.wait();
    await this.trackRecoveryJob({
      id: job.id,
      status: "included",
      txHash: receipt?.hash ?? tx.hash,
      expectedVersion: job.version,
    });
    this.activity?.append("recovery-initiated", {
      chainId: String(chain.chainId),
      payload: { jobId: job.id, wallet: job.walletAddress, txHash: receipt?.hash },
    });
  }

  private async runCancel(
    job: WalletRecoveryJobRecord,
    guardian: Wallet,
    provider: JsonRpcProvider
  ): Promise<void> {
    if (!job.cancelSignature) {
      throw new Error("cancel job missing signature");
    }
    let signature = job.cancelSignature;
    if (signature.trim().startsWith("{")) {
      const parsed = JSON.parse(signature) as {
        authenticatorData: string;
        clientDataJSON: string;
        signature: string;
      };
      signature = encodeWebAuthnSignatureFromJson(parsed);
    }
    const wallet = new Contract(getAddress(job.walletAddress), WALLET_ABI, guardian);
    const tx = await wallet.cancelPendingOwnerWithSignature(signature);
    const receipt = await tx.wait();
    await this.trackRecoveryJob({
      id: job.id,
      status: "included",
      txHash: receipt?.hash ?? tx.hash,
      expectedVersion: job.version,
    });
    this.activity?.append("recovery-cancelled", {
      chainId: job.chainId,
      payload: { jobId: job.id, wallet: job.walletAddress, txHash: receipt?.hash },
    });
  }

  private async runExecute(
    job: WalletRecoveryJobRecord,
    guardian: Wallet,
    recoveryAddr: string | undefined,
    provider: JsonRpcProvider
  ): Promise<void> {
    if (!recoveryAddr) throw new Error("recoveryAddress not configured");
    const wallet = new Contract(getAddress(job.walletAddress), WALLET_ABI, provider);
    const pending = await wallet.pendingOwner();
    if (!pending.active) {
      await this.trackRecoveryJob({
        id: job.id,
        status: "rejected",
        error: "no_pending_owner",
        expectedVersion: job.version,
      });
      return;
    }
    const now = Math.floor(Date.now() / 1000);
    if (Number(pending.executableAt) > now) {
      await this.trackRecoveryJob({
        id: job.id,
        status: "pending",
        error: "timelock_not_elapsed",
        expectedVersion: job.version,
      });
      return;
    }
    const recovery = new Contract(recoveryAddr, RECOVERY_ABI, guardian);
    const tx = await recovery.executeOwnerRecovery(getAddress(job.walletAddress));
    const receipt = await tx.wait();
    await this.trackRecoveryJob({
      id: job.id,
      status: "included",
      txHash: receipt?.hash ?? tx.hash,
      expectedVersion: job.version,
    });
    this.activity?.append("recovery-executed", {
      chainId: job.chainId,
      payload: { jobId: job.id, wallet: job.walletAddress, txHash: receipt?.hash },
    });
  }

  private async maybeQueueExecutes(
    chain: WalletDeployerChainConfig,
    provider: JsonRpcProvider
  ): Promise<void> {
    // Look at recent initiate jobs that are included; if pendingOwner ready, create execute job.
    const included = await this.fetchRecoveryJobs(String(chain.chainId), "included");
    const initiates = included.filter((j) => j.kind === "initiate");
    for (const job of initiates) {
      if (this.stopped) return;
      try {
        const wallet = new Contract(getAddress(job.walletAddress), WALLET_ABI, provider);
        const pending = await wallet.pendingOwner();
        if (!pending.active) continue;
        const now = Math.floor(Date.now() / 1000);
        if (Number(pending.executableAt) > now) continue;
        // Create execute via API by posting a new job — use internal track isn't enough.
        // Worker creates execute jobs by calling initiate-style internal create... we don't have create.
        // Instead execute directly here without a job row.
        if (!chain.recoveryAddress?.trim() || isUnsetSecret(chain.recoveryAddress)) continue;
        const guardianKey =
          !chain.guardianPrivateKey?.trim() || isUnsetSecret(chain.guardianPrivateKey)
            ? chain.privateKey
            : chain.guardianPrivateKey;
        const guardian = new Wallet(guardianKey, provider);
        const recovery = new Contract(chain.recoveryAddress, RECOVERY_ABI, guardian);
        const tx = await recovery.executeOwnerRecovery(getAddress(job.walletAddress));
        const receipt = await tx.wait();
        this.activity?.append("recovery-executed", {
          chainId: String(chain.chainId),
          payload: { wallet: job.walletAddress, txHash: receipt?.hash, fromJob: job.id },
        });
      } catch {
        /* ignore per-wallet */
      }
    }
  }

  private async fetchUndeployedAccounts(chainId: string, limit = 100): Promise<WalletAccountRecord[]> {
    const base = this.config.serverUrl.replace(/\/$/, "");
    const q = new URLSearchParams({ chainId, limit: String(limit) });
    const response = await fetch(`${base}/api/wallet/deployer/accounts?${q}`, {
      headers: { "x-api-key": this.config.sweeperApiKey },
    });
    if (!response.ok) {
      throw new Error(`Undeployed list failed: ${response.status} ${await response.text()}`);
    }
    const body = (await response.json()) as { accounts?: WalletAccountRecord[] };
    return body.accounts ?? [];
  }

  private async trackActivation(
    address: string,
    input: { funded?: boolean; deployed?: boolean; error?: string }
  ): Promise<void> {
    const base = this.config.serverUrl.replace(/\/$/, "");
    const response = await fetch(`${base}/api/wallet/accounts/${address}/activation`, {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        "x-api-key": this.config.sweeperApiKey,
      },
      body: JSON.stringify(input),
    });
    if (!response.ok) {
      throw new Error(`Track activation failed: ${response.status} ${await response.text()}`);
    }
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

  private async fetchRecoveryJobs(
    chainId: string,
    status = "pending"
  ): Promise<WalletRecoveryJobRecord[]> {
    const base = this.config.serverUrl.replace(/\/$/, "");
    const response = await fetch(
      `${base}/api/internal/wallet-recovery/jobs?status=${encodeURIComponent(status)}&chainId=${encodeURIComponent(chainId)}`,
      { headers: { "x-api-key": this.config.sweeperApiKey } }
    );
    if (!response.ok) {
      throw new Error(`Recovery jobs list failed: ${response.status} ${await response.text()}`);
    }
    const body = (await response.json()) as { jobs?: WalletRecoveryJobRecord[] };
    return body.jobs ?? [];
  }

  private async claimRecoveryJob(job: WalletRecoveryJobRecord): Promise<WalletRecoveryJobRecord> {
    const base = this.config.serverUrl.replace(/\/$/, "");
    const response = await fetch(`${base}/api/internal/wallet-recovery/claim`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": this.config.sweeperApiKey,
      },
      body: JSON.stringify({
        id: job.id,
        workerId: this.workerId,
        expectedVersion: job.version,
      }),
    });
    if (!response.ok) {
      throw new Error(`Recovery claim failed: ${response.status}`);
    }
    const body = (await response.json()) as { job: WalletRecoveryJobRecord };
    return body.job;
  }

  private async trackRecoveryJob(input: {
    id: string;
    status?: string;
    txHash?: string;
    error?: string;
    expectedVersion?: number;
  }): Promise<void> {
    const base = this.config.serverUrl.replace(/\/$/, "");
    const response = await fetch(`${base}/api/internal/wallet-recovery/track`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": this.config.sweeperApiKey,
      },
      body: JSON.stringify({
        ...input,
        workerId: this.workerId,
      }),
    });
    if (!response.ok) {
      throw new Error(`Recovery track failed: ${response.status} ${await response.text()}`);
    }
  }
}

export async function loadWalletDeployerConfig(path: string): Promise<WalletDeployerConfig> {
  const doc = path.endsWith(".json")
    ? (JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>)
    : await loadYaml(path);
  const chains = Array.isArray(doc.chains) ? (doc.chains as WalletDeployerChainConfig[]) : [];
  const serverUrl = String(doc.serverUrl || process.env.SERVER_URL || "http://localhost:8080");
  const sweeperApiKey = String(doc.sweeperApiKey || process.env.SWEEPER_API_KEY || "");
  return {
    serverUrl,
    sweeperApiKey,
    intervalMs: Number(doc.intervalMs ?? 30_000),
    activityLogPath: doc.activityLogPath ? String(doc.activityLogPath) : undefined,
    chains,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
