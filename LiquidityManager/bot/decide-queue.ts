import type { ChainSnapshot } from "./observe.js";
import { bandKey, tokenKey } from "./decide.js";
import { bandTokenKey } from "./tokens.js";
import {
  NATIVE_TOKEN,
  type BandObservation,
  type DecideContext,
  type PlannedAction,
  type QueuedSwapObservation,
  type TokenBand,
} from "../shared/types.js";

function wholeAmount(amount: bigint, decimals: number): number {
  return Number(amount) / 10 ** decimals;
}

function usdToBaseUnits(usd: number, priceUsd: number, decimals: number): bigint {
  const whole = usd / priceUsd;
  return BigInt(Math.round(whole * 10 ** decimals));
}

function available(balance: bigint, floor: bigint): bigint {
  return balance > floor ? balance - floor : 0n;
}

/**
 * Decide how to settle queued FastSwap swaps on this chain.
 *
 * For each queued swap:
 *   1. If the receiver lacks available liquidity (balance − floor < targetAmount), plan a push
 *      (or swap+push from the stable reserve) to cover the shortfall.
 *   2. Plan `processQueued` once liquidity is sufficient (including pushes planned earlier in
 *      this same decision batch).
 *
 * Queued customer payouts bypass the economic gas gate — they are always acted on when fundable.
 */
export function decideQueuedSwaps(
  queued: QueuedSwapObservation[],
  snapshot: ChainSnapshot,
  observations: BandObservation[],
  ctx: DecideContext
): PlannedAction[] {
  if (queued.length === 0) return [];

  const actions: PlannedAction[] = [];
  const reserveKey = ctx.reserve.address.toLowerCase();
  let reserveAvailable = ctx.reserveBalance;

  // Simulated receiver balances after planned pushes in this batch.
  const projected = new Map(snapshot.balances);

  const tokenByKey = new Map<string, { token: TokenBand; receiver: string; priceUsd: number }>();
  for (const obs of observations) {
    tokenByKey.set(bandKey(obs.receiver, obs.token), {
      token: obs.token,
      receiver: obs.receiver,
      priceUsd: obs.priceUsd,
    });
  }

  for (const swap of queued) {
    const queueKey = `queue:${swap.swapId.toLowerCase()}`;
    const last = ctx.cooldowns.get(queueKey) ?? 0;
    if (ctx.nowSec - last < ctx.economics.cooldownSec) continue;

    const match = findTokenConfig(observations, swap);
    if (!match) continue;

    const { token, receiver, priceUsd } = match;
    const balKey = bandKey(receiver, token);
    const floor = snapshot.floors.get(balKey) ?? 0n;
    const balance = projected.get(balKey) ?? 0n;
    const avail = available(balance, floor);
    const need = swap.targetAmount;

    if (avail < need) {
      const shortfall = need - avail;
      const notionalUsd = wholeAmount(shortfall, token.decimals) * priceUsd;
      const isReserveToken = tokenKey(token) === reserveKey;

      if (isReserveToken) {
        const moved = shortfall <= reserveAvailable ? shortfall : reserveAvailable;
        if (moved <= 0n) continue;
        reserveAvailable -= moved;
        projected.set(balKey, balance + moved);
        actions.push({
          kind: "push",
          key: queueKey,
          receiver,
          token: tokenKey(token),
          tokenSymbol: token.symbol,
          amount: moved,
          notionalUsd,
          reason: `queued swap: fund ${token.symbol} shortfall`,
        });
      } else {
        const reserveIn = usdToBaseUnits(notionalUsd, ctx.reservePriceUsd, ctx.reserve.decimals);
        const swapIn = reserveIn <= reserveAvailable ? reserveIn : reserveAvailable;
        if (swapIn <= 0n) continue;
        reserveAvailable -= swapIn;
        actions.push({
          kind: "swap",
          key: queueKey,
          token: reserveKey,
          tokenSymbol: ctx.reserve.symbol,
          tokenOut: tokenKey(token),
          tokenOutSymbol: token.symbol,
          amount: swapIn,
          expectedOut: shortfall,
          notionalUsd,
          reason: `queued swap: swap reserve→${token.symbol}`,
        });
        actions.push({
          kind: "push",
          key: queueKey,
          receiver,
          token: tokenKey(token),
          tokenSymbol: token.symbol,
          amount: shortfall,
          notionalUsd,
          reason: `queued swap: push ${token.symbol} to receiver`,
        });
        projected.set(balKey, balance + shortfall);
      }
    }

    const after = projected.get(balKey) ?? 0n;
    if (available(after, floor) < need) continue;

    actions.push({
      kind: "processQueued",
      key: queueKey,
      receiver: swap.receiver,
      swapId: swap.swapId,
      token: tokenKey(token),
      tokenSymbol: token.symbol,
      amount: need,
      notionalUsd: wholeAmount(need, token.decimals) * priceUsd,
      reason: "queued swap: settle via processQueued",
    });
    projected.set(balKey, after - need);
  }

  return actions;
}

function findTokenConfig(
  observations: BandObservation[],
  swap: QueuedSwapObservation
): { token: TokenBand; receiver: string; priceUsd: number } | undefined {
  for (const obs of observations) {
    if (obs.receiver.toLowerCase() !== swap.receiver.toLowerCase()) continue;
    if (bandTokenKey(obs.token) === swap.targetToken || tokenKey(obs.token) === swap.targetToken) {
      return { token: obs.token, receiver: obs.receiver, priceUsd: obs.priceUsd };
    }
  }
  return undefined;
}
