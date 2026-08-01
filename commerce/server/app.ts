import { createServer, type Server } from "node:http";
import type { AppConfig } from "./config.js";
import { CommerceDb } from "./db.js";
import { createRouter } from "./routes.js";

export interface App {
  server: Server;
  db: CommerceDb;
  close: () => Promise<void>;
}

export function createApp(config: AppConfig): App {
  const db = new CommerceDb(config.dbPath);
  const server = createServer((req, res) => {
    void createRouter({ config, db })(req, res);
  });

  return {
    server,
    db,
    close: async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
      db.close();
    },
  };
}
