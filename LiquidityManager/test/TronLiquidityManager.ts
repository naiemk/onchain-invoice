import { expect } from "chai";
import { network } from "hardhat";
import { ethers as ethersLib } from "ethers";

const NATIVE = ethersLib.ZeroAddress;
const STALENESS = 3600n;

// Parity check: the TRON adapter reuses LiquidityManagerCore, so the guard + rebalance behaviour
// must match the EVM manager. Runs in the Hardhat EVM (no local TRON node), like the other TRON tests.
describe("TronLiquidityManager", function () {
  async function deployFixture() {
    const { ethers } = (await network.create()) as Awaited<ReturnType<typeof network.create>> & {
      ethers: any;
    };
    const [owner] = await ethers.getSigners();

    const LM = await ethers.getContractFactory("TronLiquidityManager");
    const lmImpl = await LM.deploy();
    const Proxy = await ethers.getContractFactory("ReceiverProxy");
    const lmProxy = await Proxy.deploy(
      await lmImpl.getAddress(),
      LM.interface.encodeFunctionData("initialize", [owner.address])
    );
    const lm = await ethers.getContractAt("TronLiquidityManager", await lmProxy.getAddress());
    const lmAddr = await lm.getAddress();

    const FastSwap = await ethers.getContractFactory("TronFastSwapReceiver");
    const fsImpl = await FastSwap.deploy();
    const fsProxy = await Proxy.deploy(
      await fsImpl.getAddress(),
      FastSwap.interface.encodeFunctionData("initialize", [owner.address])
    );
    const receiver = await ethers.getContractAt("TronFastSwapReceiver", await fsProxy.getAddress());
    await receiver.grantRole(await receiver.REBALANCER_ROLE(), lmAddr);
    await receiver.grantRole(await receiver.LIQUIDITY_ROLE(), lmAddr);

    const Token = await ethers.getContractFactory("MockERC20");
    const usdt = await Token.deploy("Tron USDT", "USDT", 6);
    const Agg = await ethers.getContractFactory("MockAggregator");
    const usdtFeed = await Agg.deploy(1_0000_0000n); // $1
    const trxFeed = await Agg.deploy(2000_0000n); // $0.20

    const Router = await ethers.getContractFactory("MockSwapRouter");
    const router = await Router.deploy();
    const routerAddr = await router.getAddress();

    await lm.setOracle(await usdt.getAddress(), await usdtFeed.getAddress(), 8, 6, STALENESS);
    await lm.setOracle(NATIVE, await trxFeed.getAddress(), 8, 6, STALENESS); // TRX has 6 decimals
    await lm.setRouterAllowed(routerAddr, true);

    return { ethers, owner, lm, lmAddr, receiver, usdt, usdtFeed, trxFeed, router, routerAddr };
  }

  function swapCalldata(router: any, tokenIn: string, amountIn: bigint, tokenOut: string, amountOut: bigint) {
    return router.interface.encodeFunctionData("swap", [tokenIn, amountIn, tokenOut, amountOut]);
  }

  it("swaps TRX -> USDT within the oracle floor", async function () {
    const { owner, lm, lmAddr, usdt, router, routerAddr } = await deployFixture();
    const amountIn = 100_000000n; // 100 TRX @ $0.20 = $20
    const fairOut = 20_000000n; // 20 USDT

    await owner.sendTransaction({ to: lmAddr, value: amountIn });
    await usdt.mint(routerAddr, fairOut);

    const data = swapCalldata(router, NATIVE, amountIn, await usdt.getAddress(), fairOut);
    await lm.swap(routerAddr, NATIVE, amountIn, await usdt.getAddress(), fairOut, data);

    expect(await usdt.balanceOf(lmAddr)).to.equal(fairOut);
  });

  it("reverts a USDT -> TRX swap that breaches the oracle floor", async function () {
    const { owner, lm, lmAddr, usdt, router, routerAddr } = await deployFixture();
    const amountIn = 20_000000n; // 20 USDT -> fair 100 TRX
    const badOut = 90_000000n; // 10% short, cap is 2%

    await usdt.mint(lmAddr, amountIn);
    await owner.sendTransaction({ to: routerAddr, value: badOut });

    const data = swapCalldata(router, await usdt.getAddress(), amountIn, NATIVE, badOut);
    await expectRevert(lm.swap(routerAddr, await usdt.getAddress(), amountIn, NATIVE, 0n, data), "OracleDeviation");
  });

  it("pulls excess and pushes inventory on a Tron receiver", async function () {
    const { lm, lmAddr, receiver, usdt } = await deployFixture();

    // push: manager funds the receiver with USDT
    await usdt.mint(lmAddr, 5_000000n);
    await lm.pushToReceiver(await receiver.getAddress(), await usdt.getAddress(), 5_000000n);
    expect(await usdt.balanceOf(await receiver.getAddress())).to.equal(5_000000n);

    // pull: manager pulls the excess back (floor 0)
    await lm.pullFromReceiver(await receiver.getAddress(), await usdt.getAddress(), 2_000000n);
    expect(await usdt.balanceOf(lmAddr)).to.equal(2_000000n);
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
