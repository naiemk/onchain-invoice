import { network } from "hardhat";

async function main() {
  const { ethers } = await network.create();
  const [deployer] = await ethers.getSigners();

  const SystemDeployer = await ethers.getContractFactory("SystemDeployer");
  const systemDeployer = await SystemDeployer.deploy();
  await systemDeployer.waitForDeployment();

  const tx = await systemDeployer.deploy(deployer.address);
  const receipt = await tx.wait();

  const event = receipt?.logs
    .map((log) => {
      try {
        return systemDeployer.interface.parseLog(log);
      } catch {
        return null;
      }
    })
    .find((log) => log?.name === "SystemDeployed");

  if (!event) {
    throw new Error("SystemDeployed event not found");
  }

  console.log({
    receiver: event.args.receiver,
    sweeper: event.args.sweeper,
    forwarderImplementation: event.args.forwarderImplementation,
  });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
