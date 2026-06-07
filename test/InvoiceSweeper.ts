import { expect } from "chai";
import { network } from "hardhat";
import { ethers as ethersLib } from "ethers";

describe("InvoiceSweeper", function () {
  async function deployFixture() {
    const { ethers } = (await network.create()) as Awaited<ReturnType<typeof network.create>> & {
      ethers: any;
    };
    const [owner, payer] = await ethers.getSigners();

    const Receiver = await ethers.getContractFactory("RecordingReceiver");
    const receiverImplementation = await Receiver.deploy();

    const Proxy = await ethers.getContractFactory("ReceiverProxy");
    const receiverProxy = await Proxy.deploy(
      await receiverImplementation.getAddress(),
      Receiver.interface.encodeFunctionData("initialize", [owner.address])
    );
    const receiver = await ethers.getContractAt("RecordingReceiver", await receiverProxy.getAddress());

    const Sweeper = await ethers.getContractFactory("InvoiceSweeper");
    const sweeper = await Sweeper.deploy(await receiver.getAddress());

    const Token = await ethers.getContractFactory("MockERC20");
    const token = await Token.deploy("Mock Token", "MOCK", 18);

    return { ethers, owner, payer, receiver, sweeper, token };
  }

  it("predicts invoice addresses deterministically before deployment", async function () {
    const { ethers, sweeper } = await deployFixture();
    const invoiceId = ethersLib.id("invoice:1");

    const first = await sweeper.getInvoiceAddress(invoiceId);
    const second = await sweeper.getInvoiceAddress(invoiceId);

    expect(first).to.equal(second);
    expect(await ethers.provider.getCode(first)).to.equal("0x");
  });

  it("creates an invoice address without revealing invoice data", async function () {
    const { ethers, receiver, sweeper } = await deployFixture();
    const data = ethersLib.toUtf8Bytes("private invoice terms");
    const invoiceId = ethersLib.keccak256(data);
    const invoiceAddress = await sweeper.getInvoiceAddress(invoiceId);

    const tx = await sweeper.createInvoice(invoiceId);
    await tx.wait();

    expect(await ethers.provider.getCode(invoiceAddress)).not.to.equal("0x");
    expect(await receiver.handledCount()).to.equal(0n);
  });

  it("sweeps prefunded ETH invoices into the receiver", async function () {
    const { ethers, payer, receiver, sweeper } = await deployFixture();
    const data = ethersLib.toUtf8Bytes("ship-order-100");
    const amount = ethersLib.parseEther("1");
    const invoiceId = ethersLib.keccak256(data);
    const invoiceAddress = await sweeper.getInvoiceAddress(invoiceId);

    await payer.sendTransaction({ to: invoiceAddress, value: amount });

    const tx = await sweeper.sweepEth(invoiceId, data);
    await tx.wait();

    expect(await ethers.provider.getBalance(await receiver.getAddress())).to.equal(amount);
    expect(await receiver.lastInvoiceId()).to.equal(invoiceId);
    expect(await receiver.lastToken()).to.equal(ethersLib.ZeroAddress);
    expect(await receiver.lastAmount()).to.equal(amount);
    expect(await receiver.lastData()).to.equal(ethersLib.hexlify(data));

    const payment = await receiver.invoicePayment(invoiceId);
    expect(payment.token).to.equal(ethersLib.ZeroAddress);
    expect(payment.amount).to.equal(amount);
    expect(payment.forwarder).to.equal(invoiceAddress);
    expect(payment.paid).to.equal(true);
  });

  it("sweeps ERC20 invoices into the receiver", async function () {
    const { receiver, sweeper, token } = await deployFixture();
    const data = ethersLib.toUtf8Bytes("erc20-invoice");
    const amount = ethersLib.parseUnits("42", 18);
    const tokenAddress = await token.getAddress();
    const invoiceId = ethersLib.keccak256(data);
    const invoiceAddress = await sweeper.getInvoiceAddress(invoiceId);

    await token.mint(invoiceAddress, amount);

    const tx = await sweeper.sweepToken(invoiceId, tokenAddress, data);
    await tx.wait();

    expect(await token.balanceOf(await receiver.getAddress())).to.equal(amount);
    expect(await receiver.lastInvoiceId()).to.equal(invoiceId);
    expect(await receiver.lastToken()).to.equal(tokenAddress);
    expect(await receiver.lastAmount()).to.equal(amount);

    const payment = await receiver.invoicePayment(invoiceId);
    expect(payment.token).to.equal(tokenAddress);
    expect(payment.amount).to.equal(amount);
    expect(payment.forwarder).to.equal(invoiceAddress);
    expect(payment.paid).to.equal(true);
  });

  it("reverts the sweep when receiver invoice execution fails", async function () {
    const { payer, receiver, sweeper } = await deployFixture();
    const data = ethersLib.toUtf8Bytes("receiver-revert");
    const invoiceId = ethersLib.keccak256(data);
    const invoiceAddress = await sweeper.getInvoiceAddress(invoiceId);

    await payer.sendTransaction({ to: invoiceAddress, value: 1n });
    await receiver.setShouldRevert(true);

    await expectRevert(sweeper.sweepEth(invoiceId, data), "ForcedRevert");
  });

  it("rejects invoice execution with mismatched data", async function () {
    const { payer, receiver, sweeper } = await deployFixture();
    const correctData = ethersLib.toUtf8Bytes("correct terms");
    const wrongData = ethersLib.toUtf8Bytes("wrong terms");
    const invoiceId = ethersLib.keccak256(correctData);
    const invoiceAddress = await sweeper.getInvoiceAddress(invoiceId);

    await payer.sendTransaction({ to: invoiceAddress, value: 1n });

    await expectRevert(sweeper.sweepEth(invoiceId, wrongData), "InvalidInvoiceData");
    expect(await receiver.handledCount()).to.equal(0n);
  });

  it("rejects overwriting an invoice payment assignment", async function () {
    const { payer, receiver, sweeper } = await deployFixture();
    const data = ethersLib.toUtf8Bytes("single assignment");
    const invoiceId = ethersLib.keccak256(data);
    const invoiceAddress = await sweeper.getInvoiceAddress(invoiceId);

    await payer.sendTransaction({ to: invoiceAddress, value: 1n });
    await sweeper.sweepEth(invoiceId, data);
    await payer.sendTransaction({ to: invoiceAddress, value: 1n });

    await expectRevert(sweeper.sweepEth(invoiceId, data), "InvoiceAlreadyPaid");
    expect(await receiver.handledCount()).to.equal(1n);
  });

  it("executes invoice logic independently when data matches the invoice ID", async function () {
    const { receiver } = await deployFixture();
    const data = ethersLib.toUtf8Bytes("manual execution");
    const invoiceId = ethersLib.keccak256(data);

    const tx = await receiver.executeInvoice(invoiceId, ethersLib.ZeroAddress, 0n, data);
    await tx.wait();

    expect(await receiver.lastInvoiceId()).to.equal(invoiceId);
    expect(await receiver.lastData()).to.equal(ethersLib.hexlify(data));
  });

  it("allows the owner to upgrade the receiver through UUPS", async function () {
    const { ethers, receiver } = await deployFixture();
    const Receiver = await ethers.getContractFactory("RecordingReceiver");
    const nextImplementation = await Receiver.deploy();

    const tx = await receiver.upgradeToAndCall(await nextImplementation.getAddress(), "0x");
    await tx.wait();

    await expectRevert(receiver.proxiableUUID(), "UUPSUnauthorizedCallContext");
  });

  it("bulk executes mixed invoice sweeps", async function () {
    const { ethers, payer, receiver, sweeper, token } = await deployFixture();
    const ethData = ethersLib.toUtf8Bytes("bulk-eth");
    const tokenData = ethersLib.toUtf8Bytes("bulk-token");
    const tokenAddress = await token.getAddress();
    const ethInvoiceId = ethersLib.keccak256(ethData);
    const tokenInvoiceId = ethersLib.keccak256(tokenData);
    const ethAddress = await sweeper.getInvoiceAddress(ethInvoiceId);
    const tokenInvoiceAddress = await sweeper.getInvoiceAddress(tokenInvoiceId);

    await payer.sendTransaction({ to: ethAddress, value: 11n });
    await token.mint(tokenInvoiceAddress, 22n);

    await sweeper.bulkExecute([
      { invoiceId: ethInvoiceId, token: ethersLib.ZeroAddress, data: ethData },
      { invoiceId: tokenInvoiceId, token: tokenAddress, data: tokenData },
    ]);

    expect(await receiver.handledCount()).to.equal(2n);
    expect(await ethers.provider.getBalance(await receiver.getAddress())).to.equal(11n);
    expect(await token.balanceOf(await receiver.getAddress())).to.equal(22n);
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

