import { Contract, JsonRpcProvider, Wallet } from "ethers";
import { TronWeb } from "tronweb";
import { ACTION_KIND, LIQUIDITY_MANAGER_ABI, TRON_LIQUIDITY_MANAGER_ABI_JSON } from "./abi.js";
import { FASTSWAP_RECEIVER_ABI, TRON_FASTSWAP_RECEIVER_ABI_JSON } from "./fastswap.js";
import { type RouteProvider } from "./price.js";
import { NATIVE_TOKEN, type ChainConfig, type PlannedAction } from "../shared/types.js";

const TRON_ZERO = "T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb"; // base58 of the TRON zero address (native)

interface ActionTuple {
  kind: number;
  receiver: string;
  router: string;
  tokenIn: string;
  tokenOut: string;
  amount: bigint;
  minOut: bigint;
  data: string;
}

export interface ExecuteResult {
  tuples: ActionTuple[];
  txHash?: string;
  dryRun: boolean;
}

/** Turn the planned actions into contract Action tuples (resolving swap routes + minOut), then submit. */
export async function executeChain(args: {
  chain: ChainConfig;
  actions: PlannedAction[];
  routes: RouteProvider;
  slippageBps: number;
  privateKey: string;
  dryRun: boolean;
}): Promise<ExecuteResult> {
  const { chain, actions, routes, slippageBps, privateKey, dryRun } = args;
  const tuples: ActionTuple[] = [];

  for (const a of actions) {
    if (a.kind === "processQueued") continue;
    if (a.kind === "swap") {
      const route = await routes.quote({
        chain,
        tokenIn: a.token,
        tokenOut: a.tokenOut!,
        amountIn: a.amount,
        slippageBps,
      });
      const minOut = (route.expectedOut * BigInt(10_000 - slippageBps)) / 10_000n;
      tuples.push({
        kind: ACTION_KIND.swap,
        receiver: zeroFor(chain),
        router: route.router,
        tokenIn: addr(chain, a.token),
        tokenOut: addr(chain, a.tokenOut!),
        amount: a.amount,
        minOut,
        data: route.data,
      });
    } else {
      tuples.push({
        kind: ACTION_KIND[a.kind],
        receiver: a.receiver!,
        router: zeroFor(chain),
        tokenIn: addr(chain, a.token),
        tokenOut: zeroFor(chain),
        amount: a.amount,
        minOut: 0n,
        data: "0x",
      });
    }
  }

  if (dryRun || tuples.length === 0) return { tuples, dryRun: true };

  const txHash = chain.type === "tron" ? await submitTron(chain, tuples, privateKey) : await submitEvm(chain, tuples, privateKey);
  return { tuples, txHash, dryRun: false };
}

/** Call `processQueued` on FastSwap receivers (requires LIQUIDITY_ROLE on the bot key). */
export async function executeQueuedSettlements(args: {
  chain: ChainConfig;
  actions: PlannedAction[];
  privateKey: string;
  dryRun: boolean;
}): Promise<string[]> {
  const { chain, actions, privateKey, dryRun } = args;
  const settlements = actions.filter((a) => a.kind === "processQueued" && a.swapId && a.receiver);
  if (settlements.length === 0) return [];
  if (dryRun) return [];

  const hashes: string[] = [];
  for (const action of settlements) {
    const hash =
      chain.type === "tron"
        ? await submitProcessQueuedTron(chain, action.receiver!, action.swapId!, privateKey)
        : await submitProcessQueuedEvm(chain, action.receiver!, action.swapId!, privateKey);
    hashes.push(hash);
  }
  return hashes;
}

async function submitProcessQueuedEvm(
  chain: ChainConfig,
  receiver: string,
  swapId: string,
  privateKey: string
): Promise<string> {
  const provider = new JsonRpcProvider(chain.rpcUrl);
  const wallet = new Wallet(privateKey, provider);
  const fastSwap = new Contract(receiver, FASTSWAP_RECEIVER_ABI, wallet);
  const tx = await fastSwap.processQueued(swapId);
  const receipt = await tx.wait();
  return receipt?.hash ?? tx.hash;
}

async function submitProcessQueuedTron(
  chain: ChainConfig,
  receiver: string,
  swapId: string,
  privateKey: string
): Promise<string> {
  const tronWeb = new TronWeb({ fullHost: chain.fullHost ?? chain.rpcUrl ?? "", privateKey });
  const fastSwap = await tronWeb.contract(TRON_FASTSWAP_RECEIVER_ABI_JSON as never, receiver);
  return fastSwap.processQueued(swapId).send({ feeLimit: chain.feeLimit ?? 1_000_000_000 });
}

async function submitEvm(chain: ChainConfig, tuples: ActionTuple[], privateKey: string): Promise<string> {
  const provider = new JsonRpcProvider(chain.rpcUrl);
  const wallet = new Wallet(privateKey, provider);
  const lm = new Contract(chain.liquidityManager, LIQUIDITY_MANAGER_ABI, wallet);
  const ordered = tuples.map((t) => [t.kind, t.receiver, t.router, t.tokenIn, t.tokenOut, t.amount, t.minOut, t.data]);
  const tx = await lm.rebalance(ordered);
  const receipt = await tx.wait();
  return receipt?.hash ?? tx.hash;
}

async function submitTron(chain: ChainConfig, tuples: ActionTuple[], privateKey: string): Promise<string> {
  const tronWeb = new TronWeb({ fullHost: chain.fullHost ?? chain.rpcUrl ?? "", privateKey });
  const lm = await tronWeb.contract(TRON_LIQUIDITY_MANAGER_ABI_JSON as never, chain.liquidityManager);
  const ordered = tuples.map((t) => [t.kind, t.receiver, t.router, t.tokenIn, t.tokenOut, t.amount.toString(), t.minOut.toString(), t.data]);
  return lm.rebalance(ordered).send({ feeLimit: chain.feeLimit ?? 1_000_000_000 });
}

/** Address as the contract expects it, mapping the native sentinel to the chain's zero address. */
function addr(chain: ChainConfig, token: string): string {
  if (token.toLowerCase() === NATIVE_TOKEN) return zeroFor(chain);
  return token;
}

function zeroFor(chain: ChainConfig): string {
  return chain.type === "tron" ? TRON_ZERO : NATIVE_TOKEN;
}
