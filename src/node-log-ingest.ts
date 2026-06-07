export type NodeLogSource = "sweep" | "relay";

export type NodeLogPayload = {
  level?: "debug" | "info" | "warn" | "error";
  message: string;
  metadata?: Record<string, unknown>;
  eventType?: "event" | "heartbeat";
};

export async function sendNodeLog(
  baseUrl: string,
  apiKey: string,
  source: NodeLogSource,
  payload: NodeLogPayload
): Promise<void> {
  const base = baseUrl.replace(/\/$/, "");
  try {
    const response = await fetch(`${base}/node-logs/${source}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": apiKey },
      body: JSON.stringify({
        level: payload.level ?? "info",
        message: payload.message,
        metadata: payload.metadata,
        eventType: payload.eventType ?? "event",
      }),
    });
    if (!response.ok) {
      console.error("[node-log]", source, response.status, await response.text());
    }
  } catch (error) {
    console.error("[node-log]", source, error);
  }
}
