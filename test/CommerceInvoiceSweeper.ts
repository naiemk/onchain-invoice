import { expect } from "chai";
import { network } from "hardhat";
import { ethers as ethersLib } from "ethers";

describe("CommerceInvoiceSweeper", function () {
  async function deployFixture() {
    const { ethers } = (await network.create()) as Awaited<ReturnType<typeof network.create>> & {
      ethers: any;
    };
    const [owner, feeRecipient, merchant, payer, other] = await ethers.getSigners();

    const Deployer = await ethers.getContractFactory("CommerceSystemDeployer");
    const systemDeployer = await Deployer.deploy();
    const feeBps = 50; // 0.5%
    const tx = await systemDeployer.deploy(feeRecipient.address, feeBps, owner.address);
    const receipt = await tx.wait();
    const deployed = receipt?.logs
      .map((log: any) => {
        try {
          return systemDeployer.interface.parseLog(log);
        } catch {
          return null;
        }
      })
      .find((log: any) => log?.name === "CommerceSystemDeployed");

    const sweeper = await ethers.getContractAt("CommerceInvoiceSweeper", deployed.args.sweeper);

    const Token = await ethers.getContractFactory("MockERC20");
    const token = await Token.deploy("USD Coin", "USDC", 6);

    return { ethers, owner, feeRecipient, merchant, payer, other, sweeper, token, feeBps };
  }

  it("predicts invoice addresses from to + invoiceId salt", async function () {
    const { ethers, sweeper, merchant } = await deployFixture();
    const invoiceId = ethersLib.id("inv-1");

    const a = await sweeper.getInvoiceAddress(merchant.address, invoiceId);
    const b = await sweeper.getInvoiceAddress(merchant.address, invoiceId);
    expect(a).to.equal(b);
    expect(await ethers.provider.getCode(a)).to.equal("0x");

    const otherTo = await sweeper.getInvoiceAddress(
      ethersLib.Wallet.createRandom().address,
      invoiceId
    );
    expect(otherTo).to.not.equal(a);
  });

  it("sweeps ETH to merchant minus 0.5% fee", async function () {
    const { ethers, feeRecipient, merchant, payer, sweeper } = await deployFixture();
    const invoiceId = ethersLib.id("eth-inv");
    const amount = ethersLib.parseEther("1");
    const invoiceAddress = await sweeper.getInvoiceAddress(merchant.address, invoiceId);

    await payer.sendTransaction({ to: invoiceAddress, value: amount });

    const merchantBefore = await ethers.provider.getBalance(merchant.address);
    const feeBefore = await ethers.provider.getBalance(feeRecipient.address);

    const tx = await sweeper.sweep(ethersLib.ZeroAddress, amount, merchant.address, invoiceId);
    await tx.wait();

    const fee = amount / 200n; // 0.5%
    expect(await ethers.provider.getBalance(merchant.address)).to.equal(merchantBefore + amount - fee);
    expect(await ethers.provider.getBalance(feeRecipient.address)).to.equal(feeBefore + fee);
    expect(await ethers.provider.getBalance(invoiceAddress)).to.equal(0n);
  });

  it("rejects redirect: wrong to cannot drain a funded invoice", async function () {
    const { ethers, merchant, payer, other, sweeper } = await deployFixture();
    const invoiceId = ethersLib.id("secure-inv");
    const amount = ethersLib.parseEther("0.5");
    const invoiceAddress = await sweeper.getInvoiceAddress(merchant.address, invoiceId);

    await payer.sendTransaction({ to: invoiceAddress, value: amount });

    // Sweep with attacker as `to` targets a different CREATE2 address (empty).
    await expectRevert(
      sweeper.sweep(ethersLib.ZeroAddress, amount, other.address, invoiceId),
      "InsufficientBalance"
    );

    expect(await ethers.provider.getBalance(invoiceAddress)).to.equal(amount);
  });

  it("sweeps ERC20 with min fee floor", async function () {
    const { feeRecipient, merchant, sweeper, token } = await deployFixture();
    const invoiceId = ethersLib.id("usdc-inv");
    const tokenAddress = await token.getAddress();
    const amount = 1_000_000n; // 1 USDC
    const minFee = 10_000n; // 0.01 USDC > 0.5% of 1 USDC (= 0.005)

    await sweeper.setMinFee(tokenAddress, minFee);
    const invoiceAddress = await sweeper.getInvoiceAddress(merchant.address, invoiceId);
    await token.mint(invoiceAddress, amount);

    await sweeper.sweep(tokenAddress, amount, merchant.address, invoiceId);

    expect(await token.balanceOf(merchant.address)).to.equal(amount - minFee);
    expect(await token.balanceOf(feeRecipient.address)).to.equal(minFee);
  });

  it("supports partial sweeps", async function () {
    const { ethers, merchant, payer, sweeper } = await deployFixture();
    const invoiceId = ethersLib.id("partial");
    const total = ethersLib.parseEther("1");
    const first = ethersLib.parseEther("0.4");
    const invoiceAddress = await sweeper.getInvoiceAddress(merchant.address, invoiceId);

    await payer.sendTransaction({ to: invoiceAddress, value: total });

    await sweeper.sweep(ethersLib.ZeroAddress, first, merchant.address, invoiceId);
    expect(await ethers.provider.getBalance(invoiceAddress)).to.equal(total - first);

    await sweeper.sweep(ethersLib.ZeroAddress, total - first, merchant.address, invoiceId);
    expect(await ethers.provider.getBalance(invoiceAddress)).to.equal(0n);
  });

  it("bulkSweep processes multiple invoices", async function () {
    const { ethers, merchant, payer, sweeper } = await deployFixture();
    const id1 = ethersLib.id("bulk-1");
    const id2 = ethersLib.id("bulk-2");
    const amount = ethersLib.parseEther("0.1");

    const a1 = await sweeper.getInvoiceAddress(merchant.address, id1);
    const a2 = await sweeper.getInvoiceAddress(merchant.address, id2);
    await payer.sendTransaction({ to: a1, value: amount });
    await payer.sendTransaction({ to: a2, value: amount });

    await sweeper.bulkSweep([
      { token: ethersLib.ZeroAddress, amount, to: merchant.address, invoiceId: id1 },
      { token: ethersLib.ZeroAddress, amount, to: merchant.address, invoiceId: id2 },
    ]);

    expect(await ethers.provider.getBalance(a1)).to.equal(0n);
    expect(await ethers.provider.getBalance(a2)).to.equal(0n);
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
