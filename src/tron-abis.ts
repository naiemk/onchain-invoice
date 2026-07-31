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
  {
    type: "function",
    name: "transfer",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;
