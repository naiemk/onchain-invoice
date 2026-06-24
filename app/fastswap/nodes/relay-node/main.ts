#!/usr/bin/env node
import { loadFastSwapConfig, resolveConfigPath } from "../../config/load.js";
import { toRelayRunnerConfig } from "../../config/adapters/relay.js";
import { RelayRunner } from "./runner.js";

const configPath = process.argv[2] ?? resolveConfigPath();
const config = loadFastSwapConfig(configPath);
const runner = new RelayRunner(toRelayRunnerConfig(config));

await runner.start();

const stop = () => {
  runner.stop();
  process.exit(0);
};

process.on("SIGINT", stop);
process.on("SIGTERM", stop);
