import { expect } from "chai";
import { network } from "hardhat";
import { ethers as ethersLib } from "ethers";
import { bandKey, decideChain } from "../bot/decide.js";
import { decideQueuedSwaps } from "../bot/decide-queue.js";
import type { BandObservation, ChainSnapshot, DecideContext, EconomicsConfig, TokenBand } from "../shared/types.js";

/**
 * End-to-end queue path: relay parks a swap as queued → LiqMan bot scans, decides funding +
 * processQueued, and settles the customer payout.
 */
describe("LiquidityManager queue settlement", function () {
  const ECON: EconomicsConfig = {
    gasGateBps: 50,
    minNotionalUsd: 1,
    maxStalenessSec: 3600,
    riskCapUsd: 1_000_000,
    cooldownSec: 0,
    slippageBps: 50,
  };

  async function setup() {
    const { ethers } = (await network.create()) as Awaited<ReturnType<typeof network.create>> & { ethers: any };
    const [owner, recipient] = await ethers.getSigners();

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
    const stableAddr = await stable.getAddress();

    return { ethers, owner, recipient, lm, lmAddr, receiver, receiverAddr, stable, stableAddr };
  }

  function encodeIntent(recipient: string, targetToken: string, targetAmount: bigint) {
    return ethersLib.AbiCoder.defaultAbiCoder().encode(
      [
        "tuple(uint8 version,bytes32 quoteId,uint256 sourceChainId,address sourceToken,uint256 sourceAmount,uint256 targetChainId,address targetToken,uint256 targetAmount,address recipient,uint64 expiresAt,address refundAddress)",
      ],
      [
        {
          version: 1,
          quoteId: ethersLib.id("q"),
          sourceChainId: 1,
          sourceToken: ethersLib.ZeroAddress,
          sourceAmount: 1n,
          targetChainId: 2,
          targetToken,
          targetAmount,
          recipient,
          expiresAt: Math.floor(Date.now() / 1000) + 3600,
          refundAddress: recipient,
        },
      ]
    );
  }

  it("scans a queued swap, funds via push, and settles with processQueued", async function () {
    const f = await setup();
    const targetAmount = 100_000000n;
    const data = encodeIntent(f.recipient.address, f.stableAddr, targetAmount);
    const swapId = ethersLib.keccak256(data);

    await f.receiver.relaySwap(data);
    let state = await f.receiver.swapState(swapId);
    expect(state.queued).to.equal(true);

    const tokenBand: TokenBand = {
      symbol: "USDC",
      address: f.stableAddr.toLowerCase(),
      decimals: 6,
      isStable: true,
      floor: "0",
      target: "0",
      ceiling: "0",
    };
    const key = bandKey(f.receiverAddr, tokenBand);
    const snapshot: ChainSnapshot = {
      balances: new Map([[key, 0n]]),
      floors: new Map([[key, 0n]]),
      queuedSwaps: [
        {
          receiver: f.receiverAddr,
          swapId,
          targetToken: f.stableAddr.toLowerCase(),
          targetAmount,
          recipient: f.recipient.address,
        },
      ],
      reserveBalance: targetAmount,
    };
    const observations: BandObservation[] = [{ receiver: f.receiverAddr, token: tokenBand, balance: 0n, priceUsd: 1 }];
    const ctx: DecideContext = {
      economics: ECON,
      reserve: { symbol: "USDC", address: f.stableAddr.toLowerCase(), decimals: 6 },
      reserveBalance: targetAmount,
      reservePriceUsd: 1,
      gasCostUsd: 0.1,
      nowSec: Math.floor(Date.now() / 1000),
      cooldowns: new Map(),
      breachSince: new Map(),
    };

    const bandActions = decideChain(observations, ctx);
    const queueActions = decideQueuedSwaps(snapshot.queuedSwaps, snapshot, observations, ctx);
    expect(bandActions).to.have.length(0);
    expect(queueActions.map((a) => a.kind)).to.deep.equal(["push", "processQueued"]);

    await f.stable.mint(f.lmAddr, targetAmount);
    await f.lm.pushToReceiver(f.receiverAddr, f.stableAddr, targetAmount);
    await f.receiver.processQueued(swapId);

    state = await f.receiver.swapState(swapId);
    expect(state.processed).to.equal(true);
    expect(await f.stable.balanceOf(f.recipient.address)).to.equal(targetAmount);
  });
});
