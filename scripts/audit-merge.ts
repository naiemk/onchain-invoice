import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { AuditEvent } from "../app/fastswap/shared/audit.js";

type AuditRow = AuditEvent & { payload?: Record<string, unknown> };

/** Merge per-service JSONL audit logs sorted by timestamp. */
export async function mergeAuditLogs(paths: string[]): Promise<AuditRow[]> {
  const rows: AuditRow[] = [];
  for (const path of paths) {
    try {
      const text = await readFile(path, "utf8");
      for (const line of text.split("\n")) {
        if (!line.trim()) continue;
        rows.push(JSON.parse(line) as AuditRow);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  return rows.sort((a, b) => a.ts.localeCompare(b.ts));
}

/** Print merged audit timeline to stdout. */
async function main() {
  const paths = process.argv.slice(2);
  if (paths.length === 0) {
    console.error("Usage: node scripts/audit-merge.js <audit.jsonl>...");
    process.exitCode = 1;
    return;
  }
  const merged = await mergeAuditLogs(paths);
  const outPath = process.env.AUDIT_MERGE_OUT;
  const body = merged.map((row) => JSON.stringify(row)).join("\n") + (merged.length ? "\n" : "");
  if (outPath) {
    await mkdir(dirname(outPath), { recursive: true });
    await writeFile(outPath, body, "utf8");
    console.log(`Wrote ${merged.length} events to ${outPath}`);
    return;
  }
  process.stdout.write(body);
}

const invoked = process.argv[1]?.includes("audit-merge");
if (invoked) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
