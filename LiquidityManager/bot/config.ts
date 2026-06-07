import { readFileSync } from "node:fs";
import type { LiquidityManagerConfig } from "../shared/types.js";

/** Load JSON config, expanding ${ENV_VAR} placeholders (RPC URLs, addresses, keys). */
export function loadConfig(path: string): LiquidityManagerConfig {
  const raw = readFileSync(path, "utf8");
  const expanded = raw.replace(/\$\{([A-Z0-9_]+)\}/g, (_, key: string) => process.env[key] ?? "");
  return JSON.parse(expanded) as LiquidityManagerConfig;
}
