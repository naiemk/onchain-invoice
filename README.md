# onchain-invoice

A system for decentralized on-chain invoicing with deterministic payment addresses.

## Architecture

Each invoice maps to a deterministic ERC-1167 forwarder proxy address. The invoice ID is `keccak256(data)`, where `data` is the execution payload revealed when the invoice is swept or manually executed. The address can receive ETH or ERC20 tokens before the proxy is deployed. When the payment is ready, `InvoiceSweeper` deploys the proxy with `CREATE2` if needed and asks it to forward the full ETH or token balance to the receiver with the invoice ID and execution data. The receiver records the actual swept token, amount, and forwarder against the invoice ID.

Contracts:

- `Forwarder`: implementation used by all invoice proxies. It sweeps ETH or ERC20 balances to the receiver.
- OpenZeppelin `Clones`: minimal proxy deployment/prediction.
- `InvoiceSweeper`: predicts invoice addresses, deploys proxies, sweeps single invoices, and bulk executes sweeps.
- `Receiver`: OpenZeppelin UUPS upgradeable base receiver with initializer, ownership, invoice data verification, and invoice execution hook.
- `ReceiverProxy`: ERC-1967 proxy used for receiver deployments.
- `BasicReceiver`: no-op receiver implementation.
- `SystemDeployer`: deploys a basic receiver and sweeper.

Tron equivalents live under `contracts/tron`:

- `TronForwarder`: sweeps TRX or TRC20 balances to the receiver.
- `TronInvoiceSweeper`: predicts and deploys Tron forwarder proxies, then sweeps invoices.
- `TronReceiver`: UUPS receiver variant with the same invoice ID and payment assignment semantics.
- `TronSystemDeployer`: deploys the Tron receiver proxy and sweeper.

Tron uses a different `CREATE2` prediction prefix (`0x41`), so the Tron sweeper uses `TronClones` instead of OpenZeppelin `Clones`.

## SDK

```ts
import { JsonRpcProvider, Wallet, toUtf8Bytes } from "ethers";
import { OnchainInvoiceSdk, getInvoiceId } from "onchain-invoice";

const provider = new JsonRpcProvider(process.env.RPC_URL);
const signer = new Wallet(process.env.PRIVATE_KEY!, provider);

const sdk = new OnchainInvoiceSdk({
  provider,
  signer,
  sweeperAddress: "0x...",
});

const encodedInvoiceParams = toUtf8Bytes("invoice-123");
const invoiceAddress = await sdk.getNewInvoiceAddress(encodedInvoiceParams);

await sdk.sweepInvoice(invoiceAddress, {
  encodedInvoiceParams,
  amount: 1_000_000_000_000_000n,
});
```

For ERC20 invoices, pass `token` to `sweepInvoice`.

To create a forwarder before revealing invoice data, use the invoice ID directly:

```ts
const invoiceId = getInvoiceId(encodedInvoiceParams);
await sdk.createInvoiceForId(invoiceId);
```

The receiver rejects execution unless `invoiceId == keccak256(data)`. On sweep, it assigns the actual swept `token`, `amount`, and `forwarder` to that invoice ID.

## Tron SDK

```ts
import { TronWeb } from "tronweb";
import { hexlify, toUtf8Bytes } from "ethers";
import { TronInvoiceSdk } from "onchain-invoice";

const tronWeb = new TronWeb({
  fullHost: "https://api.trongrid.io",
  privateKey: process.env.TRON_PRIVATE_KEY,
});

const sdk = new TronInvoiceSdk({
  tronWeb,
  sweeperAddress: "T...",
});

const data = toUtf8Bytes("invoice-123");
const invoiceAddress = await sdk.getNewInvoiceAddress(data);

await sdk.sweepInvoice(invoiceAddress, {
  encodedInvoiceParams: data,
  amount: 1_000_000n, // sun for TRX
});
```

For TRC20 invoices, pass the TRC20 contract address as `token`. Tron native balances are denominated in sun.

```ts
import { monitorTronPayment } from "onchain-invoice";

monitorTronPayment(
  tronWeb,
  invoiceAddress,
  [{ minBalance: 1_000_000n }],
  async (hits) => {
    console.log("Tron invoices ready", hits);
  }
);
```

## Monitoring

```ts
import { monitorPayment } from "onchain-invoice";

const monitor = monitorPayment(
  provider,
  invoiceAddress,
  [{ minBalance: 1_000_000_000_000_000n }],
  async (hits) => {
    for (const hit of hits) {
      // Call sdk.sweepInvoice(...) after re-checking expected invoice metadata.
      console.log("ready", hit.address);
    }
  }
);

monitor.addAddress(otherInvoiceAddress, [
  { token: "0xTokenAddress", minBalance: 10_000_000n },
]);
```

The monitor removes addresses after they satisfy all configured balance requirements and aggregates every hit from the same polling cycle into one callback.

## Optional Web Server

Use `InvoiceWebServer` when a UI needs sessions, invoice UX history, captcha checks, and a simple API without operating an external database. Storage is SQLite-backed; the invoice link/data can still be treated as the portable source of truth.

```ts
import { JsonRpcProvider } from "ethers";
import {
  InvoiceWebClient,
  InvoiceWebServer,
  OnchainInvoiceSdk,
  createCloudflareTurnstileVerifier,
  getInvoiceId,
} from "onchain-invoice";

const invoiceSdk = new OnchainInvoiceSdk({
  provider: new JsonRpcProvider(process.env.RPC_URL),
  sweeperAddress: process.env.SWEEPER!,
});

const server = new InvoiceWebServer({
  jwtSecret: process.env.JWT_SECRET!,
  sqlitePath: "./invoices.sqlite",
  nodeApiKey: process.env.NODE_API_KEY,
  corsOrigin: "https://your-ui.example",
  requireCaptchaForSession: true,
  verifyCaptcha: createCloudflareTurnstileVerifier(process.env.TURNSTILE_SECRET!),
  async calculateInvoice(input) {
    const data = new TextEncoder().encode(JSON.stringify(input));
    const invoiceAddress = await invoiceSdk.getNewInvoiceAddress(data);
    return {
      invoiceId: getInvoiceId(data),
      invoiceAddress,
      chain: "base",
      data: Buffer.from(data).toString("hex"),
    };
  },
});

await server.run("0.0.0.0", 8787);
```

Browser or Node clients can use the typed web client:

```ts
const client = new InvoiceWebClient({
  baseUrl: "https://invoices.example",
});

await client.createSession({ captchaToken });
const invoice = await client.registerInvoice({
  orderId: "ord_123",
  amount: "1000000000000000",
});

const mine = await client.myInvoices();
const fetched = await client.fetchInvoice(invoice.id);
```

Node monitoring workers can list recent invoices with an API key:

```ts
const nodeClient = new InvoiceWebClient({
  baseUrl: "https://invoices.example",
  nodeApiKey: process.env.NODE_API_KEY,
});

const { invoices } = await nodeClient.listInvoices({ lookbackMs: 60_000, limit: 500 });
```

Endpoints:

- `POST /sessions`: create a UI JWT session.
- `POST /invoices`: register an invoice through the app-provided async calculation callback.
- `GET /me/invoices`: list the current session's LRU invoices.
- `GET /invoices/:id`: fetch and touch one invoice.
- `GET /invoices`: list recent invoices for node workers.

## Sweep Node

The `node/` folder contains an optional sweep worker application. It is not part of the library export surface. It uses the library SDKs, a local SQLite cache, and the web-server invoice list.

Responsibilities:

- Poll the web server for invoices and cache them locally.
- Scan receiver `InvoicePaid` logs on every configured chain.
- Skip invoices already paid according to receiver logs.
- Check invoice-address balances for unpaid invoices.
- Sweep funded invoices.
- Persist chain scan progress, invoices, paid invoices, and sweep attempts in SQLite.

Create a config from `node/example.config.json`:

```json
{
  "webServer": {
    "baseUrl": "https://invoices.example",
    "nodeApiKey": "replace-me",
    "pageLimit": 500,
    "lookbackMs": 86400000
  },
  "cache": {
    "sqlitePath": "./sweep-node.sqlite"
  },
  "pollIntervalMs": 30000,
  "chains": [
    {
      "type": "evm",
      "id": "base",
      "rpcUrl": "https://mainnet.base.org",
      "privateKey": "0x...",
      "sweeperAddress": "0x...",
      "receiverAddress": "0x...",
      "startBlock": 0
    },
    {
      "type": "tron",
      "id": "tron",
      "fullHost": "https://api.trongrid.io",
      "privateKey": "...",
      "sweeperAddress": "T...",
      "receiverAddress": "T...",
      "startTimestamp": 0
    }
  ]
}
```

Build and run:

```bash
npm run sweep-node:build
npm run sweep-node -- node/example.config.json
```

The node expects invoice records returned by the web server to contain:

- `chainId` or `chain`
- `invoiceId`
- `invoiceAddress` or `address`
- `data` or `encodedInvoiceParams`
- optional `token`
- optional exact `amount`
- optional `minAmount`

## FastSwap App

`app/fastswap` is a self-contained swap app built on the invoice system without changing the library export surface. FastSwap and the invoice receiver are the same contract: `FastSwapReceiver` extends `Receiver`, validates swept payments against ABI-encoded quote data, emits source-chain swap requests, and lets relayers process or queue target-chain payouts based on available liquidity.

The app includes a three-source quote backend with SQLite persistence, a no-login static checkout UI, relay/liquidity/admin node helpers, and local E2E tests for quote creation, invoice payment, sweep, relay, queueing, and payout.

**Production launch**: see [`docs/PROD_LAUNCH.md`](docs/PROD_LAUNCH.md). Config lives in `FastSwapConfig.yaml`; API and nodes run via Docker (`npm run docker:build`, `docker:up:api`, `docker:up:nodes`). The UI deploys to Vercel from `app/fastswap/ui`.

```bash
npm run fastswap:build
npm test
```

The local two-chain demo in `fastSwapDemo` is for development only — it starts AliceChain and BobChain Hardhat nodes, deploys `DumUSDT`, `BobUSDC`, FastSwap receivers/sweepers on both chains, and runs the API, user UI, admin UI, sweep node, and relay node:

```bash
npm run fastswap:demo:build
npm run fastswap:demo
```

The demo enforces captcha on quote and invoice creation with a fixed local demo token. Production FastSwap servers should configure `verifyCaptcha` with Cloudflare Turnstile or another provider.

Chains, fees, RPCs, price sources, and node settings are configured centrally in `fastSwapDemo/config.yaml`. Each chain declares a `type` (`evm` or `tron`) and supports any number of source/target chains (Sepolia, Base Sepolia, BSC Testnet, and TRON Nile are pre-wired with env placeholders).

### TRON as a full FastSwap chain

TRON participates as both a source and target chain for TRX (gas) and USDT (TRC20):

- `contracts/tron/fastswap/TronFastSwapReceiver.sol` mirrors `FastSwapReceiver` on TVM (low-level TRC20 transfers, TRX native, relay/queue/liquidity/aggregate flows). Deploy it with `contracts/tron/fastswap/TronFastSwapDeployer.sol` or the TronWeb helper `fastSwapDemo/deploy-tron-fastswap.ts`.
- Intent encoding is chain-type-aware: TRON base58 (`T...`) addresses are encoded as their 20-byte hex body so `invoiceId = keccak256(data)` is identical across source derivation, sweep, and target `relaySwap`.
- The server, relay node, liquidity monitor, and sweep node all branch by chain type (ethers for EVM, TronWeb for TRON). TRON is wired as an external testnet (Nile) via env vars; there is no local TRON node in the demo.

Configure the external TRON chain with these env vars (see `fastSwapDemo/config.yaml`): `NILE_FULL_HOST`, `TRON_SWEEPER_ADDRESS`, `TRON_FASTSWAP_ADDRESS`, `TRON_USDT_ADDRESS`, and `TRON_PRIVATE_KEY` for deploys.

For manual demo payments, use:

```bash
fastSwapDemo/pay.sh <to_address> <amount> <token> --from <from> --network <aliceChain|bobChain>
fastSwapDemo/pay.sh --invoice <invoiceId> --from <from>
fastSwapDemo/pay.sh --list-addresses
```

## Custom Receivers

Extend `Receiver` and override `_executeInvoice` for business logic. Deploy receivers behind `ReceiverProxy`, not as direct implementations.

```solidity
contract MyReceiver is Receiver {
    function _executeInvoice(
        bytes32 invoiceId,
        address token,
        uint256 amount,
        bytes calldata data
    ) internal override returns (bytes memory) {
        // Decode optional business data and act on the invoice.
        return "";
    }
}
```

Keep validation off-chain unless it protects an invariant that must be enforced on-chain.

Use OpenZeppelin's upgradeable storage style for custom receiver state. Prefer ERC-7201 namespaced storage structs instead of direct state variables in upgradeable receivers.

## Development

```bash
npm install
npm run compile
npm test
npm run build
```
