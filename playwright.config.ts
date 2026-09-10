/**
 * Playwright UI e2e against **local Hardhat** (`e2eLocal`, chainId 11155111).
 * Live testnet is opt-in: `npm run test:ui-e2e:testnet` (not used in CI).
 */
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
      command: `npx hardhat node --port ${HARDHAT_PORT} --network e2eLocal`,
      url: `http://127.0.0.1:${HARDHAT_PORT}`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: {
        ...process.env,
        EVM_PRIVATE_KEY: "",
        SWEEPER_PRIVATE_KEY: "",
      },
    },
    {
      command: "node ui/e2e/stack/boot.mjs",
      url: `http://127.0.0.1:${API_PORT}/api/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
      env: {
        ...process.env,
        PORT: API_PORT,
        E2E_API_PORT: API_PORT,
        E2E_HARDHAT_PORT: HARDHAT_PORT,
        HARDHAT_RPC_URL: `http://127.0.0.1:${HARDHAT_PORT}`,
        PERSIST_LOG_DIR: process.env.PERSIST_LOG_DIR ?? "/tmp/tc-e2e-persist-logs",
        TURNSTILE_SECRET: "",
        TURNSTILE_SITE_KEY: "",
        EVM_PRIVATE_KEY: "",
        SWEEPER_PRIVATE_KEY: "",
        E2E_BUNDLER_TICK_PORT: process.env.E2E_BUNDLER_TICK_PORT ?? "18741",
        E2E_SWEEPER_TICK_PORT: process.env.E2E_SWEEPER_TICK_PORT ?? "18742",
        E2E_DEPLOYER_TICK_PORT: process.env.E2E_DEPLOYER_TICK_PORT ?? "18743",
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
        VITE_E2E_WEBAUTHN: "1",
      },
    },
  ],
});
