import { defineConfig } from "vite";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  server: {
    host: "127.0.0.1",
    port: 5179,
    proxy: {
      "/api": "http://127.0.0.1:8790",
    },
  },
  build: {
    outDir: fileURLToPath(new URL("../dist-ui", import.meta.url)),
    emptyOutDir: true,
  },
});
