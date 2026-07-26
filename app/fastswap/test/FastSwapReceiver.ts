import { expect } from "chai";
import { network } from "hardhat";
import { ethers as ethersLib } from "ethers";

describe("FastSwapReceiver", function () {
  async function deployFixture() {
    const { ethers } = (await network.create()) as Awaited<ReturnType<typeof network.create>> & {
      ethers: any;
    };
    const [owner, payer, recipient, aggregator] = await ethers.getSigners();

    const FastSwap = await ethers.getContractFactory("FastSwapReceiver");
    const implementation = await FastSwap.deploy();
    const Proxy = await ethers.getContractFactory("ReceiverProxy");
    const proxy = await Proxy.deploy(
      await implementation.getAddress(),
      FastSwap.interface.encodeFunctionData("initialize", [owner.address])
    );
    const fastSwap = await ethers.getContractAt("FastSwapReceiver", await proxy.getAddress());

    const Token = await ethers.getContractFactory("MockERC20");
    const token = await Token.deploy("Mock Token", "MOCK", 18);

    const Sweeper = await ethers.getContractFactory("InvoiceSweeper");
    const sweeper = await Sweeper.deploy(await fastSwap.getAddress());

    return { ethers, owner, payer, recipient, aggregator, fastSwap, token, sweeper };
  }

  it("records a source-chain swap request through invoice sweep", async function () {
    const { payer, recipient, fastSwap, sweeper } = await deployFixture();
    const sourceAmount = ethersLib.parseEther("1");
    const targetAmount = ethersLib.parseEther("0.95");
    const data = encodeIntent({
      sourceAmount,
      targetAmount,
      recipient: recipient.address,
    });
    const invoiceId = ethersLib.keccak256(data);
    const invoiceAddress = await sweeper.getInvoiceAddress(invoiceId);

    await payer.sendTransaction({ to: invoiceAddress, value: sourceAmount });
    await sweeper.sweepEth(invoiceId, data);

    const state = await fastSwap.swapState(invoiceId);
    expect(state.requested).to.equal(true);
    expect(state.paidAmount).to.equal(sourceAmount);
    expect(state.intent.targetAmount).to.equal(targetAmount);
  });

  it("relays and processes immediately when target liquidity exists", async function () {
    const { ethers, recipient, fastSwap } = await deployFixture();
    const targetAmount = 1000n;
    const data = encodeIntent({ targetAmount, recipient: recipient.address });
    const swapId = ethersLib.keccak256(data);

    await fastSwap.addLiquidity(ethersLib.ZeroAddress, targetAmount, { value: targetAmount });
    await fastSwap.relaySwap(data);

    const state = await fastSwap.swapState(swapId);
    expect(state.relayed).to.equal(true);
    expect(state.processed).to.equal(true);
    expect(await ethers.provider.getBalance(await fastSwap.getAddress())).to.equal(0n);
  });

  it("queues relayed swaps when liquidity is missing and processes later", async function () {
    const { recipient, fastSwap } = await deployFixture();
    const targetAmount = 1000n;
    const data = encodeIntent({ targetAmount, recipient: recipient.address });
    const swapId = ethersLib.keccak256(data);

    await fastSwap.relaySwap(data);
    let state = await fastSwap.swapState(swapId);
    expect(state.queued).to.equal(true);
    expect(await fastSwap.queuedSwapCount()).to.equal(1n);

    await fastSwap.addLiquidity(ethersLib.ZeroAddress, targetAmount, { value: targetAmount });
    await fastSwap.processQueued(swapId);

    state = await fastSwap.swapState(swapId);
    expect(state.processed).to.equal(true);
    expect(state.queued).to.equal(false);
  });

  it("supports admin pause and sweep respecting liquidity floors", async function () {
    const { recipient, fastSwap } = await deployFixture();

    await fastSwap.addLiquidity(ethersLib.ZeroAddress, 1000n, { value: 1000n });
    await fastSwap.setLiquidityFloor(ethersLib.ZeroAddress, 600n);
    await expectRevert(fastSwap.adminSweep(ethersLib.ZeroAddress, recipient.address, 500n), "ReservedLiquidity");
    await fastSwap.adminSweep(ethersLib.ZeroAddress, recipient.address, 400n);

    await fastSwap.pause();
    const data = encodeIntent({ targetAmount: 1n, recipient: recipient.address });
    await expectRevert(fastSwap.relaySwap(data), "EnforcedPause");
    await fastSwap.unpause();
  });

  it("lets the rebalancer role withdraw only excess above the floor", async function () {
    const { owner, payer, recipient, fastSwap } = await deployFixture();

    await fastSwap.addLiquidity(ethersLib.ZeroAddress, 1000n, { value: 1000n });
    await fastSwap.setLiquidityFloor(ethersLib.ZeroAddress, 600n);

    const rebalancerRole = await fastSwap.REBALANCER_ROLE();
    expect(await fastSwap.hasRole(rebalancerRole, owner.address)).to.equal(true);

    await expectRevert(
      fastSwap.withdrawExcess(ethersLib.ZeroAddress, recipient.address, 500n),
      "ReservedLiquidity"
    );

    const before = await recipient.provider.getBalance(recipient.address);
    await fastSwap.withdrawExcess(ethersLib.ZeroAddress, recipient.address, 400n);
    const after = await recipient.provider.getBalance(recipient.address);
    expect(after - before).to.equal(400n);

    await expectRevert(
      fastSwap.connect(payer).withdrawExcess(ethersLib.ZeroAddress, recipient.address, 1n),
      "AccessControlUnauthorizedAccount"
    );
  });

  it("allows aggregate role to execute an aggregator call with excess funds", async function () {
    const { aggregator, fastSwap } = await deployFixture();
    await fastSwap.addLiquidity(ethersLib.ZeroAddress, 1000n, { value: 1000n });
    await fastSwap.setLiquidityFloor(ethersLib.ZeroAddress, 400n);
    await fastSwap.setAggregatorAllowed(aggregator.address, true);

    const before = await aggregator.provider.getBalance(aggregator.address);
    await fastSwap.aggregateAll(ethersLib.ZeroAddress, aggregator.address, "0x");
    const after = await aggregator.provider.getBalance(aggregator.address);

    expect(after - before).to.equal(600n);
  });
});

async function expectRevert(promise: Promise<unknown>, reason: string) {
  try {
    await promise;
  } catch (error) {
    expect(String(error)).to.include(reason);
    return;
  }
  throw new Error("Expected transaction to revert");
}

function encodeIntent(overrides: {
  sourceAmount?: bigint;
  targetAmount?: bigint;
  recipient: string;
}) {
  return ethersLib.AbiCoder.defaultAbiCoder().encode(
    [
      "tuple(uint8 version,bytes32 quoteId,uint256 sourceChainId,address sourceToken,uint256 sourceAmount,uint256 targetChainId,address targetToken,uint256 targetAmount,address recipient,uint64 expiresAt,address refundAddress)",
    ],
    [
      {
        version: 1,
        quoteId: ethersLib.id("quote"),
        sourceChainId: 1,
        sourceToken: ethersLib.ZeroAddress,
        sourceAmount: overrides.sourceAmount ?? 1n,
        targetChainId: 2,
        targetToken: ethersLib.ZeroAddress,
        targetAmount: overrides.targetAmount ?? 1n,
        recipient: overrides.recipient,
        expiresAt: Math.floor(Date.now() / 1000) + 3600,
        refundAddress: overrides.recipient,
      },
    ]
  );
}
