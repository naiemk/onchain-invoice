import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";

export type AuditEvent = {
  ts: string;
  stage: string;
  service: string;
  invoiceId?: string;
  traceId?: string;
  chainId?: string;
  txHash?: string;
  payload?: Record<string, unknown>;
};

export class AuditLog {
  private ready?: Promise<void>;

  constructor(private readonly path: string, private readonly service: string) {}

  append(stage: string, fields: Omit<AuditEvent, "ts" | "stage" | "service"> = {}): void {
    const event: AuditEvent = {
      ts: new Date().toISOString(),
      stage,
      service: this.service,
      ...fields,
    };
    void this.writeLine(JSON.stringify(event));
  }

  traceId(): string {
    return randomUUID();
  }

  private async writeLine(line: string) {
    if (!this.ready) {
      this.ready = mkdir(dirname(this.path), { recursive: true }).then(() => undefined);
    }
    await this.ready;
    await appendFile(this.path, `${line}\n`, "utf8");
  }
}
