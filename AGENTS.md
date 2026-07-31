# AGENTS.md

## Cursor Cloud specific instructions

### Repos in this workspace

- `onchain-invoice` (this repo) is the real, runnable codebase: a Node.js 22 + Hardhat 3 + TypeScript monorepo for on-chain invoicing and the FastSwap cross-chain swap app. It uses `npm` (see `package-lock.json`).
- The sibling `fastswap` repo is an empty stub (only `README`/`LICENSE`); there is nothing to install, build, or run there.

Dependencies are refreshed automatically on startup via the update script (`npm install`). No external services, databases, or secrets are needed for local development or the full demo — persistence is file-based SQLite and the demo runs entirely on local Hardhat chains.

### Build / test / lint

- Standard commands are documented in `README.md` and `package.json` `scripts`. Key ones: `npm run compile` (Solidity, downloads solc 0.8.24 on first run), `npm run build` (library `tsc`), `npm test` (84 Hardhat/Mocha tests, all in-process — no separate chain needed).
- There is no `lint` script configured in this repo; do not expect `npm run lint` to exist.

### Running the FastSwap local demo (recommended end-to-end)

- Build then run: `npm run fastswap:demo:build` then `npm run fastswap:demo`. It is a long-running foreground process — start it in a background/tmux session, not a blocking shell call.
- The demo starts two local Hardhat chains (AliceChain `127.0.0.1:9545`, BobChain `127.0.0.1:9546`), deploys tokens + FastSwap contracts on both, and serves: API `http://127.0.0.1:4010` (`GET /health`), user UI `http://127.0.0.1:4011`, admin UI `http://127.0.0.1:4012`. It also runs the sweep and relay loops in-process.
- Demo state (SQLite, deployment info) lives in `fastSwapDemo/state/` and is gitignored. To reset cleanly, run `fastSwapDemo/nuke.sh` (kills demo ports, wipes state, rebuilds, restarts). Note `nuke.sh` uses `lsof`/`pkill -f "demo-dist/..."`; only run it when you intend to tear the demo down.

### Exercising a swap (hello-world)

- Easiest: open `http://127.0.0.1:4011`, create a quote + invoice (captcha is auto-filled with the fixed `demo-captcha` token), then pay it with `npm run fastswap:demo:pay -- <invoiceId>`. The sweep node sweeps the source-chain payment and the relay node completes the payout on the target chain; UI/admin update to `complete`.
- Non-obvious API gotcha: `POST /quotes` accepts token symbols, but `POST /invoices` requires token **addresses** (the invoice encoder rejects symbols with `invalid address`). Use the addresses from `GET /config`. Node-authenticated endpoints (`GET /invoices`, etc.) use the `x-api-key` header with the raw `nodeApiKey` from `fastSwapDemo/config.yaml` (`fastswap-demo-node` in the demo).
- Demo funding accounts and token symbols per chain are described in `fastSwapDemo/README.md` (`DumUSDT` on AliceChain, `BobUSDC` on BobChain).
