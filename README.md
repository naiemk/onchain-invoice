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

## Commerce (trustless merchant payout)

For products that pay merchants directly (Trustless Commerce under `commerce/` + `ui/`), use the commerce contracts under `contracts/commerce/`:

- `CommerceForwarder`: invoice proxy; only the sweeper may move funds.
- `CommerceInvoiceSweeper`: CREATE2 salt = `keccak256(abi.encodePacked(to, invoiceId))`. `sweep(token, amount, to, invoiceId)` sends `amount - fee` to `to` and the fee to the platform. A wrong `to` targets a different empty address, so the sweeper cannot redirect funds.
- Fee = `max(amount * feeBps / 10000, minFeeByToken[token])` (default 0.5%).
- Supports partial sweeps and `bulkSweep`.

```ts
import { CommerceInvoiceSdk, getCommerceInvoiceId } from "onchain-invoice";

const sdk = new CommerceInvoiceSdk({ provider, signer, sweeperAddress });
const invoiceId = getCommerceInvoiceId({
  priceUsd: "10",
  toAddresses: [merchant],
  clientInvoiceId: "order-1",
});
const invoiceAddress = await sdk.getInvoiceAddress(merchant, invoiceId);
await sdk.sweep({ token: usdc, amount, to: merchant, invoiceId });
```

Deploy locally: `npx hardhat run scripts/deploy-commerce.ts`

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

The `node/` folder contains the generic invoice sweep worker. Product apps (for example FastSwap) adapt their config into `SweepNodeConfig` and may supply `parseInvoice` / `resolveTrackStatus` hooks.

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
npm run build
npm run sweep-node -- node/example.config.json
```

Import the worker from another package:

```ts
import { SweepNode, type SweepNodeConfig } from "onchain-invoice/sweep-node";
```

The node expects invoice records returned by the web server to contain:

- `chainId` or `chain`
- `invoiceId`
- `invoiceAddress` or `address`
- `data` or `encodedInvoiceParams`
- optional `token`
- optional exact `amount`
- optional `minAmount`

## FastSwap product

The FastSwap cross-chain swap product lives in the sibling repo [`naiemk/fastswap`](https://github.com/naiemk/fastswap). It depends on this package (`file:../onchain-invoice` in local checkouts) for the SDK, `InvoiceWebServer` helpers, SweepNode, and base `Receiver` contracts.

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

Trustless Commerce (API + UI):

```bash
npm run commerce:server   # API on :8080 (see commerce/.env.example)
npm run commerce:sweeper  # after configuring commerce/config/sweeper.example.yaml
npm run ui                # http://localhost:5173 — proxies /api to :8080
npm run ui:build          # → dist-ui/
npm run docker:test       # local HTTPS compose smoke (ports 18080/18443)
npm run system-test       # pull published GHCR images + configs (system-tests/)
```

UI lives under [`ui/`](ui/); API/sweeper under [`commerce/`](commerce/); Docker under [`deploy/`](deploy/); published-image system tests under [`system-tests/`](system-tests/).
