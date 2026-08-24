import { loadWalletDeployerConfig, WalletDeployerWorker } from "./worker.js";

const configPath =
  process.env.WALLET_DEPLOYER_CONFIG ?? process.argv[2] ?? "commerce/config/wallet-deployer.example.yaml";
const config = await loadWalletDeployerConfig(configPath);
const worker = new WalletDeployerWorker(config);

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`trustless-commerce wallet-deployer received ${signal}; draining…`);
  await worker.stopAndWait();
  console.log("trustless-commerce wallet-deployer stopped");
  process.exit(0);
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    void shutdown(signal);
  });
}

console.log(`trustless-commerce wallet-deployer polling ${config.serverUrl}`);
if (config.activityLogPath) {
  console.log(`activity log: ${config.activityLogPath}`);
}
await worker.start();
