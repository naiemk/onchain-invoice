import { readFile } from "node:fs/promises";
import { JSON_SCHEMA, load as loadYaml } from "js-yaml";

/** Load YAML with ${ENV} expansion. */
export async function load(path: string): Promise<Record<string, unknown>> {
  const raw = await readFile(path, "utf8");
  const expanded = raw.replace(/\$\{([A-Z0-9_]+)\}/g, (_, key: string) => process.env[key] ?? "");
  // JSON_SCHEMA: keep 0x… keys/addresses as strings. Default YAML 1.1 parses them as
  // ints and silently corrupts 256-bit private keys (ethers: "invalid private key").
  return (loadYaml(expanded, { schema: JSON_SCHEMA }) as Record<string, unknown>) ?? {};
}
