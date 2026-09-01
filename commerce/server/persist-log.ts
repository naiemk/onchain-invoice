import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import { gzipSync, gunzipSync } from "node:zlib";
import { join } from "node:path";

/** vibed-infra persist-log event (NDJSON WAL). */
export type PersistLogEvent = {
  ts: string;
  stream: string;
  type: string;
  id: string;
  payload: Record<string, unknown>;
};

export const WALLET_PERSIST_STREAM = "wallet";

const DEFAULT_ROTATE_BYTES = 8 * 1024 * 1024;
const DEFAULT_ROTATE_SEC = 60;

/** Append-only domain event log for disaster recovery (vibed-infra persist-logs). */
export class PersistLog {
  constructor(private readonly baseDir: string) {}

  static fromEnv(): PersistLog | null {
    const dir = process.env.PERSIST_LOG_DIR?.trim();
    return dir ? new PersistLog(dir) : null;
  }

  append(
    stream: string,
    eventType: string,
    payload: Record<string, unknown> = {},
    eventId?: string
  ): void {
    try {
      this.appendSync(stream, eventType, payload, eventId);
    } catch (error) {
      console.error(
        "persist log write failed",
        error instanceof Error ? error.message : error
      );
    }
  }

  /** Synchronous append with fsync (hot path for wallet DR). */
  appendSync(
    stream: string,
    eventType: string,
    payload: Record<string, unknown> = {},
    eventId?: string
  ): PersistLogEvent {
    const streamDir = join(this.baseDir, stream);
    mkdirSync(streamDir, { recursive: true });
    const evt: PersistLogEvent = {
      ts: new Date().toISOString(),
      stream,
      type: eventType,
      id: eventId ?? `${Date.now()}-${randomUUID()}`,
      payload,
    };
    const line = `${JSON.stringify(evt)}\n`;
    const walPath = join(streamDir, "wal.ndjson");
    const fd = openSync(walPath, "a");
    try {
      writeSync(fd, line, undefined, "utf8");
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    maybeSealSync(streamDir);
    return evt;
  }
}

function maybeSealSync(
  streamDir: string,
  rotateBytes = DEFAULT_ROTATE_BYTES,
  rotateSec = DEFAULT_ROTATE_SEC
): void {
  const walPath = join(streamDir, "wal.ndjson");
  if (!existsSync(walPath)) return;
  const st = statSync(walPath);
  if (st.size === 0) return;
  const ageSec = (Date.now() - st.mtimeMs) / 1000;
  if (st.size < rotateBytes && ageSec < rotateSec) return;
  sealSync(streamDir);
}

function sealSync(streamDir: string): void {
  const walPath = join(streamDir, "wal.ndjson");
  if (!existsSync(walPath)) return;
  const st = statSync(walPath);
  if (st.size === 0) return;

  let maxSeg = 0;
  for (const name of readdirSync(streamDir)) {
    const match = /^seg-(\d+)\.ndjson\.gz$/.exec(name);
    if (match) maxSeg = Math.max(maxSeg, Number(match[1]));
  }
  const dest = join(streamDir, `seg-${String(maxSeg + 1).padStart(6, "0")}.ndjson.gz`);
  const tmp = join(streamDir, "wal.rotating");
  renameSync(walPath, tmp);
  writeFileSync(dest, gzipSync(readFileSync(tmp)));
  unlinkSync(tmp);
  writeFileSync(join(streamDir, "wal.ndjson"), "");
}

/** Iterate sealed segments then active WAL in order. */
export async function* iterPersistEvents(
  baseDir: string,
  stream: string
): AsyncGenerator<PersistLogEvent> {
  const streamDir = join(baseDir, stream);
  let segNames: string[] = [];
  try {
    segNames = readdirSync(streamDir).filter((n) => n.startsWith("seg-") && n.endsWith(".ndjson.gz"));
  } catch {
    return;
  }
  segNames.sort();
  for (const name of segNames) {
    const text = gunzipSync(readFileSync(join(streamDir, name))).toString("utf8");
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (trimmed) yield JSON.parse(trimmed) as PersistLogEvent;
    }
  }
  const walPath = join(streamDir, "wal.ndjson");
  try {
    const wal = readFileSync(walPath, "utf8");
    for (const line of wal.split("\n")) {
      const trimmed = line.trim();
      if (trimmed) yield JSON.parse(trimmed) as PersistLogEvent;
    }
  } catch {
    /* no wal */
  }
}

export async function collectPersistEvents(
  baseDir: string,
  stream: string
): Promise<PersistLogEvent[]> {
  const events: PersistLogEvent[] = [];
  for await (const evt of iterPersistEvents(baseDir, stream)) {
    events.push(evt);
  }
  return events;
}
