import { readFile } from "node:fs/promises";
import { AbiCoder, Contract, JsonRpcProvider, Wallet, getAddress } from "ethers";
import type { WalletUserOpRecord } from "../shared/userop.js";
import {
  ENTRYPOINT_ABI,
  ENTRYPOINT_V09,
  ERC20_ABI,
  estimateUserOpPrefund,
  userOpExecutionSucceeded,
  userOpToTuple,
  type BundlerFeeConfig,
  type PackedUserOperationJson,
} from "../shared/userop.js";
import { validateUserOpFee } from "../shared/userop-fee.js";
import { signBundlerRequest } from "../server/bundler-auth.js";
import { ActivityLog } from "../sweeper/activity-log.js";
import { load as loadYaml } from "../sweeper/config-loader.js";
import { isUnsetSecret } from "../sweeper/worker.js";

export interface BundlerChainConfig {
  chainId: string | number;
  rpcUrl: string;
  bundlerAddress: string;
  privateKey: string;
  entryPointAddress?: string;
  beneficiary?: string;
  feeUsdc?: string | number;
  feeTokenAddress?: string;
  feeTokenSymbol?: string;
  feeTokenDecimals?: number;
}

export interface BundlerConfig {
  serverUrl: string;
  intervalMs?: number;
  bundlerWalletKey?: string;
  maxRetries?: number;
  activityLogPath?: string;
  claimLeaseMs?: number;
  chains: BundlerChainConfig[];
}

export class BundlerWorker {
  private readonly config: BundlerConfig;
  private readonly wallet: Wallet | null;
  private readonly activity?: ActivityLog;
  private stopped = false;
  private inFlight: Promise<void> | null = null;

  constructor(config: BundlerConfig) {
    this.config = config;
    this.wallet = config.bundlerWalletKey ? new Wallet(config.bundlerWalletKey) : null;
    if (config.activityLogPath) {
      this.activity = new ActivityLog(config.activityLogPath, "commerce-bundler");
    }
  }

  async start(): Promise<void> {
    while (!this.stopped) {
      this.inFlight = this.tick();
      await this.inFlight;
      this.inFlight = null;
      if (this.stopped) break;
      await sleep(this.config.intervalMs ?? 15_000);
    }
  }

  async stopAndWait(): Promise<void> {
    this.stopped = true;
    if (this.inFlight) await this.inFlight;
  }

  private async tick(): Promise<void> {
    if (isUnsetSecret(this.config.bundlerWalletKey)) {
      this.activity?.append("soft-skip", {
        payload: { reason: "BUNDLER_WALLET_KEY unset — fill .env then recreate bundler-evm" },
      });
      return;
    }
    const readyChains = this.config.chains.filter(
      (c) => c.rpcUrl?.trim() && !isUnsetSecret(c.privateKey) && Boolean(c.bundlerAddress?.trim())
    );
    if (!readyChains.length) {
      this.activity?.append("soft-skip", {
        payload: { reason: "no bundler chain with rpcUrl + BUNDLER_PRIVATE_KEY" },
      });
      return;
    }
    const userOps = await this.fetchUserOps();
    for (const record of userOps) {
      if (this.stopped) return;
      const chain = readyChains.find((c) => String(c.chainId) === record.chainId);
      if (!chain) continue;
      try {
        await this.processUserOp(record, chain);
      } catch (error) {
        this.activity?.append("userop-error", {
          chainId: record.chainId,
          payload: { userOpHash: record.userOpHash, error: String(error) },
        });
        console.error(`bundler userOp ${record.userOpHash}:`, error);
      }
    }
  }

  private async processUserOp(record: WalletUserOpRecord, chain: BundlerChainConfig): Promise<void> {
    const feeConfig = this.feeConfig(chain);
    const feeCheck = validateUserOpFee(record.userOp, feeConfig);
    if (!feeCheck.ok) {
      await this.trackWithRetry({
        userOpHash: record.userOpHash,
        status: "rejected",
        rejectReason: feeCheck.reason ?? "fee_invalid",
        expectedVersion: record.version,
      });
      return;
    }

    const provider = new JsonRpcProvider(chain.rpcUrl);
    const entryPointAddress = chain.entryPointAddress ?? ENTRYPOINT_V09;
    const entryPoint = new Contract(entryPointAddress, ENTRYPOINT_ABI, provider);
    const onChainHash = await entryPoint.getUserOpHash(userOpToTuple(record.userOp));
    if (onChainHash.toLowerCase() !== record.userOpHash.toLowerCase()) {
      await this.trackWithRetry({
        userOpHash: record.userOpHash,
        status: "rejected",
        rejectReason: "invalid_user_op_hash",
        expectedVersion: record.version,
      });
      return;
    }

    const token = new Contract(feeConfig.feeTokenAddress, ERC20_ABI, provider);
    const balance = BigInt(await token.balanceOf(record.walletAddress));
    let totalOut = feeCheck.decoded!.feeAmount;
    for (const call of feeCheck.decoded!.mainCalls) {
      if (getAddress(call.target) !== getAddress(feeConfig.feeTokenAddress)) continue;
      try {
        const parsed = token.interface.parseTransaction({ data: call.data });
        if (parsed?.name === "transfer") totalOut += BigInt(parsed.args[1]);
      } catch {
        /* ignore */
      }
    }
    if (balance < totalOut) {
      await this.trackWithRetry({
        userOpHash: record.userOpHash,
        status: "rejected",
        rejectReason: "insufficient_balance",
        expectedVersion: record.version,
      });
      return;
    }

    const submitter = new Wallet(chain.privateKey, provider);
    const beneficiary = getAddress(chain.beneficiary || chain.bundlerAddress);
    const ep = entryPoint.connect(submitter) as Contract;
    try {
      await this.ensureAccountPrefund(ep, record.walletAddress, record.userOp, record.chainId);
    } catch (error) {
      await this.trackWithRetry({
        userOpHash: record.userOpHash,
        status: "rejected",
        rejectReason: "prefund_failed",
        expectedVersion: record.version,
      });
      this.activity?.append("userop-prefund-failed", {
        chainId: record.chainId,
        payload: { userOpHash: record.userOpHash, error: String(error) },
      });
      return;
    }
    try {
      await ep.handleOps.staticCall([userOpToTuple(record.userOp)], beneficiary);
    } catch (error) {
      await this.trackWithRetry({
        userOpHash: record.userOpHash,
        status: "rejected",
        rejectReason: userOpSimulationRejectReason(error),
        expectedVersion: record.version,
      });
      this.activity?.append("userop-simulation-failed", {
        chainId: record.chainId,
        payload: { userOpHash: record.userOpHash, error: String(error) },
      });
      return;
    }

    const claimed = await this.claimWithRetry(record);
    if (!claimed) return;

    await this.trackWithRetry({
      userOpHash: record.userOpHash,
      status: "submitted",
      expectedVersion: claimed.version,
    });

    const tx = await ep.handleOps([userOpToTuple(record.userOp)], beneficiary);
    const receipt = await tx.wait();
    const gasSpent = receipt?.gasUsed ? receipt.gasUsed.toString() : null;
    const opSuccess =
      receipt?.status === 1 && userOpExecutionSucceeded(receipt.logs ?? [], record.userOpHash);

    await this.trackWithRetry({
      userOpHash: record.userOpHash,
      status: opSuccess ? "included" : "failed",
      rejectReason: opSuccess ? null : "execution_reverted",
      txHash: receipt?.hash ?? tx.hash,
      gasSpentWei: gasSpent,
      expectedVersion: claimed.version + 1,
    });

    this.activity?.append(opSuccess ? "userop-included" : "userop-execution-reverted", {
      chainId: record.chainId,
      txHash: receipt?.hash ?? tx.hash,
      payload: { userOpHash: record.userOpHash },
    });
  }

  private feeConfig(chain: BundlerChainConfig): BundlerFeeConfig {
    return {
      feeTokenAddress: chain.feeTokenAddress ?? "",
      feeTokenSymbol: chain.feeTokenSymbol ?? "USDC",
      feeTokenDecimals: chain.feeTokenDecimals ?? 6,
      bundlerBeneficiary: chain.beneficiary || chain.bundlerAddress,
      minFeeUsdc: BigInt(chain.feeUsdc ?? "100000"),
    };
  }

  /** Top up EntryPoint deposit so USDC-only wallets pass AA21 (no paymaster in v1). */
  private async ensureAccountPrefund(
    entryPoint: Contract,
    walletAddress: string,
    userOp: PackedUserOperationJson,
    chainId: string
  ): Promise<void> {
    const required = estimateUserOpPrefund(userOp);
    const deposit = BigInt(await entryPoint.balanceOf(walletAddress));
    if (deposit >= required) return;
    const topUp = required - deposit + required / 5n; // 20% buffer
    const tx = await entryPoint.depositTo(getAddress(walletAddress), { value: topUp });
    const receipt = await tx.wait();
    this.activity?.append("userop-prefund", {
      chainId,
      payload: {
        address: walletAddress,
        topUp: topUp.toString(),
        txHash: receipt?.hash ?? tx.hash,
      },
    });
  }

  private async claimWithRetry(record: WalletUserOpRecord): Promise<WalletUserOpRecord | null> {
    const max = this.config.maxRetries ?? 5;
    let version = record.version;
    for (let attempt = 0; attempt < max; attempt++) {
      const response = await this.signedFetch("/api/bundler/claim", {
        method: "POST",
        body: JSON.stringify({ userOpHash: record.userOpHash, expectedVersion: version }),
      });
      if (response.ok) {
        const body = (await response.json()) as { userOp: WalletUserOpRecord };
        return body.userOp;
      }
      if (response.status === 409) {
        const body = (await response.json()) as { userOp?: WalletUserOpRecord };
        if (!body.userOp || body.userOp.status === "included") return null;
        version = body.userOp.version;
        await sleep(100 * 2 ** attempt);
        continue;
      }
      if (response.status >= 500) {
        await sleep(200 * 2 ** attempt);
        continue;
      }
      throw new Error(`Claim failed: ${response.status} ${await response.text()}`);
    }
    return null;
  }

  private async trackWithRetry(body: Record<string, unknown>): Promise<WalletUserOpRecord | null> {
    const max = this.config.maxRetries ?? 5;
    let expectedVersion = body.expectedVersion as number | undefined;
    for (let attempt = 0; attempt < max; attempt++) {
      const payload = { ...body, expectedVersion };
      const response = await this.signedFetch("/api/bundler/track", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      if (response.ok) {
        const okBody = (await response.json()) as { userOp?: WalletUserOpRecord };
        return okBody.userOp ?? null;
      }
      if (response.status === 409) {
        const conflict = (await response.json()) as { userOp?: WalletUserOpRecord };
        if (conflict.userOp?.status === "included") return conflict.userOp;
        expectedVersion = conflict.userOp?.version;
        await sleep(100 * 2 ** attempt);
        continue;
      }
      if (response.status >= 500) {
        await sleep(200 * 2 ** attempt);
        continue;
      }
      throw new Error(`Track failed: ${response.status} ${await response.text()}`);
    }
    return null;
  }

  private async fetchUserOps(): Promise<WalletUserOpRecord[]> {
    const response = await this.signedFetch("/api/bundler/userops", { method: "GET" });
    if (!response.ok) {
      throw new Error(`Bundler userOp list failed: ${response.status} ${await response.text()}`);
    }
    const body = (await response.json()) as { userOps?: WalletUserOpRecord[] };
    return body.userOps ?? [];
  }

  private async signedFetch(path: string, init: { method: string; body?: string }): Promise<Response> {
    const base = this.config.serverUrl.replace(/\/$/, "");
    const headers: Record<string, string> = {};
    if (init.body) headers["content-type"] = "application/json";
    if (this.wallet) {
      const signed = await signBundlerRequest(this.wallet, {
        method: init.method,
        path,
        body: init.body,
      });
      Object.assign(headers, signed);
    }
    return fetch(`${base}${path}`, { method: init.method, headers, body: init.body });
  }
}

export async function loadBundlerConfig(path: string): Promise<BundlerConfig> {
  const doc = path.endsWith(".json")
    ? (JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>)
    : await loadYaml(path);
  const chains = Array.isArray(doc.chains) ? (doc.chains as BundlerChainConfig[]) : [];
  return {
    serverUrl: String(doc.serverUrl || process.env.SERVER_URL || "http://localhost:8080"),
    intervalMs: Number(doc.intervalMs ?? 15_000),
    bundlerWalletKey: String(doc.bundlerWalletKey || process.env.BUNDLER_WALLET_KEY || ""),
    maxRetries: Number(doc.maxRetries ?? 5),
    activityLogPath: doc.activityLogPath ? String(doc.activityLogPath) : undefined,
    claimLeaseMs: Number(doc.claimLeaseMs ?? 180_000),
    chains,
  };
}

function userOpSimulationRejectReason(error: unknown): string {
  const data = extractRevertData(error);
  if (data?.startsWith("0x220266b6")) {
    try {
      const [, reason] = AbiCoder.defaultAbiCoder().decode(["uint256", "string"], `0x${data.slice(10)}`) as unknown as [bigint, string];
      if (reason.includes("AA24")) return "signature_invalid";
      if (reason.includes("AA21")) return "prefund_failed";
      if (reason.includes("AA20")) return "account_not_deployed";
      return `simulation_revert:${reason}`;
    } catch {
      return "simulation_revert";
    }
  }
  return "simulation_revert";
}

function extractRevertData(error: unknown): string | null {
  if (!error || typeof error !== "object") return null;
  const obj = error as { data?: unknown; error?: unknown; info?: unknown };
  if (typeof obj.data === "string") return obj.data;
  return extractRevertData(obj.error) ?? extractRevertData(obj.info);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
