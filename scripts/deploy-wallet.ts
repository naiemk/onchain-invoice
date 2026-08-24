import { network } from "hardhat";
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

function envOptional(name: string, fallback = ""): string {
  return process.env[name]?.trim() || fallback;
}

/** Deploy wallet stack. Pass `--network sepolia`. Run `npm run wallet:verify:sepolia` after. */
async function main() {
  const connection = await network.connect();
  const { ethers, networkName } = connection as typeof connection & { networkName?: string };
  const [deployer] = await ethers.getSigners();

  const recoveryTimelock = BigInt(envOptional("WALLET_RECOVERY_TIMELOCK", "259200"));
  const guardian = envOptional("WALLET_ADMIN_GUARDIAN", deployer.address);

  console.error(`Deploying wallet stack on network=${networkName ?? "default"} as ${deployer.address}`);
  console.error(`guardian=${guardian} recoveryTimelock=${recoveryTimelock}`);

  const WalletImpl = await ethers.getContractFactory("Wallet");
  const walletImpl = await WalletImpl.deploy();
  await walletImpl.waitForDeployment();

  const Recovery = await ethers.getContractFactory("AdminGuardianRecovery");
  const recovery = await Recovery.deploy(guardian, deployer.address);
  await recovery.waitForDeployment();

  const Factory = await ethers.getContractFactory("WalletFactory");
  const factory = await Factory.deploy(
    await walletImpl.getAddress(),
    await recovery.getAddress(),
    recoveryTimelock,
    deployer.address
  );
  await factory.waitForDeployment();

  const chainId = Number((await ethers.provider.getNetwork()).chainId);
  const result = {
    network: networkName ?? "unknown",
    chainId,
    walletImplementation: await walletImpl.getAddress(),
    recovery: await recovery.getAddress(),
    factory: await factory.getAddress(),
    recoveryTimelock: recoveryTimelock.toString(),
    guardian,
    deployer: deployer.address,
    deployedAt: new Date().toISOString(),
  };

  console.log(JSON.stringify(result, null, 2));

  const outDir = resolve("data");
  mkdirSync(outDir, { recursive: true });
  const outPath = resolve(outDir, `wallet-deploy-${result.network}.json`);
  writeFileSync(outPath, `${JSON.stringify(result, null, 2)}\n`);
  console.error(`Wrote ${outPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
