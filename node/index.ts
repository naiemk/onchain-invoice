import { loadSweepNodeConfig } from "./config.js";
import { SweepNode } from "./sweep-node.js";

const configPath = process.argv[2] ?? "sweep-node.config.json";
const node = new SweepNode(loadSweepNodeConfig(configPath));

process.on("SIGINT", () => {
  node.stop();
  process.exit(0);
});

process.on("SIGTERM", () => {
  node.stop();
  process.exit(0);
});

node.start();
