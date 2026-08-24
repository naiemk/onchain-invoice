import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { execSync } from "node:child_process";

function envOptional(name: string, fallback = ""): string {
  return process.env[name]?.trim() || fallback;
}

/** Verify contracts listed in data/wallet-deploy-{network}.json */
async function main() {
  const networkName = envOptional("HARDHAT_NETWORK", "sepolia");
  const path = resolve("data", `wallet-deploy-${networkName}.json`);
  const result = JSON.parse(readFileSync(path, "utf8")) as Record<string, string>;
  const apiKey = envOptional("ETHERSCAN_API_KEY");
  if (!apiKey) {
    console.error("ETHERSCAN_API_KEY missing — cannot verify");
    process.exitCode = 1;
    return;
  }
  const run = (args: string) => {
    console.error(`> hardhat verify --network ${networkName} ${args}`);
    try {
      execSync(`npx hardhat verify --network ${networkName} ${args}`, {
        stdio: "inherit",
        env: process.env,
      });
    } catch (error) {
      console.error("verify failed:", error instanceof Error ? error.message : error);
    }
  };
  run(result.walletImplementation);
  run(`${result.recovery} ${result.guardian} ${result.deployer}`);
  run(
    `${result.factory} ${result.walletImplementation} ${result.recovery} ${result.recoveryTimelock} ${result.deployer}`
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
