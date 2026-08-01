import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

export type ActivityEvent = {
  ts: string;
  stage: string;
  service: string;
  invoiceId?: string;
  chainId?: string;
  invoiceAddress?: string;
  txHash?: string;
  payload?: Record<string, unknown>;
};

/** Append-only JSONL activity log for the commerce sweeper (survives on host bind-mount). */
export class ActivityLog {
  private ready?: Promise<void>;

  constructor(
    private readonly path: string,
    private readonly service = "commerce-sweeper"
  ) {}

  append(stage: string, fields: Omit<ActivityEvent, "ts" | "stage" | "service"> = {}): void {
    const event: ActivityEvent = {
      ts: new Date().toISOString(),
      stage,
      service: this.service,
      ...fields,
    };
    void this.writeLine(JSON.stringify(event));
  }

  private async writeLine(line: string): Promise<void> {
    try {
      if (!this.ready) {
        this.ready = mkdir(dirname(this.path), { recursive: true }).then(() => undefined);
      }
      await this.ready;
      await appendFile(this.path, `${line}\n`, "utf8");
    } catch (error) {
      // Do not crash the sweeper if the host mount is missing or not writable.
      console.error("activity log write failed", error instanceof Error ? error.message : error);
      this.ready = undefined;
    }
  }
}
