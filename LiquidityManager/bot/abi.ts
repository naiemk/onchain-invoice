/** LiquidityManager ABIs. Ethers uses the human-readable form; TronWeb needs the JSON form. */

export const ACTION_TUPLE =
  "(uint8 kind,address receiver,address router,address tokenIn,address tokenOut,uint256 amount,uint256 minOut,bytes data)";

export const LIQUIDITY_MANAGER_ABI = [
  `function rebalance(${ACTION_TUPLE}[] actions)`,
  "function swap(address router,address tokenIn,uint256 amountIn,address tokenOut,uint256 minOut,bytes data) returns (uint256)",
  "function pullFromReceiver(address receiver,address token,uint256 amount)",
  "function pushToReceiver(address receiver,address token,uint256 amount)",
  "function reserveBalance(address token) view returns (uint256)",
  "function isRouterAllowed(address router) view returns (bool)",
];

export const ERC20_MIN_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function decimals() view returns (uint8)",
];

/** JSON ABI for TronWeb (`tronWeb.contract`) — only the methods the bot invokes. */
export const TRON_LIQUIDITY_MANAGER_ABI_JSON = [
  {
    inputs: [
      {
        components: [
          { name: "kind", type: "uint8" },
          { name: "receiver", type: "address" },
          { name: "router", type: "address" },
          { name: "tokenIn", type: "address" },
          { name: "tokenOut", type: "address" },
          { name: "amount", type: "uint256" },
          { name: "minOut", type: "uint256" },
          { name: "data", type: "bytes" },
        ],
        name: "actions",
        type: "tuple[]",
      },
    ],
    name: "rebalance",
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      { name: "receiver", type: "address" },
      { name: "token", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    name: "pullFromReceiver",
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      { name: "receiver", type: "address" },
      { name: "token", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    name: "pushToReceiver",
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [{ name: "token", type: "address" }],
    name: "reserveBalance",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
];

export const TRON_TRC20_ABI_JSON = [
  {
    inputs: [{ name: "account", type: "address" }],
    name: "balanceOf",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
];

/** Maps a PlannedAction kind to the on-chain ActionKind enum. */
export const ACTION_KIND = { pull: 0, swap: 1, push: 2 } as const;
