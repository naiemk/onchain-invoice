import { readFile } from "node:fs/promises";
import { AbiCoder, Contract, JsonRpcProvider, Wallet, ZeroAddress, getAddress } from "ethers";
import type { WalletAccountRecord, WalletRecoveryJobRecord } from "../shared/wallet.js";
import { encodeWebAuthnSignatureFromJson } from "../shared/webauthn-signature.js";
import { ERC20_ABI } from "../shared/userop.js";
import { ActivityLog } from "../sweeper/activity-log.js";
import { load as loadYaml } from "../sweeper/config-loader.js";
import { isUnsetSecret } from "../sweeper/worker.js";
import {
  attachWorkerTickServer,
  idleUntilStopped,
  workerTickPortFromEnv,
} from "../shared/worker-tick-server.js";
import type { Server } from "node:http";

const FACTORY_ABI = [
  "function createAccount(bytes32 identityId, bytes32 salt) returns (address)",
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

const IDENTITY_STORE_ABI = [
  "function restoreDelay() view returns (uint64)",
  "function recoveryOperator() view returns (address)",
  "function pendingRestores(bytes32 identityId) view returns (uint8 kind, bytes32 qx, bytes32 qy, address eoa, uint64 executeAfter, bool active)",
  "function initiateRestore(bytes32 identityId, uint8 kind, bytes32 qx, bytes32 qy, address eoa)",
  "function executeRestore(bytes32 identityId)",
  "function cancelRestore(bytes32 identityId, bytes authorization)",
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
  private tickServer: Server | null = null;
  private readonly workerId: string;

  constructor(config: WalletDeployerConfig) {
    this.config = config;
    this.workerId = `wallet-deployer-${process.pid}`;
    if (config.activityLogPath) {
      this.activity = new ActivityLog(config.activityLogPath, "wallet-deployer");
    }
  }

  async start(): Promise<void> {
    const tickPort = workerTickPortFromEnv();
    if (tickPort > 0) {
      this.tickServer = await attachWorkerTickServer(tickPort, () => this.runExclusiveTick());
      await idleUntilStopped(() => this.stopped);
      return;
    }
    while (!this.stopped) {
      await this.runExclusiveTick();
      if (this.stopped) break;
      await this.waitForNextWork();
    }
  }

  /**
   * Sleep up to intervalMs, but wake early when GET /balance (Refresh) pokes a
   * funded wallet into the undeployed queue.
   */
  private async waitForNextWork(): Promise<void> {
    const idleMs = this.config.intervalMs ?? 30_000;
    const peekMs = Math.min(3_000, idleMs);
    const deadline = Date.now() + idleMs;
    while (!this.stopped) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) return;
      await sleep(Math.min(peekMs, remaining));
      if (this.stopped) return;
      try {
        if (await this.hasDueUndeployedAccounts()) return;
      } catch {
        /* keep waiting */
      }
    }
  }

  private async hasDueUndeployedAccounts(): Promise<boolean> {
    for (const chain of this.config.chains) {
      if (!chain.rpcUrl?.trim() || isUnsetSecret(chain.privateKey) || !chain.factoryAddress?.trim()) {
        continue;
      }
      const accounts = await this.fetchUndeployedAccounts(String(chain.chainId), 1);
      if (accounts.length > 0) return true;
    }
    return false;
  }

  async stopAndWait(): Promise<void> {
    this.stopped = true;
    this.tickServer?.close();
    this.tickServer = null;
    if (this.inFlight) await this.inFlight;
  }

  private async runExclusiveTick(): Promise<void> {
    if (this.inFlight) await this.inFlight;
    this.inFlight = this.tick();
    try {
      await this.inFlight;
    } finally {
      this.inFlight = null;
    }
  }

  async tick(): Promise<void> {
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
        if (!account.identityId) {
          await this.trackActivation(account.address, { funded: true, error: "missing_identity_id" });
          continue;
        }
        try {
          const tx = await factory.createAccount(account.identityId, account.salt);
          const receipt = await tx.wait();
          await this.markDeployed(account.address, String(chain.chainId));
          await this.trackActivation(account.address, { deployed: true });
          this.activity?.append("wallet-deployed", {
            chainId: String(chain.chainId),
            payload: { address: account.address, txHash: receipt?.hash },
          });
        } catch (error) {
          await this.trackActivation(account.address, { funded: true, error: String(error) }).catch(() => undefined);
          this.activity?.append("deploy-error", {
            chainId: String(chain.chainId),
            payload: { address: account.address, error: String(error) },
          });
        }
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
    const jobs = (await this.fetchRecoveryJobs(chainId)).slice().sort((a, b) => {
      const rank = (kind: string) => (kind === "cancel" ? 0 : kind === "initiate" ? 1 : 2);
      return rank(a.kind) - rank(b.kind);
    });
    const cancelWallets = new Set(
      jobs.filter((j) => j.kind === "cancel").map((j) => j.walletAddress.toLowerCase())
    );
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
          await this.runCancel(claimed, guardian, provider, recoveryAddr);
        } else if (claimed.kind === "execute") {
          if (cancelWallets.has(claimed.walletAddress.toLowerCase())) {
            await this.trackRecoveryJob({
              id: claimed.id,
              status: "rejected",
              error: "cancelled",
              expectedVersion: claimed.version,
            });
            continue;
          }
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
    const account = await this.fetchWalletAccount(job.walletAddress);
    if (account?.identityId) {
      await this.ensureIdentityWalletDeployed(job, account, chain, provider);
      if (!recoveryAddr) {
        throw new Error("recoveryAddress / IdentityStore not configured on deployer chain");
      }
      const store = new Contract(recoveryAddr, IDENTITY_STORE_ABI, guardian);
      try {
        const operator = getAddress(await store.recoveryOperator());
        if (operator !== getAddress(guardian.address)) {
          await this.trackRecoveryJob({
            id: job.id,
            status: "pending",
            error: "awaiting_operator",
            expectedVersion: job.version,
          });
          return;
        }
        const tx = await store.initiateRestore(account.identityId, 0, job.newQx, job.newQy, ZeroAddress);
        const receipt = await tx.wait();
        const delay = Number(await store.restoreDelay());
        if (delay === 0) {
          const exec = await store.executeRestore(account.identityId);
          await exec.wait();
        }
        await this.trackRecoveryJob({
          id: job.id,
          status: "included",
          txHash: receipt?.hash ?? tx.hash,
          expectedVersion: job.version,
        });
        this.activity?.append("recovery-initiated", {
          chainId: String(chain.chainId),
          payload: { jobId: job.id, wallet: job.walletAddress, identity: true, txHash: receipt?.hash },
        });
        return;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (/NotRecoveryOperator|awaiting_operator/i.test(message)) {
          await this.trackRecoveryJob({
            id: job.id,
            status: "pending",
            error: "awaiting_operator",
            expectedVersion: job.version,
          });
          return;
        }
        throw error;
      }
    }
    if (!recoveryAddr) {
      throw new Error("recoveryAddress not configured on deployer chain");
    }
    // Ensure wallet is deployed first (CREATE2 salt is original owner).
    const code = await provider.getCode(job.walletAddress);
    if (code === "0x") {
      const accounts = await this.fetchUndeployedAccounts(String(chain.chainId));
      const undeployed = accounts.find((a) => a.address.toLowerCase() === job.walletAddress.toLowerCase());
      if (!undeployed) {
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
      const balance = BigInt(await token.balanceOf(undeployed.address));
      if (balance < minBalance) {
        await this.trackRecoveryJob({
          id: job.id,
          status: "pending",
          error: "wallet_unfunded",
          expectedVersion: job.version,
        });
        return;
      }
      if (!undeployed.identityId) {
        throw new Error("wallet account missing identityId");
      }
      const deployTx = await factory.createAccount(undeployed.identityId, undeployed.salt);
      await deployTx.wait();
      await this.markDeployed(undeployed.address, String(chain.chainId));
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

  private async ensureIdentityWalletDeployed(
    job: WalletRecoveryJobRecord,
    account: WalletAccountRecord,
    chain: WalletDeployerChainConfig,
    provider: JsonRpcProvider
  ): Promise<void> {
    const code = await provider.getCode(job.walletAddress);
    if (code !== "0x") return;
    const token = new Contract(chain.feeTokenAddress, ERC20_ABI, provider);
    const minBalance = BigInt(chain.minBalanceUsdc ?? 1);
    const balance = BigInt(await token.balanceOf(account.address));
    if (balance < minBalance) return;
    if (!account.identityId) throw new Error("wallet account missing identityId");
    const signer = new Wallet(chain.privateKey, provider);
    const factory = new Contract(chain.factoryAddress, FACTORY_ABI, signer);
    const deployTx = await factory.createAccount(account.identityId, account.salt);
    await deployTx.wait();
    await this.markDeployed(account.address, String(chain.chainId));
  }

  private async runCancel(
    job: WalletRecoveryJobRecord,
    guardian: Wallet,
    provider: JsonRpcProvider,
    recoveryAddr?: string
  ): Promise<void> {
    if (!job.cancelSignature) {
      throw new Error("cancel job missing signature");
    }
    const account = await this.fetchWalletAccount(job.walletAddress);
    if (account?.identityId) {
      const storeAddr = (await this.identityStoreAddress(job, provider)) ?? recoveryAddr;
      if (!storeAddr) throw new Error("IdentityStore not configured for cancel");
      const store = new Contract(storeAddr, IDENTITY_STORE_ABI, guardian);
      const tx = await store.cancelRestore(account.identityId, job.cancelSignature);
      const receipt = await tx.wait();
      await this.trackRecoveryJob({
        id: job.id,
        status: "included",
        txHash: receipt?.hash ?? tx.hash,
        expectedVersion: job.version,
      });
      this.activity?.append("recovery-cancelled", {
        chainId: job.chainId,
        payload: { jobId: job.id, wallet: job.walletAddress, identity: true, txHash: receipt?.hash },
      });
      return;
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
    const account = await this.fetchWalletAccount(job.walletAddress);
    if (account?.identityId) {
      if (!recoveryAddr) throw new Error("recoveryAddress not configured");
      const store = new Contract(recoveryAddr, IDENTITY_STORE_ABI, guardian);
      const pending = await store.pendingRestores(account.identityId);
      if (!pending.active) {
        await this.trackRecoveryJob({
          id: job.id,
          status: "rejected",
          error: "no_pending_restore",
          expectedVersion: job.version,
        });
        return;
      }
      const now = await this.chainNow(provider);
      if (Number(pending.executeAfter) > now) {
        await this.trackRecoveryJob({
          id: job.id,
          status: "pending",
          error: "timelock_not_elapsed",
          expectedVersion: job.version,
        });
        return;
      }
      const tx = await store.executeRestore(account.identityId);
      const receipt = await tx.wait();
      await this.trackRecoveryJob({
        id: job.id,
        status: "included",
        txHash: receipt?.hash ?? tx.hash,
        expectedVersion: job.version,
      });
      this.activity?.append("recovery-executed", {
        chainId: job.chainId,
        payload: { jobId: job.id, wallet: job.walletAddress, identity: true, txHash: receipt?.hash },
      });
      return;
    }
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
    const now = await this.chainNow(provider);
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

  private async chainNow(provider: JsonRpcProvider): Promise<number> {
    const block = await provider.getBlock("latest");
    return Number(block?.timestamp ?? Math.floor(Date.now() / 1000));
  }

  private async maybeQueueExecutes(
    chain: WalletDeployerChainConfig,
    provider: JsonRpcProvider
  ): Promise<void> {
    // Look at recent initiate jobs that are included; if pending restore/owner ready, execute.
    const included = await this.fetchRecoveryJobs(String(chain.chainId), "included");
    const initiates = included.filter((j) => j.kind === "initiate");
    for (const job of initiates) {
      if (this.stopped) return;
      try {
        const account = await this.fetchWalletAccount(job.walletAddress);
        if (account?.identityId && chain.recoveryAddress?.trim() && !isUnsetSecret(chain.recoveryAddress)) {
          const guardianKey =
            !chain.guardianPrivateKey?.trim() || isUnsetSecret(chain.guardianPrivateKey)
              ? chain.privateKey
              : chain.guardianPrivateKey;
          const guardian = new Wallet(guardianKey, provider);
          const store = new Contract(chain.recoveryAddress, IDENTITY_STORE_ABI, guardian);
          const pending = await store.pendingRestores(account.identityId);
          if (!pending.active) continue;
          const now = await this.chainNow(provider);
          if (Number(pending.executeAfter) > now) continue;
          const tx = await store.executeRestore(account.identityId);
          const receipt = await tx.wait();
          this.activity?.append("recovery-executed", {
            chainId: String(chain.chainId),
            payload: { wallet: job.walletAddress, identity: true, txHash: receipt?.hash, fromJob: job.id },
          });
          continue;
        }
        const wallet = new Contract(getAddress(job.walletAddress), WALLET_ABI, provider);
        const pending = await wallet.pendingOwner();
        if (!pending.active) continue;
        const now = await this.chainNow(provider);
        if (Number(pending.executableAt) > now) continue;
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

  private async fetchWalletAccount(address: string): Promise<WalletAccountRecord | null> {
    const base = this.config.serverUrl.replace(/\/$/, "");
    const response = await fetch(`${base}/api/wallet/accounts/${getAddress(address)}`);
    if (!response.ok) return null;
    const body = (await response.json()) as { account?: WalletAccountRecord };
    return body.account ?? null;
  }

  private async identityStoreAddress(
    job: WalletRecoveryJobRecord,
    provider: JsonRpcProvider
  ): Promise<string | null> {
    try {
      const wallet = new Contract(getAddress(job.walletAddress), ["function store() view returns (address)"], provider);
      const store = (await wallet.store()) as string;
      if (store && store !== ZeroAddress) return getAddress(store);
    } catch {
      /* undeployed or legacy */
    }
    return null;
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
