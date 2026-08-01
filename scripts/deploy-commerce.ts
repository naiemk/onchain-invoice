import { network } from "hardhat";
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

/** Deploy CommerceInvoiceSweeper. Pass `--network sepolia` for testnet. */
async function main() {
  const connection = await network.connect();
  const { ethers, networkName } = connection as typeof connection & { networkName?: string };
  const [deployer] = await ethers.getSigners();

  const feeBps = Number(process.env.FEE_BPS ?? "50");
  const feeRecipient = process.env.FEE_RECIPIENT ?? deployer.address;
  const owner = process.env.OWNER ?? deployer.address;

  console.error(`Deploying CommerceInvoiceSweeper on network=${networkName ?? "default"} as ${deployer.address}`);
  console.error(`feeRecipient=${feeRecipient} feeBps=${feeBps} owner=${owner}`);

  const Factory = await ethers.getContractFactory("CommerceInvoiceSweeper");
  const sweeper = await Factory.deploy(feeRecipient, feeBps, owner, {
    gasLimit: 5_000_000n,
  });
  await sweeper.waitForDeployment();
  const sweeperAddress = await sweeper.getAddress();
  const forwarderImplementation = await sweeper.forwarderImplementation();

  const result = {
    network: networkName ?? "unknown",
    chainId: Number((await ethers.provider.getNetwork()).chainId),
    sweeper: sweeperAddress,
    feeRecipient,
    forwarderImplementation,
    feeBps,
    deployer: deployer.address,
    deployedAt: new Date().toISOString(),
  };

  console.log(JSON.stringify(result, null, 2));

  const outDir = resolve("data");
  mkdirSync(outDir, { recursive: true });
  const outPath = resolve(outDir, `commerce-deploy-${result.network}.json`);
  writeFileSync(outPath, `${JSON.stringify(result, null, 2)}\n`);
  console.error(`Wrote ${outPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
