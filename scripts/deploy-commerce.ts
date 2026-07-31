import { network } from "hardhat";

/** Deploy CommerceInvoiceSweeper to the in-process Hardhat network (or configured network). */
async function main() {
  const { ethers } = await network.create();
  const [deployer] = await ethers.getSigners();

  const feeBps = Number(process.env.FEE_BPS ?? "50");
  const feeRecipient = process.env.FEE_RECIPIENT ?? deployer.address;
  const owner = process.env.OWNER ?? deployer.address;

  const Deployer = await ethers.getContractFactory("CommerceSystemDeployer");
  const systemDeployer = await Deployer.deploy();
  await systemDeployer.waitForDeployment();

  const tx = await systemDeployer.deploy(feeRecipient, feeBps, owner);
  const receipt = await tx.wait();

  const event = receipt?.logs
    .map((log: any) => {
      try {
        return systemDeployer.interface.parseLog(log);
      } catch {
        return null;
      }
    })
    .find((log: any) => log?.name === "CommerceSystemDeployed");

  if (!event) {
    throw new Error("CommerceSystemDeployed event not found");
  }

  console.log(
    JSON.stringify(
      {
        sweeper: event.args.sweeper,
        feeRecipient: event.args.feeRecipient,
        forwarderImplementation: event.args.forwarderImplementation,
        feeBps: Number(event.args.feeBps),
        deployer: deployer.address,
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
