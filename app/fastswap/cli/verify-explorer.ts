import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { AbiCoder, ContractFactory, getAddress, Wallet } from "ethers";
import type { FastSwapConfigFile, ResolvedChainContracts } from "../config/types.js";
import { getActiveChainDefinitions, tryResolveChainContracts } from "../config/load.js";
import { readArtifact, type ContractArtifact } from "./artifacts.js";
import { resolveEvmOwnerAddress } from "./owner.js";

const ETHERSCAN_V2 = "https://api.etherscan.io/v2/api";
const POLL_MS = 5_000;
const POLL_ATTEMPTS = 24;

type ArtifactWithBuild = ContractArtifact & { buildInfoId?: string };

export type VerifyJob = {
  chainKey: string;
  chainId: string;
  label: string;
  address: string;
  artifactPath: string;
  constructorArgs?: unknown[];
};

export type VerifyResult = {
  chainKey: string;
  label: string;
  address: string;
  status: "verified" | "pending" | "skipped" | "failed";
  message: string;
};

export async function verifyAllOnExplorers(config: FastSwapConfigFile, ownerHint?: string): Promise<VerifyResult[]> {
  const apiKey = process.env.ETHERSCAN_API_KEY;
  if (!apiKey) throw new Error("Missing ETHERSCAN_API_KEY for explorer verification");

  const owner = await resolveOwner(config, ownerHint);
  const results: VerifyResult[] = [];

  for (const chain of getActiveChainDefinitions(config)) {
    if (chain.type !== "evm") {
      results.push({
        chainKey: chain.key,
        label: "(tron)",
        address: "",
        status: "skipped",
        message: "Tron explorer verification is not automated yet; verify on TronScan manually",
      });
      continue;
    }

    const contracts = tryResolveChainContracts(config, chain);
    if (!contracts?.fastSwapAddress || !contracts.sweeperAddress) {
      results.push({
        chainKey: chain.key,
        label: "(chain)",
        address: "",
        status: "skipped",
        message: "Contract addresses not configured",
      });
      continue;
    }

    const jobs = await buildEvmVerifyJobs(chain.key, chain.id, contracts, owner);
    for (const job of jobs) {
      try {
        results.push(await verifyOne(apiKey, job));
      } catch (error) {
        results.push({
          chainKey: job.chainKey,
          label: job.label,
          address: job.address,
          status: "failed",
          message: error instanceof Error ? error.message : String(error),
        });
      }
      await sleep(1_500);
    }
  }

  return results;
}

async function buildEvmVerifyJobs(
  chainKey: string,
  chainId: string,
  contracts: ResolvedChainContracts,
  owner: string
): Promise<VerifyJob[]> {
  const jobs: VerifyJob[] = [];
  const ownerAddr = getAddress(owner);

  if (contracts.fastSwapImplementation) {
    jobs.push({
      chainKey,
      chainId,
      label: "FastSwapReceiver (implementation)",
      address: contracts.fastSwapImplementation,
      artifactPath: "contracts/fastswap/FastSwapReceiver.sol/FastSwapReceiver.json",
    });
  }

  if (contracts.fastSwapAddress && contracts.fastSwapImplementation) {
    const fastSwapArtifact = await readArtifact("contracts/fastswap/FastSwapReceiver.sol/FastSwapReceiver.json");
    const initData = new ContractFactory(fastSwapArtifact.abi, fastSwapArtifact.bytecode).interface.encodeFunctionData(
      "initialize",
      [ownerAddr]
    );
    jobs.push({
      chainKey,
      chainId,
      label: "FastSwapReceiver (proxy)",
      address: contracts.fastSwapAddress,
      artifactPath: "contracts/proxy/ReceiverProxy.sol/ReceiverProxy.json",
      constructorArgs: [contracts.fastSwapImplementation, initData],
    });
  }

  if (contracts.sweeperAddress && contracts.fastSwapAddress) {
    jobs.push({
      chainKey,
      chainId,
      label: "InvoiceSweeper",
      address: contracts.sweeperAddress,
      artifactPath: "contracts/InvoiceSweeper.sol/InvoiceSweeper.json",
      constructorArgs: [contracts.fastSwapAddress],
    });
  }

  if (contracts.forwarderImplementation && contracts.fastSwapAddress) {
    jobs.push({
      chainKey,
      chainId,
      label: "Forwarder",
      address: contracts.forwarderImplementation,
      artifactPath: "contracts/Forwarder.sol/Forwarder.json",
      constructorArgs: [contracts.fastSwapAddress],
    });
  }

  if (contracts.liquidityManagerImplementation) {
    jobs.push({
      chainKey,
      chainId,
      label: "LiquidityManager (implementation)",
      address: contracts.liquidityManagerImplementation,
      artifactPath: "contracts/liquiditymanager/LiquidityManager.sol/LiquidityManager.json",
    });
  }

  if (contracts.liquidityManagerAddress && contracts.liquidityManagerImplementation) {
    const lmArtifact = await readArtifact("contracts/liquiditymanager/LiquidityManager.sol/LiquidityManager.json");
    const initData = new ContractFactory(lmArtifact.abi, lmArtifact.bytecode).interface.encodeFunctionData("initialize", [
      ownerAddr,
    ]);
    jobs.push({
      chainKey,
      chainId,
      label: "LiquidityManager (proxy)",
      address: contracts.liquidityManagerAddress,
      artifactPath: "contracts/proxy/ReceiverProxy.sol/ReceiverProxy.json",
      constructorArgs: [contracts.liquidityManagerImplementation, initData],
    });
  }

  return jobs.filter((job) => job.address);
}

async function verifyOne(apiKey: string, job: VerifyJob): Promise<VerifyResult> {
  const artifact = (await readArtifact(job.artifactPath)) as ArtifactWithBuild;
  if (!artifact.buildInfoId) throw new Error(`Missing buildInfoId on ${job.artifactPath}`);

  const buildInfoPath = join(process.cwd(), "artifacts/build-info", `${artifact.buildInfoId}.json`);
  const buildInfo = JSON.parse(await readFile(buildInfoPath, "utf8")) as {
    input: unknown;
    solcLongVersion?: string;
  };

  const contractFqn = artifactPathToFqn(job.artifactPath);
  const constructorArgs = encodeConstructorArgs(artifact, job.constructorArgs ?? []);

  const body = new URLSearchParams({
    chainid: job.chainId,
    module: "contract",
    action: "verifysourcecode",
    apikey: apiKey,
    contractaddress: getAddress(job.address),
    codeformat: "solidity-standard-json-input",
    contractname: contractFqn,
    compilerversion: `v${buildInfo.solcLongVersion ?? "0.8.24"}+commit.8aa946008`,
    sourceCode: JSON.stringify(buildInfo.input),
  });
  if (constructorArgs) body.set("constructorArguements", constructorArgs);

  const submit = await postForm(`${ETHERSCAN_V2}?chainid=${job.chainId}`, body);
  if (submit.status === "1" && String(submit.result ?? "").includes("Already Verified")) {
    return { chainKey: job.chainKey, label: job.label, address: job.address, status: "verified", message: "Already verified" };
  }
  if (submit.status !== "1" || !submit.result) {
    throw new Error(submit.result ?? submit.message ?? "Verification submit failed");
  }

  const guid = submit.result;
  for (let i = 0; i < POLL_ATTEMPTS; i += 1) {
    await sleep(POLL_MS);
    const checkBody = new URLSearchParams({
      chainid: job.chainId,
      module: "contract",
      action: "checkverifystatus",
      apikey: apiKey,
      guid,
    });
    const status = await postForm(`${ETHERSCAN_V2}?chainid=${job.chainId}`, checkBody);
    const text = String(status.result ?? "");
    if (text.includes("Pass - Verified")) {
      return { chainKey: job.chainKey, label: job.label, address: job.address, status: "verified", message: text };
    }
    if (text.includes("Fail")) throw new Error(text);
  }

  return {
    chainKey: job.chainKey,
    label: job.label,
    address: job.address,
    status: "pending",
    message: `Submitted (${guid}); poll manually on explorer`,
  };
}

function artifactPathToFqn(artifactPath: string): string {
  const source = artifactPath.replace(/\.json$/, "");
  const name = source.split("/").pop()!.replace(".sol", "");
  return `${source}:${name}`;
}

function encodeConstructorArgs(artifact: ContractArtifact, args: unknown[]): string {
  if (args.length === 0) return "";
  const factory = new ContractFactory(artifact.abi, artifact.bytecode);
  const ctor = factory.interface.deploy;
  if (!ctor) return "";
  return AbiCoder.defaultAbiCoder().encode(ctor.inputs, args).slice(2);
}

async function postForm(url: string, body: URLSearchParams): Promise<{ status?: string; message?: string; result?: string }> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!response.ok) throw new Error(`Explorer API HTTP ${response.status}`);
  return response.json() as Promise<{ status?: string; message?: string; result?: string }>;
}

async function resolveOwner(config: FastSwapConfigFile, ownerHint?: string): Promise<string> {
  if (ownerHint) return getAddress(ownerHint);
  const fromConfig = config.deploy.owner?.trim();
  if (fromConfig && /^0x[0-9a-fA-F]{40}$/.test(fromConfig)) return getAddress(fromConfig);
  if (process.env.FASTSWAP_OWNER_ADDRESS && /^0x[0-9a-fA-F]{40}$/.test(process.env.FASTSWAP_OWNER_ADDRESS)) {
    return getAddress(process.env.FASTSWAP_OWNER_ADDRESS);
  }
  const pk = process.env.EVM_PRIVATE_KEY;
  if (pk) return resolveEvmOwnerAddress(undefined, new Wallet(pk).address);
  throw new Error("Set FASTSWAP_OWNER_ADDRESS or EVM_PRIVATE_KEY for proxy verification constructor args");
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function printVerifyResults(results: VerifyResult[]) {
  for (const row of results) {
    const prefix = row.status === "verified" ? "✓" : row.status === "failed" ? "✗" : "·";
    console.log(`${prefix} [${row.chainKey}] ${row.label} ${row.address || ""} — ${row.message}`);
  }
}
