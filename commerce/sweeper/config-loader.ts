import { readFile } from "node:fs/promises";
import { load as loadYaml } from "js-yaml";

/** Load YAML with ${ENV} expansion. */
export async function load(path: string): Promise<Record<string, unknown>> {
  const raw = await readFile(path, "utf8");
  const expanded = raw.replace(/\$\{([A-Z0-9_]+)\}/g, (_, key: string) => process.env[key] ?? "");
  return (loadYaml(expanded) as Record<string, unknown>) ?? {};
}
