import { expect } from "chai";
import { network } from "hardhat";
import { ethers as ethersLib } from "ethers";

describe("TronFastSwapReceiver", function () {
  async function deployFixture() {
    const { ethers } = (await network.create()) as Awaited<ReturnType<typeof network.create>> & {
      ethers: any;
    };
    const [owner, payer, recipient, aggregator] = await ethers.getSigners();

    const FastSwap = await ethers.getContractFactory("TronFastSwapReceiver");
    const implementation = await FastSwap.deploy();
    const Proxy = await ethers.getContractFactory("ReceiverProxy");
    const proxy = await Proxy.deploy(
      await implementation.getAddress(),
      FastSwap.interface.encodeFunctionData("initialize", [owner.address])
    );
    const fastSwap = await ethers.getContractAt("TronFastSwapReceiver", await proxy.getAddress());

    const Token = await ethers.getContractFactory("MockERC20");
    const token = await Token.deploy("Mock TRC20", "MTRC", 6);

    const Sweeper = await ethers.getContractFactory("TronInvoiceSweeper");
    const sweeper = await Sweeper.deploy(await fastSwap.getAddress());

    const Forwarder = await ethers.getContractFactory("TronForwarder");
    const forwarder = await Forwarder.deploy(await fastSwap.getAddress());

    return { ethers, owner, payer, recipient, aggregator, fastSwap, token, sweeper, forwarder };
  }

  it("records a source-chain swap request through a Tron forwarder sweep", async function () {
    // The TronInvoiceSweeper predicts addresses with the TVM CREATE2 prefix (0x41), which does not
    // match EVM hardhat's 0xff prefix, so we sweep through a directly-deployed forwarder here.
    const { payer, recipient, fastSwap, forwarder } = await deployFixture();
    const sourceAmount = 1_000_000n;
    const targetAmount = 950_000n;
    const data = encodeIntent({ sourceAmount, targetAmount, recipient: recipient.address });
    const invoiceId = ethersLib.keccak256(data);

    await payer.sendTransaction({ to: await forwarder.getAddress(), value: sourceAmount });
    await forwarder.sweepTrx(invoiceId, data);

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

  it("pays out TRC20 target tokens from liquidity", async function () {
    const { recipient, fastSwap, token } = await deployFixture();
    const targetAmount = 5_000_000n;
    const tokenAddress = await token.getAddress();
    const data = encodeIntent({ targetAmount, recipient: recipient.address, targetToken: tokenAddress });
    const swapId = ethersLib.keccak256(data);

    await token.mint(await fastSwap.getAddress(), targetAmount);
    await fastSwap.relaySwap(data);

    const state = await fastSwap.swapState(swapId);
    expect(state.processed).to.equal(true);
    expect(await token.balanceOf(recipient.address)).to.equal(targetAmount);
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
  targetToken?: string;
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
        targetToken: overrides.targetToken ?? ethersLib.ZeroAddress,
        targetAmount: overrides.targetAmount ?? 1n,
        recipient: overrides.recipient,
        expiresAt: Math.floor(Date.now() / 1000) + 3600,
        refundAddress: overrides.recipient,
      },
    ]
  );
}
