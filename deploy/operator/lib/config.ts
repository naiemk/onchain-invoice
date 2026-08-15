import { readFileSync, writeFileSync, existsSync, copyFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { load as yamlLoad, dump as yamlDump } from "js-yaml";
import type { OperatorConfig } from "./types.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
export const OPERATOR_ROOT = resolve(HERE, "..");
export const CONFIG_PATH = resolve(OPERATOR_ROOT, "config.yaml");
export const CONFIG_EXAMPLE_PATH = resolve(OPERATOR_ROOT, "config.example.yaml");

export function ensureConfig(): OperatorConfig {
  if (!existsSync(CONFIG_PATH)) {
    copyFileSync(CONFIG_EXAMPLE_PATH, CONFIG_PATH);
  }
  return loadConfig();
}

export function loadConfig(): OperatorConfig {
  if (!existsSync(CONFIG_PATH)) {
    throw new Error(`Missing ${CONFIG_PATH} — copy config.example.yaml first`);
  }
  const raw = readFileSync(CONFIG_PATH, "utf8");
  const parsed = yamlLoad(raw) as OperatorConfig;
  if (!parsed || typeof parsed !== "object") {
    throw new Error("config.yaml is empty or invalid");
  }
  return parsed;
}

export function saveConfig(config: OperatorConfig): void {
  assertNoSecrets(config);
  const body = yamlDump(config, {
    lineWidth: 120,
    noRefs: true,
    sortingKeys: false,
  });
  writeFileSync(CONFIG_PATH, `${body.trim()}\n`);
}

/** Refuse to persist anything that looks like a private key. */
export function assertNoSecrets(config: OperatorConfig): void {
  const blob = JSON.stringify(config);
  if (/privateKey|PRIVATE_KEY|secretKey|SECRET|mnemonic/i.test(blob) && /0x[0-9a-fA-F]{64}/.test(blob)) {
    throw new Error("Refusing to write config that looks like it contains a private key");
  }
  for (const key of Object.keys(config as unknown as Record<string, unknown>)) {
    if (/private|secret|mnemonic/i.test(key)) {
      throw new Error(`Refusing to write secret field: ${key}`);
    }
  }
}
