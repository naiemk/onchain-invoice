import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  publicDir: fileURLToPath(new URL("./public", import.meta.url)),
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
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
