import { expect } from "chai";
import { bandKey } from "../bot/decide.js";
import { decideQueuedSwaps } from "../bot/decide-queue.js";
import type { BandObservation, ChainSnapshot, DecideContext, EconomicsConfig, QueuedSwapObservation, TokenBand } from "../shared/types.js";

const RESERVE = { symbol: "USDC", address: "0xReSeRve00000000000000000000000000000000", decimals: 6 };
const RECEIVER = "0xReceiver000000000000000000000000000000aa";
const NATIVE = "0x0000000000000000000000000000000000000000";

const ECON: EconomicsConfig = {
  gasGateBps: 50,
  minNotionalUsd: 100,
  maxStalenessSec: 3600,
  riskCapUsd: 5000,
  cooldownSec: 0,
  slippageBps: 50,
};

function ctx(overrides: Partial<DecideContext> = {}): DecideContext {
  return {
    economics: ECON,
    reserve: RESERVE,
    reserveBalance: 10_000_000_000n,
    reservePriceUsd: 1,
    gasCostUsd: 0.5,
    nowSec: 1_000_000,
    cooldowns: new Map(),
    breachSince: new Map(),
    ...overrides,
  };
}

function stableBand(): TokenBand {
  return {
    symbol: "USDC",
    address: RESERVE.address,
    decimals: 6,
    isStable: true,
    floor: "0",
    target: "0",
    ceiling: "0",
  };
}

function nativeBand(): TokenBand {
  return { symbol: "ETH", decimals: 18, isStable: false, floor: "0", target: "0", ceiling: "0" };
}

function snapshot(balances: Record<string, bigint>, floors: Record<string, bigint> = {}): ChainSnapshot {
  return {
    balances: new Map(Object.entries(balances)),
    floors: new Map(Object.entries(floors)),
    queuedSwaps: [],
    reserveBalance: 10_000_000_000n,
  };
}

describe("decideQueuedSwaps", function () {
  it("settles immediately when available liquidity covers the queued amount", function () {
    const token = stableBand();
    const key = bandKey(RECEIVER, token);
    const queued: QueuedSwapObservation[] = [
      { receiver: RECEIVER, swapId: "0xabc", targetToken: RESERVE.address.toLowerCase(), targetAmount: 100_000000n, recipient: RECEIVER },
    ];
    const observations: BandObservation[] = [{ receiver: RECEIVER, token, balance: 500_000000n, priceUsd: 1 }];
    const snap = snapshot({ [key]: 500_000000n }, { [key]: 0n });

    const out = decideQueuedSwaps(queued, snap, observations, ctx());
    expect(out.map((a) => a.kind)).to.deep.equal(["processQueued"]);
  });

  it("pushes stable reserve then settles when liquidity is short", function () {
    const token = stableBand();
    const key = bandKey(RECEIVER, token);
    const queued: QueuedSwapObservation[] = [
      { receiver: RECEIVER, swapId: "0xabc", targetToken: RESERVE.address.toLowerCase(), targetAmount: 200_000000n, recipient: RECEIVER },
    ];
    const observations: BandObservation[] = [{ receiver: RECEIVER, token, balance: 50_000000n, priceUsd: 1 }];
    const snap = snapshot({ [key]: 50_000000n }, { [key]: 0n });

    const out = decideQueuedSwaps(queued, snap, observations, ctx());
    expect(out.map((a) => a.kind)).to.deep.equal(["push", "processQueued"]);
    expect(out[0].amount).to.equal(150_000000n);
  });

  it("swaps reserve to native, pushes, then settles volatile queued swaps", function () {
    const token = nativeBand();
    const key = bandKey(RECEIVER, token);
    const queued: QueuedSwapObservation[] = [
      { receiver: RECEIVER, swapId: "0xdef", targetToken: NATIVE, targetAmount: 1_000000000000000000n, recipient: RECEIVER },
    ];
    const observations: BandObservation[] = [{ receiver: RECEIVER, token, balance: 0n, priceUsd: 2000 }];
    const snap = snapshot({ [key]: 0n }, { [key]: 0n });

    const out = decideQueuedSwaps(queued, snap, observations, ctx());
    expect(out.map((a) => a.kind)).to.deep.equal(["swap", "push", "processQueued"]);
    expect(out[0].tokenSymbol).to.equal("USDC");
    expect(out[1].tokenSymbol).to.equal("ETH");
  });

  it("does nothing when reserve cannot fund a shortfall", function () {
    const token = stableBand();
    const key = bandKey(RECEIVER, token);
    const queued: QueuedSwapObservation[] = [
      { receiver: RECEIVER, swapId: "0xabc", targetToken: RESERVE.address.toLowerCase(), targetAmount: 200_000000n, recipient: RECEIVER },
    ];
    const observations: BandObservation[] = [{ receiver: RECEIVER, token, balance: 0n, priceUsd: 1 }];
    const snap = snapshot({ [key]: 0n }, { [key]: 0n });

    const out = decideQueuedSwaps(queued, snap, observations, ctx({ reserveBalance: 0n }));
    expect(out).to.have.length(0);
  });
});
