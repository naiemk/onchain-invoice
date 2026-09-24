import { network } from "hardhat";
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

function envOptional(name: string, fallback = ""): string {
  return process.env[name]?.trim() || fallback;
}

/** Deploy IdentityStore + IdentityWalletFactory. Pass `--network base` (or sepolia). */
async function main() {
  const connection = await network.connect();
  const { ethers, networkName } = connection as typeof connection & { networkName?: string };
  const [deployer] = await ethers.getSigners();

  const recoveryOperator = envOptional("IDENTITY_RECOVERY_OPERATOR", deployer.address);
  const restoreDelay = BigInt(envOptional("IDENTITY_RESTORE_DELAY", "259200"));

  console.error(`Deploying identity wallet stack on network=${networkName ?? "default"} as ${deployer.address}`);
  console.error(`recoveryOperator=${recoveryOperator} restoreDelay=${restoreDelay}`);

  const Store = await ethers.getContractFactory("IdentityStore");
  const store = await Store.deploy(recoveryOperator, deployer.address);
  await store.waitForDeployment();
  if (restoreDelay > 0n) {
    const tx = await store.setRestoreDelay(restoreDelay);
    await tx.wait();
  }

  const Impl = await ethers.getContractFactory("IdentityWallet");
  const impl = await Impl.deploy();
  await impl.waitForDeployment();

  const Factory = await ethers.getContractFactory("IdentityWalletFactory");
  const factory = await Factory.deploy(await impl.getAddress(), await store.getAddress(), deployer.address);
  await factory.waitForDeployment();

  const chainId = Number((await ethers.provider.getNetwork()).chainId);
  const result = {
    network: networkName ?? "unknown",
    chainId,
    identityStore: await store.getAddress(),
    walletImplementation: await impl.getAddress(),
    factory: await factory.getAddress(),
    recoveryOperator,
    restoreDelay: restoreDelay.toString(),
    deployer: deployer.address,
    deployedAt: new Date().toISOString(),
  };

  console.log(JSON.stringify(result, null, 2));

  const outDir = resolve("data");
  mkdirSync(outDir, { recursive: true });
  const outPath = resolve(outDir, `identity-wallet-deploy-${result.network}.json`);
  writeFileSync(outPath, `${JSON.stringify(result, null, 2)}\n`);
  console.error(`Wrote ${outPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
