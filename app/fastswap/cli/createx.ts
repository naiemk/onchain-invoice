import type { ResolvedDeploySalts } from "../config/salts.js";
import {
  Contract,
  ContractFactory,
  getAddress,
  getCreate2Address,
  keccak256,
  type Provider,
  type Signer,
} from "ethers";

/**
 * Canonical CreateX factory — same address on every supported EVM chain.
 * @see https://github.com/pcaversaccio/createx
 */
export const CREATEX_ADDRESS = "0xba5Ed099633D3B313e4D5F7bdc1305d3c28ba5Ed";

const CREATEX_ABI = [
  "function deployCreate2(bytes32 salt, bytes initCode) payable returns (address)",
  "function computeCreate2Address(bytes32 salt, bytes32 initCodeHash, address deployer) pure returns (address)",
] as const;

export type CreateXInit = {
  label: string;
  salt: string;
  initCode: string;
};

export function predictCreateXAddress(createx: string, salt: string, initCode: string): string {
  return getCreate2Address(getAddress(createx), normalizeSalt(salt), keccak256(initCode));
}

export async function assertCreateXDeployed(provider: Provider, createx: string): Promise<void> {
  const code = await provider.getCode(getAddress(createx));
  if (code === "0x") {
    throw new Error(`CreateX is not deployed at ${createx} on this chain`);
  }
}

export async function verifyCreateXPrediction(
  provider: Provider,
  createx: string,
  salt: string,
  initCode: string
): Promise<string> {
  const predicted = predictCreateXAddress(createx, salt, initCode);
  const factory = new Contract(getAddress(createx), CREATEX_ABI, provider);
  const onChain = await factory.computeCreate2Address(normalizeSalt(salt), keccak256(initCode), getAddress(createx));
  if (getAddress(predicted) !== getAddress(onChain)) {
    throw new Error(`CreateX address mismatch: local=${predicted} on-chain=${onChain}`);
  }
  return predicted;
}

export async function buildInitCode(
  artifact: { abi: unknown; bytecode: string },
  args: unknown[] = []
): Promise<string> {
  const factory = new ContractFactory(artifact.abi as never, artifact.bytecode);
  const deployTx = await factory.getDeployTransaction(...args);
  if (!deployTx.data) throw new Error("Missing deployment init code");
  return deployTx.data;
}

export async function deployViaCreateX(
  signer: Signer,
  createx: string,
  salt: string,
  initCode: string
): Promise<string> {
  const factoryAddress = getAddress(createx);
  const predicted = predictCreateXAddress(factoryAddress, salt, initCode);
  const provider = signer.provider;
  if (!provider) throw new Error("Signer provider is required");

  const existing = await provider.getCode(predicted);
  if (existing !== "0x") return predicted;

  await assertCreateXDeployed(provider, factoryAddress);

  const createxContract = new Contract(factoryAddress, CREATEX_ABI, signer);
  const tx = await createxContract.deployCreate2(normalizeSalt(salt), initCode);
  await tx.wait();

  const deployed = await provider.getCode(predicted);
  if (deployed === "0x") {
    throw new Error(`CreateX deployment failed for ${predicted}`);
  }
  return predicted;
}

export async function predictStackAddresses(input: {
  createx: string;
  owner: string;
  salts: ResolvedDeploySalts;
  artifacts: {
    fastSwap: { abi: unknown; bytecode: string };
    proxy: { abi: unknown; bytecode: string };
    sweeper: { abi: unknown; bytecode: string };
    liquidityManager: { abi: unknown; bytecode: string };
  };
}): Promise<{
  fastSwapImplementation: string;
  fastSwapAddress: string;
  sweeperAddress: string;
  forwarderImplementation: string;
  liquidityManagerImplementation: string;
  liquidityManagerAddress: string;
}> {
  const owner = getAddress(input.owner);
  const fastSwapFactory = new ContractFactory(input.artifacts.fastSwap.abi as never, input.artifacts.fastSwap.bytecode);
  const initData = fastSwapFactory.interface.encodeFunctionData("initialize", [owner]);

  const fastSwapImplementationInit = await buildInitCode(input.artifacts.fastSwap);
  const fastSwapImplementation = predictCreateXAddress(
    input.createx,
    input.salts.fastSwapImplementation,
    fastSwapImplementationInit
  );

  const proxyInit = await buildInitCode(input.artifacts.proxy, [fastSwapImplementation, initData]);
  const fastSwapAddress = predictCreateXAddress(input.createx, input.salts.fastSwapProxy, proxyInit);

  const sweeperInit = await buildInitCode(input.artifacts.sweeper, [fastSwapAddress]);
  const sweeperAddress = predictCreateXAddress(input.createx, input.salts.invoiceSweeper, sweeperInit);

  const lmFactory = new ContractFactory(
    input.artifacts.liquidityManager.abi as never,
    input.artifacts.liquidityManager.bytecode
  );
  const lmInitData = lmFactory.interface.encodeFunctionData("initialize", [owner]);

  const lmImplementationInit = await buildInitCode(input.artifacts.liquidityManager);
  const liquidityManagerImplementation = predictCreateXAddress(
    input.createx,
    input.salts.liquidityManagerImplementation,
    lmImplementationInit
  );

  const lmProxyInit = await buildInitCode(input.artifacts.proxy, [liquidityManagerImplementation, lmInitData]);
  const liquidityManagerAddress = predictCreateXAddress(
    input.createx,
    input.salts.liquidityManagerProxy,
    lmProxyInit
  );

  return {
    fastSwapImplementation,
    fastSwapAddress,
    sweeperAddress,
    forwarderImplementation: "",
    liquidityManagerImplementation,
    liquidityManagerAddress,
  };
}

export async function deployEvmStackViaCreateX(input: {
  signer: Signer;
  createx: string;
  owner: string;
  salts: ResolvedDeploySalts;
  artifacts: {
    fastSwap: { abi: unknown; bytecode: string };
    proxy: { abi: unknown; bytecode: string };
    sweeper: { abi: unknown; bytecode: string };
    liquidityManager: { abi: unknown; bytecode: string };
  };
  includeLiquidityManager?: boolean;
}): Promise<{
  fastSwapImplementation: string;
  fastSwapAddress: string;
  sweeperAddress: string;
  forwarderImplementation: string;
  liquidityManagerImplementation: string;
  liquidityManagerAddress: string;
}> {
  const owner = getAddress(input.owner);
  const createx = getAddress(input.createx);
  const provider = input.signer.provider;
  if (!provider) throw new Error("Signer provider is required");

  await assertCreateXDeployed(provider, createx);

  const fastSwapFactory = new ContractFactory(input.artifacts.fastSwap.abi as never, input.artifacts.fastSwap.bytecode);
  const lmFactory = new ContractFactory(
    input.artifacts.liquidityManager.abi as never,
    input.artifacts.liquidityManager.bytecode
  );
  const initData = fastSwapFactory.interface.encodeFunctionData("initialize", [owner]);
  const lmInitData = lmFactory.interface.encodeFunctionData("initialize", [owner]);

  const fastSwapImplementationInit = await buildInitCode(input.artifacts.fastSwap);
  const fastSwapImplementation = await deployViaCreateX(
    input.signer,
    createx,
    input.salts.fastSwapImplementation,
    fastSwapImplementationInit
  );

  const proxyInit = await buildInitCode(input.artifacts.proxy, [fastSwapImplementation, initData]);
  const fastSwapAddress = await deployViaCreateX(input.signer, createx, input.salts.fastSwapProxy, proxyInit);

  const sweeperInit = await buildInitCode(input.artifacts.sweeper, [fastSwapAddress]);
  const sweeperAddress = await deployViaCreateX(input.signer, createx, input.salts.invoiceSweeper, sweeperInit);

  const sweeperRead = new Contract(sweeperAddress, input.artifacts.sweeper.abi as never, provider);
  const forwarderImplementation = String(await sweeperRead.getFunction("forwarderImplementation")());

  let liquidityManagerImplementation = "";
  let liquidityManagerAddress = "";
  if (input.includeLiquidityManager !== false) {
    const lmImplementationInit = await buildInitCode(input.artifacts.liquidityManager);
    liquidityManagerImplementation = await deployViaCreateX(
      input.signer,
      createx,
      input.salts.liquidityManagerImplementation,
      lmImplementationInit
    );

    const lmProxyInit = await buildInitCode(input.artifacts.proxy, [liquidityManagerImplementation, lmInitData]);
    liquidityManagerAddress = await deployViaCreateX(
      input.signer,
      createx,
      input.salts.liquidityManagerProxy,
      lmProxyInit
    );
  }

  return {
    fastSwapImplementation,
    fastSwapAddress,
    sweeperAddress,
    forwarderImplementation,
    liquidityManagerImplementation,
    liquidityManagerAddress,
  };
}

function normalizeSalt(salt: string): string {
  const normalized = salt.startsWith("0x") ? salt : `0x${salt}`;
  if (normalized.length !== 66) {
    throw new Error(`CREATE2 salt must be 32 bytes (got ${normalized.length - 2} bytes): ${salt}`);
  }
  return normalized;
}
