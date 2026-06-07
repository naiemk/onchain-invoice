export const TRON_NATIVE_TOKEN = "T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb";

export const TRON_INVOICE_SWEEPER_ABI = [
  {
    type: "function",
    name: "getInvoiceAddress",
    stateMutability: "view",
    inputs: [{ name: "invoiceId", type: "bytes32" }],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "createInvoice",
    stateMutability: "nonpayable",
    inputs: [{ name: "invoiceId", type: "bytes32" }],
    outputs: [{ name: "forwarder", type: "address" }],
  },
  {
    type: "function",
    name: "sweepTrx",
    stateMutability: "nonpayable",
    inputs: [
      { name: "invoiceId", type: "bytes32" },
      { name: "data", type: "bytes" },
    ],
    outputs: [
      { name: "forwarder", type: "address" },
      { name: "amount", type: "uint256" },
    ],
  },
  {
    type: "function",
    name: "sweepToken",
    stateMutability: "nonpayable",
    inputs: [
      { name: "invoiceId", type: "bytes32" },
      { name: "token", type: "address" },
      { name: "data", type: "bytes" },
    ],
    outputs: [
      { name: "forwarder", type: "address" },
      { name: "amount", type: "uint256" },
    ],
  },
] as const;

export const TRC20_ABI = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

/** Minimal ABI for the on-chain TronFastSwapReceiver used by the relay, liquidity monitor, and tooling. */
export const TRON_FASTSWAP_RECEIVER_ABI = [
  {
    type: "function",
    name: "relaySwap",
    stateMutability: "nonpayable",
    inputs: [{ name: "data", type: "bytes" }],
    outputs: [],
  },
  {
    type: "function",
    name: "processQueued",
    stateMutability: "nonpayable",
    inputs: [{ name: "swapId", type: "bytes32" }],
    outputs: [],
  },
  {
    type: "function",
    name: "addLiquidity",
    stateMutability: "payable",
    inputs: [
      { name: "token", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "adminSweep",
    stateMutability: "nonpayable",
    inputs: [
      { name: "token", type: "address" },
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "invoicePayment",
    stateMutability: "view",
    inputs: [{ name: "invoiceId", type: "bytes32" }],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "token", type: "address" },
          { name: "amount", type: "uint256" },
          { name: "forwarder", type: "address" },
          { name: "paid", type: "bool" },
        ],
      },
    ],
  },
  {
    type: "function",
    name: "liquidityFloor",
    stateMutability: "view",
    inputs: [{ name: "token", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "swapState",
    stateMutability: "view",
    inputs: [{ name: "swapId", type: "bytes32" }],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          {
            name: "intent",
            type: "tuple",
            components: [
              { name: "version", type: "uint8" },
              { name: "quoteId", type: "bytes32" },
              { name: "sourceChainId", type: "uint256" },
              { name: "sourceToken", type: "address" },
              { name: "sourceAmount", type: "uint256" },
              { name: "targetChainId", type: "uint256" },
              { name: "targetToken", type: "address" },
              { name: "targetAmount", type: "uint256" },
              { name: "recipient", type: "address" },
              { name: "expiresAt", type: "uint64" },
              { name: "refundAddress", type: "address" },
            ],
          },
          { name: "requested", type: "bool" },
          { name: "relayed", type: "bool" },
          { name: "processed", type: "bool" },
          { name: "queued", type: "bool" },
          { name: "paidToken", type: "address" },
          { name: "paidAmount", type: "uint256" },
        ],
      },
    ],
  },
] as const;
