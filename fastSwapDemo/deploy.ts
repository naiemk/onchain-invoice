import { Contract, ContractFactory, JsonRpcProvider, NonceManager, Wallet, ZeroAddress, type Signer } from "ethers";
import { writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { mkdir } from "node:fs/promises";
import { DEMO_DEPLOY_CHAINS, DEMO_PRIVATE_KEY, type DemoChainConfig, type DemoChainDeployment, type DemoDeployment } from "./config.js";
import { readArtifact, type ContractArtifact } from "../app/fastswap/cli/artifacts.js";

export const DEMO_DEPLOYMENT_PATH = join(process.cwd(), "fastSwapDemo", "state", "deployment.json");

export async function deployDemo(): Promise<DemoDeployment> {
  // Deploy chains sequentially so both Hardhat nodes have finished binding before first JSON-RPC use.
  const chains: DemoChainDeployment[] = [];
  for (const chain of DEMO_DEPLOY_CHAINS) {
    chains.push(await deployChain(chain));
  }
  if (chains.length === 0) throw new Error("Demo deployment requires at least one demoDeploy chain");

  const deployment = { chains };
  await mkdir(dirname(DEMO_DEPLOYMENT_PATH), { recursive: true });
  await writeFile(DEMO_DEPLOYMENT_PATH, JSON.stringify(deployment, null, 2));
  return deployment;
}

async function deployChain(input: DemoChainConfig): Promise<DemoChainDeployment> {
  const provider = new JsonRpcProvider(required(input.rpcUrl, `${input.key} rpcUrl`));
  const wallet = new NonceManager(new Wallet(DEMO_PRIVATE_KEY, provider));
  const [fastSwapArtifact, proxyArtifact, sweeperArtifact, tokenArtifact] = await Promise.all([
    readArtifact("contracts/fastswap/FastSwapReceiver.sol/FastSwapReceiver.json"),
    readArtifact("contracts/proxy/ReceiverProxy.sol/ReceiverProxy.json"),
    readArtifact("contracts/InvoiceSweeper.sol/InvoiceSweeper.json"),
    readArtifact("contracts/mocks/MockERC20.sol/MockERC20.json"),
  ]);

  const fastSwapImplementation = await deployContract(wallet, fastSwapArtifact);
  const owner = await wallet.getAddress();
  const fastSwapInterface = new Contract(fastSwapImplementation.target, fastSwapArtifact.abi, wallet).interface;
  const proxy = await deployContract(
    wallet,
    proxyArtifact,
    fastSwapImplementation.target,
    fastSwapInterface.encodeFunctionData("initialize", [owner])
  );
  const fastSwap = new Contract(proxy.target, fastSwapArtifact.abi, wallet);
  const sweeper = await deployContract(wallet, sweeperArtifact, fastSwap.target);
  const token = await deployContract(
    wallet,
    tokenArtifact,
    required(input.stableTokenName, `${input.key} stableTokenName`),
    required(input.stableTokenSymbol, `${input.key} stableTokenSymbol`),
    required(input.stableTokenDecimals, `${input.key} stableTokenDecimals`)
  ) as Contract;

  await (await token.mint(owner, BigInt(required(input.stableOwnerMint, `${input.key} stableOwnerMint`)))).wait();
  await (await token.mint(fastSwap.target, BigInt(required(input.stableInitialLiquidity, `${input.key} stableInitialLiquidity`)))).wait();
  const nativeInitialLiquidity = BigInt(required(input.nativeInitialLiquidity, `${input.key} nativeInitialLiquidity`));
  await (await fastSwap.addLiquidity(ZeroAddress, nativeInitialLiquidity, { value: nativeInitialLiquidity })).wait();

  return {
    id: input.id,
    name: input.name,
    rpcUrl: required(input.rpcUrl, `${input.key} rpcUrl`),
    receiver: String(fastSwap.target),
    fastSwap: String(fastSwap.target),
    sweeper: String(sweeper.target),
    nativeSymbol: input.nativeSymbol,
    tokens: {
      native: ZeroAddress,
      nativePriceUsdMicros: input.nativePriceUsdMicros,
      nativeMinLiquidity: input.nativeMinLiquidity,
      stable: {
        symbol: required(input.stableTokenSymbol, `${input.key} stableTokenSymbol`),
        address: String(token.target),
        decimals: required(input.stableTokenDecimals, `${input.key} stableTokenDecimals`),
        priceUsdMicros: input.stablePriceUsdMicros,
        minLiquidity: input.stableMinLiquidity,
      },
    },
    startBlock: await provider.getBlockNumber(),
  };
}

function required<T>(value: T | undefined, name: string): T {
  if (value === undefined || value === "") throw new Error(`Missing ${name} in demo config`);
  return value;
}

async function deployContract(signer: Signer, artifact: ContractArtifact, ...args: unknown[]) {
  const factory = new ContractFactory(artifact.abi, artifact.bytecode, signer);
  const contract = await factory.deploy(...args);
  await contract.waitForDeployment();
  return contract;
}

if (process.argv[1]?.endsWith("deploy.js")) {
  deployDemo()
    .then((deployment) => console.log(JSON.stringify(deployment, null, 2)))
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}
