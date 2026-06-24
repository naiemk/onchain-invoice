#!/usr/bin/env node
import { loadFastSwapConfig, resolveConfigPath } from "../config/load.js";
import { toSweepNodeConfig } from "../config/adapters/sweep.js";
import { SweepNode } from "../../../node/sweep-node.js";

const configPath = process.argv[2] ?? resolveConfigPath();
const fastswap = loadFastSwapConfig(configPath);
const publicUrl = fastswap.server.publicUrl ?? `http://${fastswap.server.host}:${fastswap.server.apiPort}`;
const sweepConfig = toSweepNodeConfig(fastswap, publicUrl.replace(/\/$/, ""));

const node = new SweepNode(sweepConfig);

process.on("SIGINT", () => {
  node.stop();
  process.exit(0);
});

process.on("SIGTERM", () => {
  node.stop();
  process.exit(0);
});

node.start();
