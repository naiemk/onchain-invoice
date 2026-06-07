import { Interface } from "ethers";
import { TronWeb } from "tronweb";
import { tronAddressToEvmHex } from "../app/fastswap/shared/tron-address.js";
import { readArtifact } from "./artifacts.js";

/**
 * Deploys the TRON FastSwap stack (TronFastSwapReceiver behind a ReceiverProxy plus a
 * TronInvoiceSweeper bound to it) to an external TRON network (e.g. Nile/Shasta).
 *
 * This is a manual, one-off helper (no local TRON node in the demo). Configure via env:
 *   TRON_FULL_HOST   - TRON node HTTP endpoint (e.g. https://nile.trongrid.io)
 *   TRON_PRIVATE_KEY - deployer/owner private key (hex, no 0x)
 *   TRON_FEE_LIMIT   - optional fee limit in SUN (default 1500 TRX)
 *
 * Prints the deployed receiver, sweeper, and forwarder implementation addresses (base58).
 */
export type TronFastSwapDeployResult = {
  receiver: string;
  sweeper: string;
  forwarderImplementation: string;
};

export async function deployTronFastSwap(options?: {
  fullHost?: string;
  privateKey?: string;
  feeLimit?: number;
}): Promise<TronFastSwapDeployResult> {
  const fullHost = options?.fullHost ?? requireEnv("TRON_FULL_HOST");
  const privateKey = options?.privateKey ?? requireEnv("TRON_PRIVATE_KEY");
  const feeLimit = options?.feeLimit ?? Number(process.env.TRON_FEE_LIMIT ?? 1_500_000_000);
  const tronWeb = new TronWeb({ fullHost, privateKey });
  const owner = tronWeb.defaultAddress.base58 as string;

  const [implArtifact, proxyArtifact, sweeperArtifact] = await Promise.all([
    readArtifact("contracts/tron/fastswap/TronFastSwapReceiver.sol/TronFastSwapReceiver.json"),
    readArtifact("contracts/proxy/ReceiverProxy.sol/ReceiverProxy.json"),
    readArtifact("contracts/tron/TronInvoiceSweeper.sol/TronInvoiceSweeper.json"),
  ]);

  const implementation = await deploy(tronWeb, implArtifact, feeLimit, []);
  const initData = new Interface(["function initialize(address initialOwner)"]).encodeFunctionData("initialize", [
    tronAddressToEvmHex(owner),
  ]);
  const proxy = await deploy(tronWeb, proxyArtifact, feeLimit, [implementation, initData]);
  const sweeper = await deploy(tronWeb, sweeperArtifact, feeLimit, [proxy]);

  const sweeperContract = await tronWeb.contract().at(sweeper);
  const forwarderImplementation = tronWeb.address.fromHex(
    await sweeperContract.forwarderImplementation().call()
  );

  return { receiver: proxy, sweeper, forwarderImplementation };
}

async function deploy(
  tronWeb: TronWeb,
  artifact: { abi: unknown; bytecode: string },
  feeLimit: number,
  parameters: unknown[]
): Promise<string> {
  const result = await tronWeb.contract().new({
    abi: artifact.abi as never,
    bytecode: artifact.bytecode.replace(/^0x/, ""),
    feeLimit,
    parameters: parameters as never,
  } as never);
  const address = (result as { address: string }).address;
  return address.startsWith("T") ? address : tronWeb.address.fromHex(address);
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name} env var for TRON FastSwap deploy`);
  return value;
}

if (process.argv[1]?.endsWith("deploy-tron-fastswap.js")) {
  deployTronFastSwap()
    .then((result) => console.log(JSON.stringify(result, null, 2)))
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}
