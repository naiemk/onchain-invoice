import { expect } from "chai";
import { decideChain } from "../bot/decide.js";
import type { BandObservation, DecideContext, EconomicsConfig, TokenBand } from "../shared/types.js";

const RESERVE = { symbol: "USDC", address: "0xReSeRve00000000000000000000000000000000", decimals: 6 };
const RECEIVER = "0xReceiver000000000000000000000000000000aa";

const ECON: EconomicsConfig = {
  gasGateBps: 50, // 0.5%
  minNotionalUsd: 100,
  maxStalenessSec: 3600,
  riskCapUsd: 5000,
  cooldownSec: 60,
  slippageBps: 50,
};

function ctx(overrides: Partial<DecideContext> = {}): DecideContext {
  return {
    economics: ECON,
    reserve: RESERVE,
    reserveBalance: 1_000_000_000_000n, // 1,000,000 USDC
    reservePriceUsd: 1,
    gasCostUsd: 0.5,
    nowSec: 1_000_000,
    cooldowns: new Map(),
    breachSince: new Map(),
    ...overrides,
  };
}

function nativeBand(over: Partial<TokenBand> = {}): TokenBand {
  return { symbol: "ETH", decimals: 18, isStable: false, floor: "0", target: "0", ceiling: "0", ...over };
}
function stableBand(over: Partial<TokenBand> = {}): TokenBand {
  return {
    symbol: "USDC",
    address: RESERVE.address,
    decimals: 6,
    isStable: true,
    floor: "0",
    target: "0",
    ceiling: "0",
    ...over,
  };
}
function obs(token: TokenBand, balance: bigint, priceUsd: number): BandObservation {
  return { receiver: RECEIVER, token, balance, priceUsd };
}

const E = (n: string) => BigInt(n);

describe("decideChain", function () {
  it("does nothing when balances are within band", function () {
    const band = nativeBand({ floor: "1000000000000000000", target: "2000000000000000000", ceiling: "3000000000000000000" });
    const out = decideChain([obs(band, E("2000000000000000000"), 2000)], ctx());
    expect(out).to.have.length(0);
  });

  it("refills the reserve stable with a single push", function () {
    const band = stableBand({ floor: "100000000", target: "200000000", ceiling: "400000000" });
    const out = decideChain([obs(band, 0n, 1)], ctx());
    expect(out.map((a) => a.kind)).to.deep.equal(["push"]);
    expect(out[0].amount).to.equal(200000000n);
  });

  it("refills a volatile token by swapping reserve then pushing", function () {
    const band = nativeBand({ floor: "1000000000000000000", target: "2000000000000000000", ceiling: "3000000000000000000" });
    const out = decideChain([obs(band, 0n, 2000)], ctx());
    expect(out.map((a) => a.kind)).to.deep.equal(["swap", "push"]);
    expect(out[0].tokenSymbol).to.equal("USDC"); // reserve in
    expect(out[1].amount).to.equal(2000000000000000000n);
  });

  it("collects excess volatile inventory: pull then swap to reserve", function () {
    const band = nativeBand({ floor: "1000000000000000000", target: "2000000000000000000", ceiling: "3000000000000000000" });
    const out = decideChain([obs(band, E("5000000000000000000"), 2000)], ctx());
    expect(out.map((a) => a.kind)).to.deep.equal(["pull", "swap"]);
    expect(out[0].amount).to.equal(3000000000000000000n); // 5 - target(2)
    expect(out[1].tokenOutSymbol).to.equal("USDC");
  });

  it("collects excess reserve stable with a pull only (no swap)", function () {
    const band = stableBand({ floor: "100000000", target: "200000000", ceiling: "300000000" });
    const out = decideChain([obs(band, 500000000n, 1)], ctx());
    expect(out.map((a) => a.kind)).to.deep.equal(["pull"]);
    expect(out[0].amount).to.equal(300000000n);
  });

  it("defers small breaches that fail the economic gate", function () {
    const band = stableBand({ floor: "1000000", target: "2000000", ceiling: "4000000" }); // ~$2 notional
    const out = decideChain([obs(band, 0n, 1)], ctx());
    expect(out).to.have.length(0);
  });

  it("forces a deferred breach once it exceeds max staleness", function () {
    const band = stableBand({ floor: "1000000", target: "2000000", ceiling: "4000000" });
    const breachSince = new Map([[`${RECEIVER.toLowerCase()}:${RESERVE.address.toLowerCase()}`, 1_000_000 - 4000]]);
    const out = decideChain([obs(band, 0n, 1)], ctx({ breachSince }));
    expect(out.map((a) => a.kind)).to.deep.equal(["push"]);
  });

  it("forces a collect when volatile inventory exceeds the risk cap", function () {
    // small excess (fails gate) but large inventory over the $5000 cap
    const band = nativeBand({ floor: "1000000000000000000", target: "4900000000000000000", ceiling: "4900000000000000000" });
    const out = decideChain([obs(band, E("5000000000000000000"), 2000)], ctx({ economics: { ...ECON, minNotionalUsd: 500 } }));
    expect(out.map((a) => a.kind)).to.deep.equal(["pull", "swap"]);
    expect(out[1].reason).to.include("risk cap");
  });

  it("respects the cooldown", function () {
    const band = stableBand({ floor: "100000000", target: "200000000", ceiling: "400000000" });
    const cooldowns = new Map([[`${RECEIVER.toLowerCase()}:${RESERVE.address.toLowerCase()}`, 1_000_000 - 10]]);
    const out = decideChain([obs(band, 0n, 1)], ctx({ cooldowns }));
    expect(out).to.have.length(0);
  });
});
