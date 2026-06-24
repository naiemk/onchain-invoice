import { Interface } from "ethers";
import { TronWeb } from "tronweb";
import { tronAddressToEvmHex } from "../shared/tron-address.js";
import type { FastSwapConfigFile } from "../config/types.js";
import { getChainDefinition, saveFastSwapConfig, updateTronContracts } from "../config/load.js";
import { readArtifact } from "./artifacts.js";

export async function deployTronStack(input: {
  config: FastSwapConfigFile;
  privateKey: string;
  owner?: string;
  save?: boolean;
  configPath?: string;
  chainKey?: string;
  includeLiquidityManager?: boolean;
}) {
  const chainKey = input.chainKey ?? "tron";
  const chain = getChainDefinition(input.config, chainKey);
  if (chain.type !== "tron") throw new Error(`Chain "${chainKey}" is not Tron`);
  const fullHost = chain.fullHost ?? chain.rpcUrl;
  if (!fullHost) throw new Error(`Missing fullHost for chain "${chainKey}"`);

  const privateKey = input.privateKey.replace(/^0x/, "");
  const tronWeb = new TronWeb({ fullHost, privateKey });
  const ownerBase58 = input.owner || input.config.deploy.owner || (tronWeb.defaultAddress.base58 as string);
  const feeLimit = chain.feeLimit ?? 150_000_000;

  const [fastSwapArtifact, proxyArtifact, sweeperArtifact, lmArtifact] = await Promise.all([
    readArtifact("contracts/tron/fastswap/TronFastSwapReceiver.sol/TronFastSwapReceiver.json"),
    readArtifact("contracts/proxy/ReceiverProxy.sol/ReceiverProxy.json"),
    readArtifact("contracts/tron/TronInvoiceSweeper.sol/TronInvoiceSweeper.json"),
    readArtifact("contracts/tron/liquiditymanager/TronLiquidityManager.sol/TronLiquidityManager.json"),
  ]);

  const initIface = new Interface(["function initialize(address initialOwner)"]);
  const ownerHex = tronAddressToEvmHex(ownerBase58);

  const fastSwapImplementation = await deployTronContract(tronWeb, fastSwapArtifact, feeLimit);
  const initData = initIface.encodeFunctionData("initialize", [ownerHex]);
  const fastSwapAddress = await deployTronContract(tronWeb, proxyArtifact, feeLimit, [
    fastSwapImplementation,
    initData,
  ]);
  const sweeperAddress = await deployTronContract(tronWeb, sweeperArtifact, feeLimit, [fastSwapAddress]);

  const sweeperContract = await tronWeb.contract().at(sweeperAddress);
  const forwarderImplementation = tronWeb.address.fromHex(
    await sweeperContract.forwarderImplementation().call()
  ) as string;

  let liquidityManagerImplementation = "";
  let liquidityManagerAddress = "";
  if (input.includeLiquidityManager !== false) {
    liquidityManagerImplementation = await deployTronContract(tronWeb, lmArtifact, feeLimit);
    const lmInitData = initIface.encodeFunctionData("initialize", [ownerHex]);
    liquidityManagerAddress = await deployTronContract(tronWeb, proxyArtifact, feeLimit, [
      liquidityManagerImplementation,
      lmInitData,
    ]);
  }

  const addresses = {
    fastSwapImplementation,
    fastSwapAddress,
    sweeperAddress,
    forwarderImplementation,
    liquidityManagerImplementation,
    liquidityManagerAddress,
  };

  if (input.save !== false) {
    const next = updateTronContracts(input.config, addresses);
    saveFastSwapConfig(next, input.configPath);
  }

  return { chainKey, addresses };
}

export async function readTronOnChainState(input: {
  config: FastSwapConfigFile;
  chainKey?: string;
  addresses: {
    fastSwapAddress: string;
    sweeperAddress: string;
    liquidityManagerAddress?: string;
  };
}) {
  const chainKey = input.chainKey ?? "tron";
  const chain = getChainDefinition(input.config, chainKey);
  const fullHost = chain.fullHost ?? chain.rpcUrl;
  if (!fullHost) throw new Error(`Missing fullHost for chain "${chainKey}"`);

  const tronWeb = new TronWeb({ fullHost });
  const sweeperArtifact = await readArtifact("contracts/tron/TronInvoiceSweeper.sol/TronInvoiceSweeper.json");
  const fastSwapArtifact = await readArtifact("contracts/tron/fastswap/TronFastSwapReceiver.sol/TronFastSwapReceiver.json");

  const [fastSwapDeployed, sweeperDeployed, lmDeployed] = await Promise.all([
    tronHasContract(tronWeb, input.addresses.fastSwapAddress),
    tronHasContract(tronWeb, input.addresses.sweeperAddress),
    input.addresses.liquidityManagerAddress
      ? tronHasContract(tronWeb, input.addresses.liquidityManagerAddress)
      : Promise.resolve(false),
  ]);

  const sweeper = await tronWeb.contract(sweeperArtifact.abi as never, input.addresses.sweeperAddress);
  const receiver = tronWeb.address.fromHex((await sweeper.receiver().call()) as string) as string;
  const forwarderImplementation = tronWeb.address.fromHex(
    (await sweeper.forwarderImplementation().call()) as string
  ) as string;

  let fastSwapPaused = false;
  if (fastSwapDeployed) {
    const fastSwap = await tronWeb.contract(fastSwapArtifact.abi as never, input.addresses.fastSwapAddress);
    fastSwapPaused = Boolean(await fastSwap.paused().call().catch(() => false));
  }

  return {
    chainKey,
    chainId: chain.id,
    deployed: {
      fastSwap: fastSwapDeployed,
      sweeper: sweeperDeployed,
      liquidityManager: lmDeployed,
    },
    sweeperReceiver: receiver,
    forwarderImplementation,
    fastSwapPaused,
    receiverMatches: receiver === input.addresses.fastSwapAddress,
  };
}

async function deployTronContract(
  tronWeb: TronWeb,
  artifact: { abi: unknown; bytecode: string },
  feeLimit: number,
  parameters: unknown[] = []
): Promise<string> {
  const result = await tronWeb.contract().new({
    abi: artifact.abi as never,
    bytecode: artifact.bytecode.replace(/^0x/, ""),
    feeLimit,
    parameters: parameters as never,
  } as never);
  const address: string = (result as { address: string }).address;
  return address.startsWith("T") ? address : (tronWeb.address.fromHex(address) as string);
}

async function tronHasContract(tronWeb: TronWeb, address: string): Promise<boolean> {
  try {
    const contract = await tronWeb.trx.getContract(address);
    return Boolean(contract && contract.bytecode);
  } catch {
    return false;
  }
}
