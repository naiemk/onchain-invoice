import http from "node:http";

/** When set, workers listen on 127.0.0.1 and only tick when POST /tick is called. */
export function workerTickPortFromEnv(): number {
  const raw = process.env.WORKER_TICK_PORT?.trim();
  if (!raw) return 0;
  const port = Number(raw);
  return Number.isInteger(port) && port > 0 ? port : 0;
}

/**
 * Test-only control plane: POST /tick runs `runTick` (serialized). GET /health for boot readiness.
 * Binds loopback only — not for production traffic.
 */
export async function attachWorkerTickServer(port: number, runTick: () => Promise<void>): Promise<http.Server> {
  let chain: Promise<void> = Promise.resolve();
  const serialized = (): Promise<void> => {
    chain = chain.then(runTick, runTick);
    return chain;
  };

  const server = http.createServer((req, res) => {
    const url = req.url?.split("?")[0] ?? "";
    if (req.method === "GET" && url === "/health") {
      res.writeHead(200);
      res.end("ok");
      return;
    }
    if (req.method === "POST" && (url === "/tick" || url === "/")) {
      void serialized()
        .then(() => {
          if (!res.writableEnded) {
            res.writeHead(200, { "content-type": "application/json" });
            res.end(JSON.stringify({ ok: true }));
          }
        })
        .catch((error) => {
          if (!res.writableEnded) {
            res.writeHead(500, { "content-type": "application/json" });
            res.end(JSON.stringify({ ok: false, error: String(error) }));
          }
        });
      return;
    }
    res.writeHead(404);
    res.end();
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  console.log(`worker tick server listening on 127.0.0.1:${port}`);
  return server;
}

export async function idleUntilStopped(isStopped: () => boolean): Promise<void> {
  while (!isStopped()) {
    await new Promise((r) => setTimeout(r, 250));
  }
}
