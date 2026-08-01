import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { log } from "./logger.js";

const config = loadConfig();
const app = createApp(config);

app.server.listen(config.port, () => {
  log("info", "trustless-commerce API listening", {
    baseUrl: config.baseUrl,
    port: config.port,
    configPath: config.configPath ?? null,
  });
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    app.close()
      .catch((error) => {
        log("error", "Error while shutting down", { error: String(error) });
        process.exitCode = 1;
      })
      .finally(() => process.exit());
  });
}
