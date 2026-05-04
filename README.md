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
