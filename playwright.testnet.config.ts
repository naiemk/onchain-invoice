/**
 * Opt-in live testnet e2e. CI does **not** use this file.
 *
 *   E2E_TESTNET=1 E2E_RPC_URL=… E2E_USDC=… E2E_COLLECTOR_ADDRESS=… E2E_FUNDER_KEY=… \
 *     npm run test:ui-e2e:testnet
 *
 * Starts local Vite with the WebAuthn test shim, proxied at the live API.
 * Bundler/sweeper/deployer are the hosted nodes (they poll; no POST /tick).
 */
import { defineConfig } from "@playwright/test";

const UI_PORT = process.env.E2E_UI_PORT ?? "5173";
const UI_HOST = process.env.E2E_UI_HOST ?? "localhost";
const API = (process.env.E2E_API_URL ?? "https://testnet.trustless-commerce.com").replace(/\/$/, "");

export default defineConfig({
  testDir: "ui/e2e",
  testMatch: "local-stack.spec.ts",
  timeout: 180_000,
  expect: { timeout: 60_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  use: {
    baseURL: process.env.UI_BASE ?? `http://${UI_HOST}:${UI_PORT}`,
    trace: "on-first-retry",
  },
  webServer: {
    command: `vite --config ui/vite.config.ts --host ${UI_HOST} --port ${UI_PORT} --strictPort`,
    url: `http://${UI_HOST}:${UI_PORT}/`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      ...process.env,
      VITE_DEV_PROXY_TARGET: API,
      VITE_E2E_WEBAUTHN: "1",
    },
  },
});
