import {
  NATIVE_TOKEN,
  type BandObservation,
  type DecideContext,
  type PlannedAction,
  type TokenBand,
} from "../shared/types.js";

/** Address key for a band's token (native -> zero address). */
export function tokenKey(token: Pick<TokenBand, "address">): string {
  return (token.address ?? NATIVE_TOKEN).toLowerCase();
}

export function bandKey(receiver: string, token: Pick<TokenBand, "address">): string {
  return `${receiver.toLowerCase()}:${tokenKey(token)}`;
}

function wholeAmount(amount: bigint, decimals: number): number {
  return Number(amount) / 10 ** decimals;
}

function usdToBaseUnits(usd: number, priceUsd: number, decimals: number): bigint {
  const whole = usd / priceUsd;
  return BigInt(Math.round(whole * 10 ** decimals));
}

/**
 * Pure decision engine. Turns observed balances + bands + economics into the concrete pull/swap/push
 * steps to run, applying the deadband, the gas/notional economic gate, the risk cap, max-staleness and
 * cooldown. Stateless and fully unit-testable; IO (reading balances, quotes, submitting txs) lives
 * elsewhere.
 *
 * Per band:
 *   - balance < floor   -> refill toward target (push reserve directly if it is the reserve stable,
 *                          otherwise swap reserve->token then push)
 *   - balance > ceiling -> collect excess down to target (pull to the manager, then swap token->reserve
 *                          unless the token already is the reserve stable)
 * An action only fires when the economic gate passes, or when it is forced (breach older than
 * maxStalenessSec, or volatile inventory above riskCapUsd).
 */
export function decideChain(observations: BandObservation[], ctx: DecideContext): PlannedAction[] {
  const actions: PlannedAction[] = [];
  const reserveKey = ctx.reserve.address.toLowerCase();
  let reserveAvailable = ctx.reserveBalance;

  for (const obs of observations) {
    const { token, balance } = obs;
    const key = bandKey(obs.receiver, token);
    const floor = BigInt(token.floor);
    const target = BigInt(token.target);
    const ceiling = BigInt(token.ceiling);

    const last = ctx.cooldowns.get(key) ?? 0;
    if (ctx.nowSec - last < ctx.economics.cooldownSec) continue;

    let mode: "refill" | "collect" | null = null;
    let amount = 0n;
    if (balance < floor) {
      mode = "refill";
      amount = target - balance;
    } else if (balance > ceiling) {
      mode = "collect";
      amount = balance - target;
    }
    if (!mode || amount <= 0n) continue;

    const notionalUsd = wholeAmount(amount, token.decimals) * obs.priceUsd;
    const inventoryUsd = wholeAmount(balance, token.decimals) * obs.priceUsd;
    const isReserveToken = tokenKey(token) === reserveKey;
    const isVolatile = !token.isStable;

    const breachSince = ctx.breachSince.get(key) ?? ctx.nowSec;
    const stale = ctx.nowSec - breachSince >= ctx.economics.maxStalenessSec;
    const overRiskCap = mode === "collect" && isVolatile && inventoryUsd > ctx.economics.riskCapUsd;

    const gateOk =
      notionalUsd >= ctx.economics.minNotionalUsd &&
      ctx.gasCostUsd <= (ctx.economics.gasGateBps / 10_000) * notionalUsd;
    if (!gateOk && !stale && !overRiskCap) continue;

    const reason = describeReason(mode, gateOk, stale, overRiskCap);

    if (mode === "refill") {
      if (isReserveToken) {
        const moved = amount <= reserveAvailable ? amount : reserveAvailable;
        if (moved <= 0n) continue;
        reserveAvailable -= moved;
        actions.push(pushAction(key, obs, moved, notionalUsd, reason));
      } else {
        // reserve(stable) -> token, then push token into the receiver
        const reserveIn = usdToBaseUnits(notionalUsd, ctx.reservePriceUsd, ctx.reserve.decimals);
        const swapIn = reserveIn <= reserveAvailable ? reserveIn : reserveAvailable;
        if (swapIn <= 0n) continue;
        reserveAvailable -= swapIn;
        actions.push(swapAction(key, ctx.reserve.address, ctx.reserve.symbol, swapIn, token, amount, notionalUsd, reason));
        actions.push(pushAction(key, obs, amount, notionalUsd, reason));
      }
    } else {
      // collect: pull excess to the manager
      actions.push(pullAction(key, obs, amount, notionalUsd, reason));
      if (!isReserveToken) {
        const expectedReserveOut = usdToBaseUnits(notionalUsd, ctx.reservePriceUsd, ctx.reserve.decimals);
        actions.push(
          swapAction(key, tokenKey(token), token.symbol, amount, reserveBandView(ctx.reserve), expectedReserveOut, notionalUsd, reason)
        );
      }
    }
  }

  return actions;
}

function describeReason(mode: string, gateOk: boolean, stale: boolean, overRiskCap: boolean): string {
  if (gateOk) return `${mode}: economic gate met`;
  if (overRiskCap) return `${mode}: volatile inventory over risk cap`;
  if (stale) return `${mode}: breach exceeded max staleness`;
  return mode;
}

function reserveBandView(reserve: { symbol: string; address: string; decimals: number }): TokenBand {
  return {
    symbol: reserve.symbol,
    address: reserve.address,
    decimals: reserve.decimals,
    isStable: true,
    floor: "0",
    target: "0",
    ceiling: "0",
  };
}

function pushAction(
  key: string,
  obs: BandObservation,
  amount: bigint,
  notionalUsd: number,
  reason: string
): PlannedAction {
  return {
    kind: "push",
    key,
    receiver: obs.receiver,
    token: tokenKey(obs.token),
    tokenSymbol: obs.token.symbol,
    amount,
    notionalUsd,
    reason,
  };
}

function pullAction(
  key: string,
  obs: BandObservation,
  amount: bigint,
  notionalUsd: number,
  reason: string
): PlannedAction {
  return {
    kind: "pull",
    key,
    receiver: obs.receiver,
    token: tokenKey(obs.token),
    tokenSymbol: obs.token.symbol,
    amount,
    notionalUsd,
    reason,
  };
}

function swapAction(
  key: string,
  tokenIn: string,
  tokenInSymbol: string,
  amountIn: bigint,
  tokenOut: TokenBand,
  expectedOut: bigint,
  notionalUsd: number,
  reason: string
): PlannedAction {
  return {
    kind: "swap",
    key,
    token: tokenIn.toLowerCase(),
    tokenSymbol: tokenInSymbol,
    tokenOut: tokenKey(tokenOut),
    tokenOutSymbol: tokenOut.symbol,
    amount: amountIn,
    expectedOut,
    notionalUsd,
    reason,
  };
}
