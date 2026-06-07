import { expect } from "chai";
import { network } from "hardhat";
import { ethers as ethersLib } from "ethers";
import { bandKey, decideChain } from "../bot/decide.js";
import { ACTION_KIND } from "../bot/abi.js";
import {
  NATIVE_TOKEN,
  type BandObservation,
  type DecideContext,
  type EconomicsConfig,
  type PlannedAction,
  type ReserveStable,
  type TokenBand,
} from "../shared/types.js";

/**
 * End-to-end: drive the REAL decision engine (decideChain) against REAL on-chain balances, then
 * submit the resulting plan to the REAL LiquidityManager + FastSwapReceiver, and assert the full
 * collect (drain excess -> swap to reserve) and refill (swap reserve -> deposit) lifecycle. The only
 * stand-ins are the DEX router and price feeds (mock-token DEX liquidity does not exist on testnets,
 * so a live run would use the same kind of deployed mock router + feed).
 */
describe("LiquidityManager integration — collect & refill lifecycle", function () {
  const log = {
    scenario: (m: string) => console.log(`\n──── ${m} ────`),
    step: (m: string) => console.log(`   • ${m}`),
    ok: (m: string) => console.log(`   ✓ ${m}`),
  };

  const STALENESS = 3600n;
  const ECON: EconomicsConfig = {
    gasGateBps: 50,
    minNotionalUsd: 10,
    maxStalenessSec: 3600,
    riskCapUsd: 1_000_000,
    cooldownSec: 0,
    slippageBps: 50,
  };
  const PRICES: Record<string, number> = { USDC: 1, VOL: 2000 };
  const DECIMALS: Record<string, number> = { USDC: 6, VOL: 18 };

  async function setup() {
    const { ethers } = (await network.create()) as Awaited<ReturnType<typeof network.create>> & { ethers: any };
    const [owner, treasury] = await ethers.getSigners();

    const LM = await ethers.getContractFactory("LiquidityManager");
    const Proxy = await ethers.getContractFactory("ReceiverProxy");
    const lmProxy = await Proxy.deploy(
      await (await LM.deploy()).getAddress(),
      LM.interface.encodeFunctionData("initialize", [owner.address])
    );
    const lm = await ethers.getContractAt("LiquidityManager", await lmProxy.getAddress());
    const lmAddr = await lm.getAddress();

    const FastSwap = await ethers.getContractFactory("FastSwapReceiver");
    const fsProxy = await Proxy.deploy(
      await (await FastSwap.deploy()).getAddress(),
      FastSwap.interface.encodeFunctionData("initialize", [owner.address])
    );
    const receiver = await ethers.getContractAt("FastSwapReceiver", await fsProxy.getAddress());
    const receiverAddr = await receiver.getAddress();
    await receiver.grantRole(await receiver.REBALANCER_ROLE(), lmAddr);
    await receiver.grantRole(await receiver.LIQUIDITY_ROLE(), lmAddr);

    const Token = await ethers.getContractFactory("MockERC20");
    const stable = await Token.deploy("USD Coin", "USDC", 6);
    const vol = await Token.deploy("Volatile", "VOL", 18);
    const Agg = await ethers.getContractFactory("MockAggregator");
    const stableFeed = await Agg.deploy(1_0000_0000n);
    const volFeed = await Agg.deploy(2000_0000_0000n);
    const Router = await ethers.getContractFactory("MockSwapRouter");
    const router = await Router.deploy();
    const routerAddr = await router.getAddress();

    await lm.setOracle(await stable.getAddress(), await stableFeed.getAddress(), 8, 6, STALENESS);
    await lm.setOracle(await vol.getAddress(), await volFeed.getAddress(), 8, 18, STALENESS);
    await lm.setRouterAllowed(routerAddr, true);

    const reserve: ReserveStable = { symbol: "USDC", address: (await stable.getAddress()).toLowerCase(), decimals: 6 };
    return { ethers, owner, treasury, lm, lmAddr, receiver, receiverAddr, stable, vol, router, routerAddr, reserve };
  }

  // Build the observation the bot would read from chain, with config bands.
  function observe(receiver: string, token: TokenBand, balance: bigint): BandObservation {
    return { receiver, token, balance, priceUsd: PRICES[token.symbol] };
  }

  // Mirror the bot's executeChain tuple-building, but resolve swaps through the mock router at the
  // fair oracle price (stand-in for the aggregator route).
  async function submitPlan(ctx: { lm: any; router: any; actions: PlannedAction[] }) {
    const { lm, router, actions } = ctx;
    const tuples: any[] = [];
    for (const a of actions) {
      if (a.kind === "swap") {
        const fairOut = fairOutBase(a);
        const minOut = (fairOut * BigInt(10_000 - ECON.slippageBps)) / 10_000n;
        const data = router.interface.encodeFunctionData("swap", [a.token, a.amount, a.tokenOut, fairOut]);
        tuples.push([ACTION_KIND.swap, NATIVE_TOKEN, await router.getAddress(), a.token, a.tokenOut, a.amount, minOut, data]);
      } else {
        tuples.push([ACTION_KIND[a.kind], a.receiver, NATIVE_TOKEN, a.token, NATIVE_TOKEN, a.amount, 0n, "0x"]);
      }
    }
    await lm.rebalance(tuples);
  }

  // Fair output (base units) for a swap action at the oracle prices.
  function fairOutBase(a: PlannedAction): bigint {
    const inUsd = (Number(a.amount) / 10 ** DECIMALS[a.tokenSymbol]) * PRICES[a.tokenSymbol];
    const outWhole = inUsd / PRICES[a.tokenOutSymbol!];
    return BigInt(Math.round(outWhole * 10 ** DECIMALS[a.tokenOutSymbol!]));
  }

  function ctxFor(reserve: ReserveStable, reserveBalance: bigint, breachKeys: string[], nowSec: number): DecideContext {
    return {
      economics: ECON,
      reserve,
      reserveBalance,
      reservePriceUsd: 1,
      gasCostUsd: 0.2,
      nowSec,
      cooldowns: new Map(),
      breachSince: new Map(breachKeys.map((k) => [k, nowSec])),
    };
  }

  it("collects excess volatile inventory and refills a depleted token", async function () {
    const f = await setup();
    const volBand: TokenBand = {
      symbol: "VOL",
      address: (await f.vol.getAddress()).toLowerCase(),
      decimals: 18,
      isStable: false,
      floor: "1000000000000000000", // 1 VOL
      target: "2000000000000000000", // 2 VOL
      ceiling: "3000000000000000000", // 3 VOL
    };
    const now = Math.floor(Date.now() / 1000);

    // ---- Scenario 1: receiver over-accumulated VOL → collect it into stable reserve ----
    log.scenario("Scenario 1 — collect excess VOL into the stable reserve");
    await f.vol.mint(f.receiverAddr, ethersLib.parseEther("5")); // receiver holds 5 VOL (ceiling is 3)
    await f.stable.mint(f.routerAddr, 6000_000000n); // router can pay out 6000 USDC
    log.step("receiver holds 5 VOL (band target 2, ceiling 3)");

    let bal = await f.vol.balanceOf(f.receiverAddr);
    let obs = [observe(f.receiverAddr, volBand, BigInt(bal.toString()))];
    let key = bandKey(f.receiverAddr, volBand);
    let plan = decideChain(obs, ctxFor(f.reserve, 0n, [key], now));
    log.step(`bot plan: ${plan.map((a) => `${a.kind}(${a.tokenSymbol}${a.tokenOutSymbol ? "→" + a.tokenOutSymbol : ""})`).join(", ")}`);
    expect(plan.map((a) => a.kind)).to.deep.equal(["pull", "swap"]);

    await submitPlan({ lm: f.lm, router: f.router, actions: plan });

    expect(await f.vol.balanceOf(f.receiverAddr)).to.equal(ethersLib.parseEther("2")); // back to target
    const reserveAfterCollect = BigInt((await f.stable.balanceOf(f.lmAddr)).toString());
    expect(reserveAfterCollect).to.equal(6000_000000n); // 3 VOL @ $2000 = $6000 held as reserve
    log.ok(`receiver VOL trimmed to target 2; manager reserve now ${reserveAfterCollect / 1_000000n} USDC`);

    // ---- Scenario 2: receiver depleted VOL → swap reserve to VOL and refill ----
    log.scenario("Scenario 2 — refill a depleted VOL balance from the reserve");
    // drain the receiver's VOL to 0 to simulate payouts depleting inventory
    await f.lm.pullFromReceiver(f.receiverAddr, await f.vol.getAddress(), ethersLib.parseEther("2"));
    await f.lm.emergencyWithdraw(await f.vol.getAddress(), f.treasury.address, ethersLib.parseEther("2"));
    await f.vol.mint(f.routerAddr, ethersLib.parseEther("2")); // router can pay out 2 VOL
    log.step("receiver VOL drained to 0 (below floor 1)");

    bal = await f.vol.balanceOf(f.receiverAddr);
    expect(bal).to.equal(0n);
    obs = [observe(f.receiverAddr, volBand, BigInt(bal.toString()))];
    const reserveNow = BigInt((await f.stable.balanceOf(f.lmAddr)).toString());
    plan = decideChain(obs, ctxFor(f.reserve, reserveNow, [key], now));
    log.step(`bot plan: ${plan.map((a) => `${a.kind}(${a.tokenSymbol}${a.tokenOutSymbol ? "→" + a.tokenOutSymbol : ""})`).join(", ")}`);
    expect(plan.map((a) => a.kind)).to.deep.equal(["swap", "push"]);

    await submitPlan({ lm: f.lm, router: f.router, actions: plan });

    expect(await f.vol.balanceOf(f.receiverAddr)).to.equal(ethersLib.parseEther("2")); // refilled to target
    const reserveAfterRefill = BigInt((await f.stable.balanceOf(f.lmAddr)).toString());
    expect(reserveAfterRefill).to.equal(reserveNow - 4000_000000n); // spent $4000 to buy 2 VOL
    log.ok(`receiver VOL refilled to target 2; reserve spent 4000 USDC (now ${reserveAfterRefill / 1_000000n})`);
  });
});
