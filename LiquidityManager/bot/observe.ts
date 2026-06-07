import { Contract, JsonRpcProvider } from "ethers";
import { TronWeb } from "tronweb";
import { ERC20_MIN_ABI, TRON_TRC20_ABI_JSON } from "./abi.js";
import { FASTSWAP_RECEIVER_ABI, TRON_FASTSWAP_RECEIVER_ABI_JSON } from "./fastswap.js";
import { bandKey } from "./decide.js";
import { bandTokenKey, normalizeTokenKey, receiverTokenArg } from "./tokens.js";
import { type ChainConfig, type QueuedSwapObservation } from "../shared/types.js";

export interface ChainSnapshot {
  /** bandKey(receiver, token) -> on-chain balance (base units). */
  balances: Map<string, bigint>;
  /** bandKey(receiver, token) -> on-chain liquidity floor (base units). */
  floors: Map<string, bigint>;
  /** Queued swaps discovered on managed receivers. */
  queuedSwaps: QueuedSwapObservation[];
  /** The LiquidityManager's reserve-stable balance (base units). */
  reserveBalance: bigint;
}

/** Reads every managed receiver/token balance plus the manager's reserve, per chain type. */
export async function observeChain(chain: ChainConfig): Promise<ChainSnapshot> {
  return chain.type === "tron" ? observeTron(chain) : observeEvm(chain);
}

async function observeEvm(chain: ChainConfig): Promise<ChainSnapshot> {
  const provider = new JsonRpcProvider(chain.rpcUrl);
  const balances = new Map<string, bigint>();
  const floors = new Map<string, bigint>();
  const queuedSwaps: QueuedSwapObservation[] = [];

  for (const receiver of chain.receivers) {
    const fastSwap = new Contract(receiver.address, FASTSWAP_RECEIVER_ABI, provider);
    for (const token of receiver.tokens) {
      const key = bandKey(receiver.address, token);
      const balance = token.address
        ? await new Contract(token.address, ERC20_MIN_ABI, provider).balanceOf(receiver.address)
        : await provider.getBalance(receiver.address);
      balances.set(key, BigInt(balance.toString()));
      floors.set(
        key,
        BigInt((await fastSwap.liquidityFloor(receiverTokenArg(bandTokenKey(token), "evm"))).toString())
      );
    }
    queuedSwaps.push(...(await readQueuedSwapsEvm(fastSwap, receiver.address)));
  }

  const reserveBalance = BigInt(
    (await new Contract(chain.reserveStable.address, ERC20_MIN_ABI, provider).balanceOf(chain.liquidityManager)).toString()
  );
  return { balances, floors, queuedSwaps, reserveBalance };
}

async function observeTron(chain: ChainConfig): Promise<ChainSnapshot> {
  const tronWeb = new TronWeb({ fullHost: chain.fullHost ?? chain.rpcUrl ?? "" });
  const balances = new Map<string, bigint>();
  const floors = new Map<string, bigint>();
  const queuedSwaps: QueuedSwapObservation[] = [];

  for (const receiver of chain.receivers) {
    const fastSwap = await tronWeb.contract(TRON_FASTSWAP_RECEIVER_ABI_JSON as never, receiver.address);
    for (const token of receiver.tokens) {
      const key = bandKey(receiver.address, token);
      const balance = token.address
        ? BigInt(
            (
              await tronWeb.contract(TRON_TRC20_ABI_JSON as never, token.address).balanceOf(receiver.address).call()
            ).toString()
          )
        : BigInt(await tronWeb.trx.getBalance(receiver.address));
      balances.set(key, balance);
      floors.set(
        key,
        BigInt(
          (await fastSwap.liquidityFloor(receiverTokenArg(bandTokenKey(token), "tron")).call()).toString()
        )
      );
    }
    queuedSwaps.push(...(await readQueuedSwapsTron(fastSwap, receiver.address)));
  }

  const reserveBalance = BigInt(
    (
      await tronWeb.contract(TRON_TRC20_ABI_JSON as never, chain.reserveStable.address)
        .balanceOf(chain.liquidityManager)
        .call()
    ).toString()
  );
  return { balances, floors, queuedSwaps, reserveBalance };
}

async function readQueuedSwapsEvm(
  fastSwap: Contract,
  receiver: string
): Promise<QueuedSwapObservation[]> {
  const count = Number(await fastSwap.queuedSwapCount());
  const out: QueuedSwapObservation[] = [];
  for (let i = 0; i < count; i++) {
    const swapId = String(await fastSwap.queuedSwapIdAt(i));
    const state = await fastSwap.swapState(swapId);
    if (!state.queued || state.processed) continue;
    out.push({
      receiver,
      swapId,
      targetToken: normalizeTokenKey(state.intent.targetToken),
      targetAmount: BigInt(state.intent.targetAmount.toString()),
      recipient: state.intent.recipient,
    });
  }
  return out;
}

async function readQueuedSwapsTron(fastSwap: { queuedSwapCount(): { call(): Promise<unknown> }; queuedSwapIdAt(index: number): { call(): Promise<unknown> }; swapState(swapId: string): { call(): Promise<unknown> } }, receiver: string): Promise<QueuedSwapObservation[]> {
  const count = Number(String(await fastSwap.queuedSwapCount().call()));
  const out: QueuedSwapObservation[] = [];
  for (let i = 0; i < count; i++) {
    const swapId = String(await fastSwap.queuedSwapIdAt(i).call());
    const state = (await fastSwap.swapState(swapId).call()) as {
      intent: { targetToken: string; targetAmount: string | bigint; recipient: string };
      processed: boolean;
      queued: boolean;
    };
    if (!state.queued || state.processed) continue;
    out.push({
      receiver,
      swapId,
      targetToken: normalizeTokenKey(state.intent.targetToken),
      targetAmount: BigInt(state.intent.targetAmount.toString()),
      recipient: state.intent.recipient,
    });
  }
  return out;
}
