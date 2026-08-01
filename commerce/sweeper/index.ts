import { loadSweeperConfig, SweeperWorker } from "./worker.js";

const configPath = process.env.SWEEPER_CONFIG ?? process.argv[2] ?? "commerce/config/sweeper.example.yaml";
const config = await loadSweeperConfig(configPath);
const worker = new SweeperWorker(config);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    worker.stop();
  });
}

console.log(`trustless-commerce sweeper polling ${config.serverUrl}`);
await worker.start();
