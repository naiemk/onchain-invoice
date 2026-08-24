import { loadBundlerConfig, BundlerWorker } from "./worker.js";

const configPath = process.env.BUNDLER_CONFIG ?? process.argv[2] ?? "commerce/config/bundler.example.yaml";
const config = await loadBundlerConfig(configPath);
const worker = new BundlerWorker(config);

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`trustless-commerce bundler received ${signal}; draining in-flight work…`);
  await worker.stopAndWait();
  console.log("trustless-commerce bundler stopped");
  process.exit(0);
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    void shutdown(signal);
  });
}

console.log(`trustless-commerce bundler polling ${config.serverUrl}`);
if (config.activityLogPath) {
  console.log(`activity log: ${config.activityLogPath}`);
}
await worker.start();
