import { Contract, JsonRpcProvider, Wallet } from "ethers";
import type { FastSwapConfigFile } from "../config/types.js";
import type { ResolvedDeploySalts } from "../config/salts.js";
import {
  getChainDefinition,
  getEvmActiveChains,
  resolveCreateXAddress,
  saveFastSwapConfig,
  updateDeployContracts,
  getResolvedDeploySalts,
} from "../config/load.js";
import { readArtifact } from "./artifacts.js";
import { deployEvmStackViaCreateX, predictStackAddresses } from "./createx.js";
import { resolveEvmOwnerAddress } from "./owner.js";

export async function loadDeployArtifacts() {
  const [fastSwap, proxy, sweeper, liquidityManager] = await Promise.all([
    readArtifact("contracts/fastswap/FastSwapReceiver.sol/FastSwapReceiver.json"),
    readArtifact("contracts/proxy/ReceiverProxy.sol/ReceiverProxy.json"),
    readArtifact("contracts/InvoiceSweeper.sol/InvoiceSweeper.json"),
    readArtifact("contracts/liquiditymanager/LiquidityManager.sol/LiquidityManager.json"),
  ]);
  return { fastSwap, proxy, sweeper, liquidityManager };
}

export async function predictEvmAddresses(config: FastSwapConfigFile, owner: string) {
  const artifacts = await loadDeployArtifacts();
  return predictStackAddresses({
    createx: resolveCreateXAddress(config),
    owner,
    salts: getResolvedDeploySalts(config),
    artifacts,
  });
}

export async function deployEvmStackToChain(input: {
  config: FastSwapConfigFile;
  chainKey: string;
  privateKey: string;
  owner?: string;
  includeLiquidityManager?: boolean;
  save?: boolean;
  configPath?: string;
}): Promise<{ chainKey: string; addresses: Awaited<ReturnType<typeof deployEvmStackViaCreateX>> }> {
  const chain = getChainDefinition(input.config, input.chainKey);
  if (chain.type !== "evm") throw new Error(`Chain "${input.chainKey}" is not EVM`);
  if (!chain.rpcUrl) throw new Error(`Missing rpcUrl for chain "${input.chainKey}"`);

  const provider = new JsonRpcProvider(chain.rpcUrl);
  const wallet = new Wallet(input.privateKey, provider);
  const owner = resolveEvmOwnerAddress(
    input.owner || input.config.deploy.owner,
    await wallet.getAddress()
  );
  const artifacts = await loadDeployArtifacts();

  const network = await provider.getNetwork();
  if (network.chainId.toString() !== chain.id) {
    throw new Error(
      `RPC chain id mismatch for "${input.chainKey}": expected ${chain.id}, got ${network.chainId}`
    );
  }

  const addresses = await deployEvmStackViaCreateX({
    signer: wallet,
    createx: resolveCreateXAddress(input.config),
    owner,
    salts: getResolvedDeploySalts(input.config),
    artifacts,
    includeLiquidityManager: input.includeLiquidityManager,
  });

  if (input.save !== false) {
    const next = updateDeployContracts(input.config, addresses);
    saveFastSwapConfig(next, input.configPath);
  }

  return { chainKey: input.chainKey, addresses };
}

export async function deployEvmStackToActiveChains(input: {
  config: FastSwapConfigFile;
  privateKey: string;
  chainKeys?: string[];
  owner?: string;
  includeLiquidityManager?: boolean;
  save?: boolean;
  configPath?: string;
}) {
  const chains = (input.chainKeys ?? getEvmActiveChains(input.config).map((chain) => chain.key)).filter(
    (key) => getChainDefinition(input.config, key).type === "evm"
  );
  const results = [];
  for (const chainKey of chains) {
    results.push(
      await deployEvmStackToChain({
        config: input.config,
        chainKey,
        privateKey: input.privateKey,
        owner: input.owner,
        includeLiquidityManager: input.includeLiquidityManager,
        save: input.save,
        configPath: input.configPath,
      })
    );
  }
  return results;
}

export async function readEvmOnChainState(input: {
  config: FastSwapConfigFile;
  chainKey: string;
  addresses: {
    fastSwapAddress: string;
    sweeperAddress: string;
    liquidityManagerAddress?: string;
  };
}) {
  const chain = getChainDefinition(input.config, input.chainKey);
  if (!chain.rpcUrl) throw new Error(`Missing rpcUrl for chain "${input.chainKey}"`);
  const provider = new JsonRpcProvider(chain.rpcUrl);

  const fastSwapArtifact = await readArtifact("contracts/fastswap/FastSwapReceiver.sol/FastSwapReceiver.json");
  const sweeperArtifact = await readArtifact("contracts/InvoiceSweeper.sol/InvoiceSweeper.json");
  const fastSwap = new Contract(input.addresses.fastSwapAddress, fastSwapArtifact.abi, provider);
  const sweeper = new Contract(input.addresses.sweeperAddress, sweeperArtifact.abi, provider);

  const [fastSwapCode, sweeperCode, receiver, forwarderImplementation, paused] = await Promise.all([
    provider.getCode(input.addresses.fastSwapAddress),
    provider.getCode(input.addresses.sweeperAddress),
    sweeper.getFunction("receiver")(),
    sweeper.getFunction("forwarderImplementation")(),
    fastSwap.paused().catch(() => false),
  ]);

  let liquidityManagerCode = "0x";
  if (input.addresses.liquidityManagerAddress) {
    liquidityManagerCode = await provider.getCode(input.addresses.liquidityManagerAddress);
  }

  return {
    chainKey: input.chainKey,
    chainId: chain.id,
    deployed: {
      fastSwap: fastSwapCode !== "0x",
      sweeper: sweeperCode !== "0x",
      liquidityManager: liquidityManagerCode !== "0x",
    },
    sweeperReceiver: String(receiver),
    forwarderImplementation: String(forwarderImplementation),
    fastSwapPaused: Boolean(paused),
    receiverMatches: String(receiver).toLowerCase() === input.addresses.fastSwapAddress.toLowerCase(),
  };
}
