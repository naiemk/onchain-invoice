/** Minimal FastSwap receiver ABI surface used by the LiquidityManager bot (queue scan + settle). */

export const FASTSWAP_RECEIVER_ABI = [
  "function processQueued(bytes32 swapId)",
  "function liquidityFloor(address token) view returns (uint256)",
  "function queuedSwapCount() view returns (uint256)",
  "function queuedSwapIdAt(uint256 index) view returns (bytes32)",
  "function swapState(bytes32 swapId) view returns ((uint8 version,bytes32 quoteId,uint256 sourceChainId,address sourceToken,uint256 sourceAmount,uint256 targetChainId,address targetToken,uint256 targetAmount,address recipient,uint64 expiresAt,address refundAddress),bool requested,bool relayed,bool processed,bool queued,address paidToken,uint256 paidAmount)",
] as const;

/** TronWeb JSON ABI (same methods). */
export const TRON_FASTSWAP_RECEIVER_ABI_JSON = [
  {
    type: "function",
    name: "processQueued",
    stateMutability: "nonpayable",
    inputs: [{ name: "swapId", type: "bytes32" }],
    outputs: [],
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
    name: "queuedSwapCount",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "queuedSwapIdAt",
    stateMutability: "view",
    inputs: [{ name: "index", type: "uint256" }],
    outputs: [{ name: "", type: "bytes32" }],
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

/** TRON native token sentinel for `liquidityFloor` / `addLiquidity` calls. */
export const TRON_NATIVE_FLOOR = "T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb";
