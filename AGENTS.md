# AGENTS.md

## Cursor Cloud specific instructions

This repo is the `onchain-invoice` payment-infrastructure library (Solidity contracts + TypeScript SDK + optional web server/client + sweep node). It is a single self-contained npm package — there is no database, message broker, or docker-compose dependency to start. Contract tests spin up Hardhat's in-process EVM network, and the web server uses embedded SQLite (`better-sqlite3`) plus Node's built-in `http`.

Standard commands live in `package.json` `scripts` (`compile`, `build`, `test`, `test:contracts`, `sweep-node`, `sweep-node:build`) and the README `## Development` section. Prefer those instead of ad-hoc invocations.

Non-obvious notes:
- Node 22 and dependencies are already installed by the startup update script (`npm install`). `better-sqlite3` is a native module; if it ever fails to load, run `npm rebuild better-sqlite3`.
- `npm test` runs both the Solidity/Tron contract tests and the `InvoiceWebServer` tests (all Hardhat/Mocha `.ts` files under `test/`). The web-server tests bind an ephemeral port and use in-memory/temp SQLite, so no service needs to be running first.
- Run one-off scripts (e.g. `scripts/deploy.ts`) with `npx hardhat run <path>`; they call `network.create()` to get an in-process EVM network, so no external RPC/node is required.
- There is no lint or formatter npm script. Prettier + the Hardhat Solidity extension are only configured as recommended VS Code extensions.
- `npm run sweep-node` (the `SweepNode` worker) is the only piece needing real config: a JSON config (see `node/example.config.json`) with live EVM/Tron RPC endpoints, keys, and a running web server. It is NOT exercised by the test suite and is optional for local development.
- FastSwap product code lives in a separate sibling repo (`naiemk/fastswap`), not here. Do not add FastSwap app code to this repo.
