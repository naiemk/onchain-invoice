# FastSwap Demo

This folder runs a local two-chain FastSwap demo:

- AliceChain Hardhat node on `127.0.0.1:9545`
- BobChain Hardhat node on `127.0.0.1:9546`
- Alice stable token: `DumUSDT`
- Bob stable token: `BobUSDC`
- FastSwap API on `127.0.0.1:4010`
- User UI on `127.0.0.1:4011`
- Admin UI on `127.0.0.1:4012`

Both Hardhat nodes use Hardhat's default chain ID. The demo uses mocked app chain IDs `101` and `202` in the quote/invoice data so we can test cross-chain semantics locally.

## Run

```bash
npm run fastswap:demo:build
npm run fastswap:demo
```

The demo compiles contracts, starts both Hardhat nodes, deploys dummy tokens plus the FastSwap receiver/sweeper systems on both chains, starts the API/UI/admin servers, and runs the sweep and relay loops.

The demo API requires captcha tokens for quote and invoice creation. Locally, the user UI pre-fills a fixed `demo-captcha` token through `demo-runtime.js`; production deployments should replace this with Cloudflare Turnstile or another verifier through `FastSwapServer`'s `verifyCaptcha` option.

## Try A Swap

1. Open `http://127.0.0.1:4011`.
2. Create a quote and invoice.
3. Pay the invoice from the demo account:

```bash
npm run fastswap:demo:pay -- <invoiceId>
```

The sweep node will sweep the funded deterministic invoice address on the source chain. The relay node will read `SwapRequested`, fetch the invoice data from the API, and call `relaySwap` on the target chain.

Open `http://127.0.0.1:4012` to watch deployed contracts and recent invoices.

## Manual Payments

You can also pay any address directly with the demo payment CLI:

```bash
fastSwapDemo/pay.sh <to_address> <amount> <token> --from <from> --network <aliceChain|bobChain>
fastSwapDemo/pay.sh --invoice <invoiceId> --from <from>
fastSwapDemo/pay.sh --list-addresses
```

Examples:

```bash
fastSwapDemo/pay.sh 0xInvoiceAddress 5 ETH --from alice --network aliceChain
fastSwapDemo/pay.sh 0xInvoiceAddress 5 DumUSDT --from deployer --network aliceChain
fastSwapDemo/pay.sh 0xInvoiceAddress 5 BobUSDC --from bob --network bobChain
fastSwapDemo/pay.sh --invoice 0xInvoiceId --from alice
```

Supported `--from` values are `deployer`, `alice`, `bob`, `account0`, `account1`, `account2`, the matching known Hardhat account address, or a raw private key. Native `ETH` is available on both local chains; `DumUSDT` is deployed on AliceChain and `BobUSDC` is deployed on BobChain.
