import { defineConfig } from "@playwright/test";

const API_PORT = process.env.E2E_API_PORT ?? "8080";
const UI_PORT = process.env.E2E_UI_PORT ?? "5173";
const HARDHAT_PORT = process.env.E2E_HARDHAT_PORT ?? "8545";
const UI_HOST = process.env.E2E_UI_HOST ?? "localhost";

export default defineConfig({
  testDir: "ui/e2e",
  timeout: 120_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  use: {
    baseURL: process.env.UI_BASE ?? `http://${UI_HOST}:${UI_PORT}`,
    trace: "on-first-retry",
  },
  webServer: [
    {
      command: `npx hardhat node --port ${HARDHAT_PORT}`,
      url: `http://127.0.0.1:${HARDHAT_PORT}`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      command: "node commerce-dist/server/index.js",
      url: `http://127.0.0.1:${API_PORT}/api/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: {
        ...process.env,
        PORT: API_PORT,
        DB_PATH: "/tmp/tc-super-wallet-e2e.db",
        WALLET_RPC_URL: `http://127.0.0.1:${HARDHAT_PORT}`,
        EVM_RPC_URL: `http://127.0.0.1:${HARDHAT_PORT}`,
        SWEEPER_ADDRESS: process.env.SWEEPER_ADDRESS ?? "0x0000000000000000000000000000000000000001",
        FORWARDER_IMPLEMENTATION:
          process.env.FORWARDER_IMPLEMENTATION ?? "0x0000000000000000000000000000000000000002",
      },
    },
    {
      command: `vite --config ui/vite.config.ts --host ${UI_HOST} --port ${UI_PORT} --strictPort`,
      url: `http://${UI_HOST}:${UI_PORT}/`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: {
        ...process.env,
        VITE_DEV_PROXY_TARGET: `http://127.0.0.1:${API_PORT}`,
      },
    },
  ],
});
