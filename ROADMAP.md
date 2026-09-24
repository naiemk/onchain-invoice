# Trustless Commerce roadmap

Status today: **Ethereum Sepolia** end-to-end (contracts, API, sweeper, UI, HTTPS gateway). **Tron Nile** and **Solana Devnet** commerce paths are implemented (unified triple sweeper compose via wget install). Base is UI labels only; mainnet contracts are not deployed.

```mermaid
flowchart LR
  m1[M1_Testnets] --> m2[M2_Mainnet_chains]
  m2 --> m3[M3_Mainnet_ops]
  m3 --> m4[M4_Docs_agents]
  m4 --> m5[M5_Security_audit]
  m3 --> mw[M_wallet_simple_GA]
```

Hosted **simple wallet** (IdentityWallet + IdentityStore, Base) has its own certification program: [`docs/wallet-mainnet-assurance.md`](docs/wallet-mainnet-assurance.md). That path is not gated on M5 (commerce/sweeper audit). Super Wallet remains beta until a later program.

---

## M1 — Base, Tron, and Solana (testnet)

Goal: create → pay → sweep works on each chain’s public testnet, behind `testnet.trustless-commerce.com`.

### Base Sepolia (`84532`)
- [ ] Hardhat network + `scripts/deploy-commerce.ts` deploy artifact (`data/commerce-deploy-base-sepolia.json`)
- [ ] API multi-chain config (per-`chainId` sweeper + forwarder; not a single global pair)
- [ ] Sweeper YAML: Base Sepolia RPC, USDC, wallet registration
- [ ] UI: add Base Sepolia to networks; keep create/pay paths honest (no fake mainnet Base)
- [ ] System-test or smoke script for Base Sepolia USDC

### Tron (Nile)
- [x] Commerce address / invoice model (library EOA: `deriveTronInvoiceAddress` + sponsor sweep)
- [x] API create + sweeper claim/track for Tron invoices (`string[]` merchant ids; chain id `nile`)
- [x] Replace `tron.enabled` stub skip in [`commerce/sweeper/worker.ts`](commerce/sweeper/worker.ts) with a real tick path
- [x] UI network + pay instructions (Nile TRC-20 USDT; Sepolia USDC)
- [x] Activity-log stages for Tron pay/sweep (+ triple compose `sweeper-evm` / `sweeper-tron` / `sweeper-solana`)
- [ ] Live Nile smoke: fund test USDT → paid → swept (operator checklist)
### Solana (devnet)
- [x] Greenfield: program PDA scheme for invoice addresses + settle/sweep authority
- [x] TypeScript SDK helpers + API persistence
- [x] Sweeper worker path (replace `solana.enabled` stub)
- [x] UI network + pay instructions
- [x] Success tests: pay → settle → balances + anti-redirect (`npm run solana:test`)
- [x] Unified wget nodes install (evm + tron + solana compose) + Devnet deploy/smoke scripts
- [ ] Operator live Circle-USDC faucet checklist (optional; smoke uses throwaway mint)

**Exit:** agent or merchant can create a testnet invoice on Base, Tron, and Solana; sweeper settles; activity log shows paid + sweep tx.

---

## M2 — Mainnet support for all

Goal: same product surface on production chains; configs and UI gated to **live** deployments only.

| Chain | Target | Notes |
|-------|--------|--------|
| Ethereum | Mainnet | Optional if Base is primary EVM; keep if merchants need it |
| Base | Mainnet `8453` | Primary EVM candidate (fees) |
| Tron | Mainnet | Production TRC-20 |
| Solana | Mainnet | Production SPL |

- [ ] Deploy commerce contracts / programs; commit artifacts under `data/commerce-deploy-*.json`
- [ ] Token allowlists (USDC addresses per chain) locked in API + sweeper config
- [ ] UI `NETWORKS` only lists chains with live artifacts + RPC
- [ ] Per-environment secrets: separate sweeper wallets, admin keys, DBs (testnet vs mainnet already split by gateway)

**Exit:** create/pay/sweep verified on each mainnet with small real amounts (or shadowed dry-run where required).

---

## M3 — Mainnet deploy (ops)

Goal: `https://trustless-commerce.com` is a full production stack (not just DNS + empty API).

- [ ] Fill [`deploy/.env.mainnet.example`](deploy/.env.mainnet.example) / live `.env` with mainnet addresses + RPC
- [ ] Start `mainnet-api` on `trustless-commerce-edge`; confirm gateway upstreams
- [ ] Register production sweeper(s); `AUTO_UPDATE=0` on mainnet nodes
- [ ] Activity logs + monitoring (disk, RPC errors, failed sweeps)
- [ ] Backup/restore for mainnet SQLite (or migrate off SQLite if volume requires it)
- [ ] Checklist pass in [`deploy/README.md`](deploy/README.md)

**Exit:** public mainnet health, create invoice, pay, sweep, and merchant payout observed in prod.

---

## M4 — Docs upgrade with agent targeting

Goal: humans and coding agents can integrate without reading the whole repo.

- [ ] Chain matrix in [`docs/index.md`](docs/index.md) / [`docs/agents.md`](docs/agents.md): chainId, USDC, RPC expectations, pay-link examples
- [ ] Update [`.cursor/skills/trustless-commerce-invoice/SKILL.md`](.cursor/skills/trustless-commerce-invoice/SKILL.md) beyond Sepolia-only
- [ ] API reference deltas for multi-chain create ([`docs/api.md`](docs/api.md), [`docs/create.md`](docs/create.md))
- [ ] Ops: mainnet vs testnet install paths ([`docs/ops.md`](docs/ops.md), [`deploy/install/README.md`](deploy/install/README.md))
- [ ] Explicit “not supported yet” removals once Tron/Solana ship
- [ ] Agent-oriented one-pagers: “create invoice”, “poll until paid”, “register sweeper”

**Exit:** a fresh agent can create and verify a testnet invoice from docs/skill alone; mainnet steps are clearly marked.

---

## M5 — Security audit

Goal: external review of frozen mainnet surface before (or immediately after) wider traffic.

**In scope (suggested)**
- Commerce sweeper + forwarder contracts / Solana program / Tron settle path
- API auth: admin key, sweeper wallet signatures, claim leases, track idempotency
- Invoice address derivation and payout binding (`selectedTo` / salt)
- Rate limits, CORS, captcha/merchant-key follow-ups in [`docs/security.md`](docs/security.md)
- Operator secrets handling (install `.env`, auto-update, activity logs)

**Prep**
- [ ] Freeze contract/program addresses and ABI surface for audit tag
- [ ] Expand [`docs/security.md`](docs/security.md) threat model + trust assumptions
- [ ] Fix P0/P1 findings; re-test M2/M3 paths
- [ ] Publish summary (scope, version, residual risks)

**Exit:** audit report filed; critical items closed; residual risks documented for merchants/agents.

---

## M-wallet — Simple wallet mainnet assurance

Goal: hosted simple wallets on Base are recoverable in every state and cannot lock or lose funds on the certified path. Super Wallet stays in product as **beta / not fully audited**.

Program of record: [`docs/wallet-mainnet-assurance.md`](docs/wallet-mainnet-assurance.md) (epics 0–5, state matrix, CI gates, live drills, Identity\* audit).

```mermaid
flowchart LR
  p0[P0_Spec] --> p1[P1_Invariants] --> p2[P2_CI] --> p3[P3_Drills] --> p4[P4_Audit] --> p5[P5_Simple_GA]
```

- [x] P0: publish assurance program + threat model
- [ ] P1: second-method-before-funds + last-method / `disableRestore` invariants + store-owner timelock
- [ ] P2: `wallet-cert` Hardhat + identity-email-restore required CI + ABI snapshots
- [ ] P3: Base live recovery drills + monitoring + persist-log backups
- [ ] P4: external audit of IdentityStore / IdentityWallet / factory (operator Super in-scope; user Super out)
- [ ] P5: simple wallet GA on `https://trustless-commerce.com`; Super beta banner remains

**Exit:** matrix cells and threat rows in the assurance doc have tests or named ops procedures; CI fails if path A (recovery) or path B (UserOp auth) regresses; audit P0/P1 closed.

---

## Explicitly later / out of band

- Arbitrum and other EVM L2s (UI labels exist; not a roadmap gate)
- Redis / multi-replica API
- Deposit-tx indexing (still balance-poll unless product requires it)
- Mainnet sweeper auto-update (remain off by default)
- User Super Wallet certification (after simple-wallet GA; see M-wallet)

---

## Tracking

Update checkboxes here as milestones land. Operator install and Sepolia testnet remain the reference environment until M3.
