import { expect } from "chai";
import { network } from "hardhat";
import { ethers as ethersLib } from "ethers";
import { deriveWalletSalt, predictWalletAddress } from "../commerce/shared/wallet-address.js";

describe("Wallet counterfactual address", function () {
  const QX = ethersLib.zeroPadValue("0x01", 32);
  const QY = ethersLib.zeroPadValue("0x02", 32);

  it("deriveWalletSalt is deterministic", function () {
    const a = deriveWalletSalt(QX, QY);
    const b = deriveWalletSalt(QX, QY);
    expect(a).to.equal(b);
  });

  it("predictWalletAddress matches factory before deploy", async function () {
    const { ethers } = (await network.create()) as Awaited<ReturnType<typeof network.create>> & { ethers: any };
    const [owner] = await ethers.getSigners();
    const WalletImpl = await ethers.getContractFactory("Wallet");
    const walletImpl = await WalletImpl.deploy();
    const Recovery = await ethers.getContractFactory("AdminGuardianRecovery");
    const recovery = await Recovery.deploy(owner.address, owner.address);
    const Factory = await ethers.getContractFactory("WalletFactory");
    const factory = await Factory.deploy(
      await walletImpl.getAddress(),
      await recovery.getAddress(),
      3600n,
      owner.address
    );
    const factoryAddr = await factory.getAddress();
    const implAddr = await walletImpl.getAddress();
    const salt = deriveWalletSalt(QX, QY);
    const predictedOffchain = predictWalletAddress(factoryAddr, implAddr, salt);
    const predictedOnchain = await factory.predictAddress(salt);
    expect(predictedOffchain.toLowerCase()).to.equal(predictedOnchain.toLowerCase());
    const code = await ethers.provider.getCode(predictedOffchain);
    expect(code).to.equal("0x");
  });

  it("createAccount is idempotent", async function () {
    const { ethers } = (await network.create()) as Awaited<ReturnType<typeof network.create>> & { ethers: any };
    const [owner] = await ethers.getSigners();
    const WalletImpl = await ethers.getContractFactory("Wallet");
    const walletImpl = await WalletImpl.deploy();
    const Recovery = await ethers.getContractFactory("AdminGuardianRecovery");
    const recovery = await Recovery.deploy(owner.address, owner.address);
    const Factory = await ethers.getContractFactory("WalletFactory");
    const factory = await Factory.deploy(
      await walletImpl.getAddress(),
      await recovery.getAddress(),
      3600n,
      owner.address
    );
    const salt = deriveWalletSalt(QX, QY);
    const addr1 = await factory.createAccount.staticCall(QX, QY, salt);
    await factory.createAccount(QX, QY, salt);
    const addr2 = await factory.createAccount.staticCall(QX, QY, salt);
    expect(addr1.toLowerCase()).to.equal(addr2.toLowerCase());
    const code = await ethers.provider.getCode(addr1);
    expect(code.length).to.be.greaterThan(2);
  });
});
