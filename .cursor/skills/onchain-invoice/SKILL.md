---
name: onchain-invoice
description: Build and use the on-chain invoice system, including forwarder proxies, invoice sweeping, receiver contracts, the TypeScript SDK, and background payment monitoring. Use when implementing contracts, creating invoice addresses, sweeping ETH or ERC20 payments, writing receiver subclasses, or integrating the SDK/service helper.
---

# On-Chain Invoice

## System Model

This project creates deterministic invoice payment addresses. Each invoice address is a minimal forwarder proxy. The invoice ID is `keccak256(data)`, where `data` is the execution payload revealed during sweep or manual execution. When ETH or ERC20 tokens arrive, a sweeper executes the invoice by forwarding funds to a central upgradeable receiver with the invoice ID, token, amount, and data. The receiver records the swept token, amount, and forwarder against the invoice ID.

Core contracts:

- `Forwarder`: implementation contract that forwards received ETH or ERC20 balances to the hardcoded receiver target with the invoice ID.
- OpenZeppelin `Clones`: minimal proxy clone pointing at the `Forwarder` implementation.
- `InvoiceSweeper`: deploys forwarder proxies and calls sweep methods with the invoice ID and optional `executeInvoice` data.
- `Receiver`: OpenZeppelin UUPS upgradeable base contract that receives ETH/ERC20 payments and invoice metadata, then executes invoice-specific behavior. Child contracts may override invoice handling.
- `ReceiverProxy`: ERC-1967 proxy used for receiver deployments.

## Contract Implementation Rules

- Optimize execution gas first, even when it increases deployment bytecode size.
- Use latest OpenZeppelin contracts where they fit the need, especially clones, ERC20 safety helpers, and upgradeable base utilities.
- Push validation, balance checks, token selection, and batching decisions off-chain when they do not need on-chain enforcement.
- Receivers must verify `invoiceId == keccak256(data)` before executing invoice logic.
- Receivers must assign the actual swept token, amount, and forwarder to the invoice ID before executing invoice logic.
- Receiver implementations must disable initializers and be deployed behind an ERC-1967 proxy.
- Custom receiver storage must use OpenZeppelin upgradeable storage conventions, preferably ERC-7201 namespaced storage structs.
- Keep sweep paths short: avoid storage reads, dynamic allocations, repeated external calls, and rich revert strings in hot execution paths.
- Treat native ETH and ERC20 sweeps as separate optimized paths unless a shared helper is demonstrably cheaper.
- Prefer immutable or hardcoded addresses for forwarder configuration where the architecture allows it.
- Receiver contracts should emit enough events for indexing invoice ID, token, payer/forwarder, amount, and execution outcome.
- Receiver child contracts should override invoice action hooks, not fund accounting or low-level receive logic, unless the change is intentional and tested.
- Bulk execution should aggregate off-chain first, then submit the smallest calldata shape that preserves invoice correctness.

## SDK Workflow

Use the TypeScript SDK for invoice lifecycle operations:

```ts
const invoiceAddress = await sdk.getNewInvoiceAddress(encodedInvoiceParams);
await sdk.sweepInvoice(invoiceAddress, params);
```

When implementing SDK features:

- `getNewInvoiceAddress(encodedInvoiceParams)` should derive or deploy the invoice forwarder address for the encoded invoice parameters.
- `sweepInvoice(invoiceAddress, params)` should perform off-chain checks before submitting the transaction: deployed code, expected receiver, ETH/token balance, minimum amount, invoice ID, allowance-free ERC20 transfer path, and chain ID.
- Keep SDK errors actionable and typed where practical.
- Encode invoice params deterministically. The same params on the same chain must produce the same expected invoice address.
- Support creating an invoice from a known `invoiceId` without revealing `data`; require matching data before sweep or manual execution.
- Expose dry-run or simulation helpers when useful, but keep gas-saving assumptions explicit.

## Monitoring Workflow

Use the service helper to watch invoice addresses until enough ETH or ERC20 balance has arrived:

```ts
monitorPayment(address, [{ token, minBalance }], callback);
```

When implementing monitoring:

- Support adding more addresses after the monitor starts.
- Remove an address once its required balance condition is satisfied.
- Aggregate callbacks for multiple invoices that become sweepable in the same polling or subscription cycle.
- Prefer provider subscriptions when reliable; fall back to polling with configurable interval and confirmations.
- Never rely on monitoring as the source of truth. Re-check balances in `sweepInvoice` before sending transactions.

## Receiver Implementation Workflow

When creating a custom receiver:

1. Extend the upgradeable base `Receiver`.
2. Add custom state through ERC-7201 namespaced storage structs, not direct state variables.
3. Keep the base receive/sweep entrypoints intact.
4. Override the invoice action hook for project-specific behavior.
5. Validate only the invariants that must be enforced on-chain.
6. Add tests for ETH, ERC20, failed invoice action, upgrades, and bulk execution paths.

Receiver actions may decode optional `bytes data` passed to `executeInvoice`. Keep decoding isolated to the child receiver when the data format is business-specific.

## Test Expectations

Prioritize tests that protect fund movement:

- Deterministic invoice address derivation.
- ETH sweep to receiver with invoice ID and amount.
- ERC20 sweep to receiver with invoice ID, token, and amount.
- Receiver child hook execution and revert behavior.
- Bulk sweep behavior and event emission.
- SDK off-chain checks preventing avoidable failed transactions.
- Monitor callback aggregation and address removal after payment detection.
