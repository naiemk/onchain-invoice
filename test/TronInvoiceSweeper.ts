import { expect } from "chai";
import { network } from "hardhat";
import { ethers as ethersLib } from "ethers";

describe("Tron invoice contracts", function () {
  async function deployFixture() {
    const { ethers } = (await network.create()) as Awaited<ReturnType<typeof network.create>> & {
      ethers: any;
    };
    const [owner, payer] = await ethers.getSigners();

    const Receiver = await ethers.getContractFactory("RecordingTronReceiver");
    const receiverImplementation = await Receiver.deploy();

    const Proxy = await ethers.getContractFactory("ReceiverProxy");
    const receiverProxy = await Proxy.deploy(
      await receiverImplementation.getAddress(),
      Receiver.interface.encodeFunctionData("initialize", [owner.address])
    );
    const receiver = await ethers.getContractAt("RecordingTronReceiver", await receiverProxy.getAddress());

    const Forwarder = await ethers.getContractFactory("TronForwarder");
    const forwarder = await Forwarder.deploy(await receiver.getAddress());

    const Sweeper = await ethers.getContractFactory("TronInvoiceSweeper");
    const sweeper = await Sweeper.deploy(await receiver.getAddress());

    const Token = await ethers.getContractFactory("MockERC20");
    const token = await Token.deploy("Mock TRC20", "MTRC", 6);

    return { ethers, owner, payer, receiver, forwarder, sweeper, token };
  }

  it("predicts Tron invoice addresses with the TVM CREATE2 prefix", async function () {
    const { sweeper } = await deployFixture();
    const invoiceId = ethersLib.id("tron-invoice:1");
    const forwarderImplementation = await sweeper.forwarderImplementation();
    const salt = ethersLib.keccak256(ethersLib.solidityPacked(["bytes32"], [invoiceId]));
    const expected = predictTronCloneAddress(forwarderImplementation, salt, await sweeper.getAddress());

    expect(await sweeper.getInvoiceAddress(invoiceId)).to.equal(expected);
  });

  it("sweeps prefunded TRX invoices into the receiver through the Tron forwarder", async function () {
    const { ethers, payer, receiver, forwarder } = await deployFixture();
    const data = ethersLib.toUtf8Bytes("tron-trx-invoice");
    const invoiceId = ethersLib.keccak256(data);
    const amount = 1_000_000n;
    const forwarderAddress = await forwarder.getAddress();

    await payer.sendTransaction({ to: forwarderAddress, value: amount });
    const tx = await forwarder.sweepTrx(invoiceId, data);
    await tx.wait();

    expect(await ethers.provider.getBalance(await receiver.getAddress())).to.equal(amount);
    expect(await receiver.lastInvoiceId()).to.equal(invoiceId);
    expect(await receiver.lastToken()).to.equal(ethersLib.ZeroAddress);
    expect(await receiver.lastAmount()).to.equal(amount);
    expect(await receiver.lastData()).to.equal(ethersLib.hexlify(data));

    const payment = await receiver.invoicePayment(invoiceId);
    expect(payment.token).to.equal(ethersLib.ZeroAddress);
    expect(payment.amount).to.equal(amount);
    expect(payment.forwarder).to.equal(forwarderAddress);
    expect(payment.paid).to.equal(true);
  });

  it("sweeps TRC20 invoices into the receiver through the Tron forwarder", async function () {
    const { receiver, forwarder, token } = await deployFixture();
    const data = ethersLib.toUtf8Bytes("tron-trc20-invoice");
    const invoiceId = ethersLib.keccak256(data);
    const amount = 42_000_000n;
    const tokenAddress = await token.getAddress();
    const forwarderAddress = await forwarder.getAddress();

    await token.mint(forwarderAddress, amount);
    const tx = await forwarder.sweepToken(tokenAddress, invoiceId, data);
    await tx.wait();

    expect(await token.balanceOf(await receiver.getAddress())).to.equal(amount);
    expect(await receiver.lastInvoiceId()).to.equal(invoiceId);
    expect(await receiver.lastToken()).to.equal(tokenAddress);
    expect(await receiver.lastAmount()).to.equal(amount);

    const payment = await receiver.invoicePayment(invoiceId);
    expect(payment.token).to.equal(tokenAddress);
    expect(payment.amount).to.equal(amount);
    expect(payment.forwarder).to.equal(forwarderAddress);
    expect(payment.paid).to.equal(true);
  });

  it("rejects mismatched Tron invoice data", async function () {
    const { payer, receiver, forwarder } = await deployFixture();
    const correctData = ethersLib.toUtf8Bytes("correct tron terms");
    const wrongData = ethersLib.toUtf8Bytes("wrong tron terms");
    const invoiceId = ethersLib.keccak256(correctData);

    await payer.sendTransaction({ to: await forwarder.getAddress(), value: 1n });

    await expectRevert(forwarder.sweepTrx(invoiceId, wrongData), "InvalidInvoiceData");
    expect(await receiver.handledCount()).to.equal(0n);
  });

  it("rejects overwriting a Tron invoice payment assignment", async function () {
    const { payer, receiver, forwarder } = await deployFixture();
    const data = ethersLib.toUtf8Bytes("single tron assignment");
    const invoiceId = ethersLib.keccak256(data);
    const forwarderAddress = await forwarder.getAddress();

    await payer.sendTransaction({ to: forwarderAddress, value: 1n });
    await forwarder.sweepTrx(invoiceId, data);
    await payer.sendTransaction({ to: forwarderAddress, value: 1n });

    await expectRevert(forwarder.sweepTrx(invoiceId, data), "InvoiceAlreadyPaid");
    expect(await receiver.handledCount()).to.equal(1n);
  });

  it("allows the owner to upgrade the Tron receiver through UUPS", async function () {
    const { ethers, receiver } = await deployFixture();
    const Receiver = await ethers.getContractFactory("RecordingTronReceiver");
    const nextImplementation = await Receiver.deploy();

    const tx = await receiver.upgradeToAndCall(await nextImplementation.getAddress(), "0x");
    await tx.wait();

    await expectRevert(receiver.proxiableUUID(), "UUPSUnauthorizedCallContext");
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

function predictTronCloneAddress(implementation: string, salt: string, deployer: string) {
  const bytecodeHash = ethersLib.keccak256(
    ethersLib.concat([
      "0x3d602d80600a3d3981f3",
      "0x363d3d373d3d3d363d73",
      implementation,
      "0x5af43d82803e903d91602b57fd5bf3",
    ])
  );

  return ethersLib.getAddress(
    `0x${ethersLib.keccak256(ethersLib.concat(["0x41", deployer, salt, bytecodeHash])).slice(-40)}`
  );
}
