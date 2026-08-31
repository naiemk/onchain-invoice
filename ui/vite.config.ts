import { defineConfig } from "vite";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  publicDir: fileURLToPath(new URL("./public", import.meta.url)),
  resolve: {
    alias: {
      // Browser-safe commerce helpers (avoids bundling Node SDK deps).
      "onchain-invoice": fileURLToPath(new URL("./src/onchain-invoice-browser.ts", import.meta.url)),
    },
  },
  build: {
    outDir: fileURLToPath(new URL("../dist-ui", import.meta.url)),
    emptyOutDir: true,
  },
  server: {
    host: "0.0.0.0",
    port: 5173,
    proxy: {
      "/api": process.env.VITE_DEV_PROXY_TARGET ?? "http://localhost:8080",
    },
  },
});
