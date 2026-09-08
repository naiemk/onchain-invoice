/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string;
  /** Force create-form network list: "testnet" | "mainnet". Default: hostname heuristic. */
  readonly VITE_DEPLOYMENT_MODE?: "testnet" | "mainnet";
  /** Playwright local-stack only — never set in production `ui:build`. */
  readonly VITE_E2E_WEBAUTHN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
