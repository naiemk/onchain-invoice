import { expect } from "chai";
import { network } from "hardhat";
import { ethers as ethersLib } from "ethers";

const NATIVE = ethersLib.ZeroAddress;
const STALENESS = 3600n;

describe("LiquidityManager", function () {
  async function deployFixture() {
    const { ethers } = (await network.create()) as Awaited<ReturnType<typeof network.create>> & {
      ethers: any;
    };
    const [owner, outsider, recipient] = await ethers.getSigners();

    // LiquidityManager behind an ERC-1967 proxy.
    const LM = await ethers.getContractFactory("LiquidityManager");
    const lmImpl = await LM.deploy();
    const Proxy = await ethers.getContractFactory("ReceiverProxy");
    const lmProxy = await Proxy.deploy(
      await lmImpl.getAddress(),
      LM.interface.encodeFunctionData("initialize", [owner.address])
    );
    const lm = await ethers.getContractAt("LiquidityManager", await lmProxy.getAddress());
    const lmAddr = await lm.getAddress();

    // A FastSwap receiver the LiquidityManager will rebalance.
    const FastSwap = await ethers.getContractFactory("FastSwapReceiver");
    const fsImpl = await FastSwap.deploy();
    const fsProxy = await Proxy.deploy(
      await fsImpl.getAddress(),
      FastSwap.interface.encodeFunctionData("initialize", [owner.address])
    );
    const receiver = await ethers.getContractAt("FastSwapReceiver", await fsProxy.getAddress());
    await receiver.grantRole(await receiver.REBALANCER_ROLE(), lmAddr);
    await receiver.grantRole(await receiver.LIQUIDITY_ROLE(), lmAddr);

    // Tokens: a 6-decimal stable ($1) and an 18-decimal volatile token ($2000).
    const Token = await ethers.getContractFactory("MockERC20");
    const stable = await Token.deploy("USD Stable", "USDX", 6);
    const vol = await Token.deploy("Volatile", "VOL", 18);

    // Price feeds (Chainlink-style, 8 decimals).
    const Agg = await ethers.getContractFactory("MockAggregator");
    const stableFeed = await Agg.deploy(1_0000_0000n); // $1
    const volFeed = await Agg.deploy(2000_0000_0000n); // $2000
    const nativeFeed = await Agg.deploy(2000_0000_0000n); // $2000

    const Router = await ethers.getContractFactory("MockSwapRouter");
    const router = await Router.deploy();
    const routerAddr = await router.getAddress();

    // Wire oracles + router whitelist.
    await lm.setOracle(await stable.getAddress(), await stableFeed.getAddress(), 8, 6, STALENESS);
    await lm.setOracle(await vol.getAddress(), await volFeed.getAddress(), 8, 18, STALENESS);
    await lm.setOracle(NATIVE, await nativeFeed.getAddress(), 8, 18, STALENESS);
    await lm.setRouterAllowed(routerAddr, true);

    return {
      ethers,
      owner,
      outsider,
      recipient,
      lm,
      lmAddr,
      receiver,
      stable,
      vol,
      stableFeed,
      volFeed,
      nativeFeed,
      router,
      routerAddr,
    };
  }

  function swapCalldata(router: any, tokenIn: string, amountIn: bigint, tokenOut: string, amountOut: bigint) {
    return router.interface.encodeFunctionData("swap", [tokenIn, amountIn, tokenOut, amountOut]);
  }

  it("swaps a token for a token within the oracle floor", async function () {
    const { lm, lmAddr, stable, vol, router, routerAddr } = await deployFixture();
    const amountIn = ethersLib.parseEther("1"); // 1 VOL = $2000
    const fairOut = 2000_000000n; // 2000 USDX (6 decimals)

    await vol.mint(lmAddr, amountIn);
    await stable.mint(routerAddr, fairOut);

    const data = swapCalldata(router, await vol.getAddress(), amountIn, await stable.getAddress(), fairOut);
    await lm.swap(routerAddr, await vol.getAddress(), amountIn, await stable.getAddress(), fairOut, data);

    expect(await stable.balanceOf(lmAddr)).to.equal(fairOut);
    expect(await vol.balanceOf(lmAddr)).to.equal(0n);
  });

  it("swaps a token for native (stable -> ETH)", async function () {
    const { ethers, lm, lmAddr, stable, router, routerAddr } = await deployFixture();
    const amountIn = 2000_000000n; // 2000 USDX -> ~1 ETH
    const fairOut = ethersLib.parseEther("1");

    await stable.mint(lmAddr, amountIn);
    await (await ethers.getSigners())[0].sendTransaction({ to: routerAddr, value: fairOut });

    const data = swapCalldata(router, await stable.getAddress(), amountIn, NATIVE, fairOut);
    const before = await ethers.provider.getBalance(lmAddr);
    await lm.swap(routerAddr, await stable.getAddress(), amountIn, NATIVE, fairOut, data);
    const after = await ethers.provider.getBalance(lmAddr);

    expect(after - before).to.equal(fairOut);
  });

  it("swaps native for a token (ETH -> stable)", async function () {
    const { ethers, owner, lm, lmAddr, stable, router, routerAddr } = await deployFixture();
    const amountIn = ethersLib.parseEther("1");
    const fairOut = 2000_000000n;

    await owner.sendTransaction({ to: lmAddr, value: amountIn });
    await stable.mint(routerAddr, fairOut);

    const data = swapCalldata(router, NATIVE, amountIn, await stable.getAddress(), fairOut);
    await lm.swap(routerAddr, NATIVE, amountIn, await stable.getAddress(), fairOut, data);

    expect(await stable.balanceOf(lmAddr)).to.equal(fairOut);
    expect(await ethers.provider.getBalance(lmAddr)).to.equal(0n);
  });

  it("reverts when output is below the bot minOut", async function () {
    const { lm, lmAddr, stable, vol, router, routerAddr } = await deployFixture();
    const amountIn = ethersLib.parseEther("1");
    const actualOut = 2000_000000n;

    await vol.mint(lmAddr, amountIn);
    await stable.mint(routerAddr, actualOut);

    const data = swapCalldata(router, await vol.getAddress(), amountIn, await stable.getAddress(), actualOut);
    await expectRevert(
      lm.swap(routerAddr, await vol.getAddress(), amountIn, await stable.getAddress(), actualOut + 1n, data),
      "Slippage"
    );
  });

  it("reverts when output deviates from the oracle floor", async function () {
    const { lm, lmAddr, stable, vol, router, routerAddr } = await deployFixture();
    const amountIn = ethersLib.parseEther("1"); // fair = 2000 USDX
    const badOut = 1900_000000n; // 5% short, deviation cap is 2%

    await vol.mint(lmAddr, amountIn);
    await stable.mint(routerAddr, badOut);

    const data = swapCalldata(router, await vol.getAddress(), amountIn, await stable.getAddress(), badOut);
    await expectRevert(
      lm.swap(routerAddr, await vol.getAddress(), amountIn, await stable.getAddress(), 0n, data),
      "OracleDeviation"
    );
  });

  it("reverts on a non-whitelisted router", async function () {
    const { lm, vol, stable } = await deployFixture();
    await expectRevert(
      lm.swap(
        ethersLib.Wallet.createRandom().address,
        await vol.getAddress(),
        1n,
        await stable.getAddress(),
        0n,
        "0x"
      ),
      "RouterNotAllowed"
    );
  });

  it("reverts when the single-swap cap is exceeded", async function () {
    const { lm, lmAddr, stable, vol, router, routerAddr } = await deployFixture();
    await lm.setMaxSwap(await vol.getAddress(), ethersLib.parseEther("0.5"));
    const amountIn = ethersLib.parseEther("1");
    await vol.mint(lmAddr, amountIn);
    const data = swapCalldata(router, await vol.getAddress(), amountIn, await stable.getAddress(), 1n);
    await expectRevert(
      lm.swap(routerAddr, await vol.getAddress(), amountIn, await stable.getAddress(), 0n, data),
      "SwapCapExceeded"
    );
  });

  it("reverts when an oracle is missing and oracle is required", async function () {
    const { lm, lmAddr, stable, vol, router, routerAddr } = await deployFixture();
    await lm.clearOracle(await vol.getAddress());
    const amountIn = ethersLib.parseEther("1");
    await vol.mint(lmAddr, amountIn);
    await stable.mint(routerAddr, 2000_000000n);
    const data = swapCalldata(router, await vol.getAddress(), amountIn, await stable.getAddress(), 2000_000000n);
    await expectRevert(
      lm.swap(routerAddr, await vol.getAddress(), amountIn, await stable.getAddress(), 0n, data),
      "OracleMissing"
    );
  });

  it("reverts on a stale oracle", async function () {
    const { lm, lmAddr, stable, vol, volFeed, router, routerAddr } = await deployFixture();
    await volFeed.setUpdatedAt(1n); // ancient timestamp
    const amountIn = ethersLib.parseEther("1");
    await vol.mint(lmAddr, amountIn);
    await stable.mint(routerAddr, 2000_000000n);
    const data = swapCalldata(router, await vol.getAddress(), amountIn, await stable.getAddress(), 2000_000000n);
    await expectRevert(
      lm.swap(routerAddr, await vol.getAddress(), amountIn, await stable.getAddress(), 0n, data),
      "StaleOracle"
    );
  });

  it("pulls excess inventory out of a receiver (respecting its floor)", async function () {
    const { ethers, owner, lm, lmAddr, receiver } = await deployFixture();
    await receiver.addLiquidity(NATIVE, 1000n, { value: 1000n });
    await receiver.setLiquidityFloor(NATIVE, 600n);

    await expectRevert(lm.pullFromReceiver(await receiver.getAddress(), NATIVE, 500n), "ReservedLiquidity");

    const before = await ethers.provider.getBalance(lmAddr);
    await lm.pullFromReceiver(await receiver.getAddress(), NATIVE, 400n);
    const after = await ethers.provider.getBalance(lmAddr);
    expect(after - before).to.equal(400n);
  });

  it("pushes inventory into a receiver", async function () {
    const { ethers, owner, lm, lmAddr, receiver, stable } = await deployFixture();
    const amount = 5000_000000n;
    await stable.mint(lmAddr, amount);

    await lm.pushToReceiver(await receiver.getAddress(), await stable.getAddress(), amount);
    expect(await stable.balanceOf(await receiver.getAddress())).to.equal(amount);
    expect(await stable.balanceOf(lmAddr)).to.equal(0n);
  });

  it("batches pull + swap + push atomically via rebalance", async function () {
    const { lm, lmAddr, receiver, stable, vol, router, routerAddr } = await deployFixture();

    // Receiver has excess VOL; manager pulls it, swaps to stable, pushes stable back.
    await vol.mint(await receiver.getAddress(), ethersLib.parseEther("1"));
    // fund the receiver as liquidity so withdrawExcess sees it as available (floor 0 default)
    // VOL was minted directly; receiver balance = available since floor is 0.
    await stable.mint(routerAddr, 2000_000000n);

    const swapData = swapCalldata(router, await vol.getAddress(), ethersLib.parseEther("1"), await stable.getAddress(), 2000_000000n);
    const actions = [
      {
        kind: 0, // Pull
        receiver: await receiver.getAddress(),
        router: ethersLib.ZeroAddress,
        tokenIn: await vol.getAddress(),
        tokenOut: ethersLib.ZeroAddress,
        amount: ethersLib.parseEther("1"),
        minOut: 0n,
        data: "0x",
      },
      {
        kind: 1, // Swap
        receiver: ethersLib.ZeroAddress,
        router: routerAddr,
        tokenIn: await vol.getAddress(),
        tokenOut: await stable.getAddress(),
        amount: ethersLib.parseEther("1"),
        minOut: 2000_000000n,
        data: swapData,
      },
      {
        kind: 2, // Push
        receiver: await receiver.getAddress(),
        router: ethersLib.ZeroAddress,
        tokenIn: await stable.getAddress(),
        tokenOut: ethersLib.ZeroAddress,
        amount: 2000_000000n,
        minOut: 0n,
        data: "0x",
      },
    ];

    await lm.rebalance(actions);

    expect(await stable.balanceOf(await receiver.getAddress())).to.equal(2000_000000n);
    expect(await vol.balanceOf(lmAddr)).to.equal(0n);
    expect(await stable.balanceOf(lmAddr)).to.equal(0n);
  });

  it("enforces pause and role restrictions", async function () {
    const { lm, lmAddr, outsider, recipient, stable, vol, router, routerAddr } = await deployFixture();
    const amountIn = ethersLib.parseEther("1");
    await vol.mint(lmAddr, amountIn);
    await stable.mint(routerAddr, 2000_000000n);
    const data = swapCalldata(router, await vol.getAddress(), amountIn, await stable.getAddress(), 2000_000000n);

    await lm.pause();
    await expectRevert(lm.swap(routerAddr, await vol.getAddress(), amountIn, await stable.getAddress(), 0n, data), "EnforcedPause");
    await lm.unpause();

    await expectRevert(
      lm.connect(outsider).swap(routerAddr, await vol.getAddress(), amountIn, await stable.getAddress(), 0n, data),
      "AccessControlUnauthorizedAccount"
    );
  });

  it("lets admin emergency-withdraw the reserve", async function () {
    const { lm, lmAddr, recipient, stable } = await deployFixture();
    await stable.mint(lmAddr, 1234n);
    await lm.emergencyWithdraw(await stable.getAddress(), recipient.address, 1234n);
    expect(await stable.balanceOf(recipient.address)).to.equal(1234n);
  });
});

async function expectRevert(promise: Promise<unknown>, reason: string) {
  try {
    await promise;
  } catch (error) {
    expect(String(error)).to.include(reason);
    return;
  }
  throw new Error(`Expected transaction to revert with ${reason}`);
}
