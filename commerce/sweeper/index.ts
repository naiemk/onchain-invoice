import { loadSweeperConfig, SweeperWorker } from "./worker.js";

const configPath = process.env.SWEEPER_CONFIG ?? process.argv[2] ?? "commerce/config/sweeper.example.yaml";
const config = await loadSweeperConfig(configPath);
const worker = new SweeperWorker(config);

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`trustless-commerce sweeper received ${signal}; draining in-flight work…`);
  await worker.stopAndWait();
  console.log("trustless-commerce sweeper stopped");
  process.exit(0);
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    void shutdown(signal);
  });
}

console.log(`trustless-commerce sweeper polling ${config.serverUrl}`);
if (config.activityLogPath) {
  console.log(`activity log: ${config.activityLogPath}`);
}
await worker.start();
