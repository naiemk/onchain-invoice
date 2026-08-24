import { expect } from "chai";
import { network } from "hardhat";
import { ethers as ethersLib } from "ethers";

describe("Wallet + pluggable recovery", function () {
  const QX = ethersLib.zeroPadValue("0x01", 32);
  const QY = ethersLib.zeroPadValue("0x02", 32);
  const QX2 = ethersLib.zeroPadValue("0x03", 32);
  const QY2 = ethersLib.zeroPadValue("0x04", 32);
  const QX3 = ethersLib.zeroPadValue("0x05", 32);
  const QY3 = ethersLib.zeroPadValue("0x06", 32);
  const TIMELOCK = 3600n;

  async function deployFixture(useHelper = false) {
    const { ethers } = (await network.create()) as Awaited<ReturnType<typeof network.create>> & {
      ethers: any;
    };
    const [owner, guardian, user, attacker] = await ethers.getSigners();

    const implName = useHelper ? "WalletTestHelper" : "Wallet";
    const WalletImpl = await ethers.getContractFactory(implName);
    const walletImpl = await WalletImpl.deploy();

    const Recovery = await ethers.getContractFactory("AdminGuardianRecovery");
    const recovery = await Recovery.deploy(guardian.address, owner.address);

    const Factory = await ethers.getContractFactory("WalletFactory");
    const factory = await Factory.deploy(
      await walletImpl.getAddress(),
      await recovery.getAddress(),
      TIMELOCK,
      owner.address
    );

    const salt = ethersLib.id(useHelper ? "wallet-salt-helper" : "wallet-salt-1");
    await factory.createAccount(QX, QY, salt);
    const walletAddress = await factory.predictAddress(salt);
    const wallet = await ethers.getContractAt(implName, walletAddress);

    return { ethers, owner, guardian, user, attacker, recovery, factory, wallet, walletAddress, implName };
  }

  it("creates wallet via factory with first owner", async function () {
    const { wallet } = await deployFixture();
    expect(await wallet.ownerCount()).to.equal(1n);
    expect(await wallet.isOwner(QX, QY)).to.equal(true);
    expect(await wallet.paused()).to.equal(false);
  });

  it("owner can add and remove passkey owners when not paused", async function () {
    const { wallet } = await deployFixture(true);
    await wallet.exposedAddOwner(QX2, QY2);
    expect(await wallet.ownerCount()).to.equal(2n);
    await wallet.exposedRemoveOwner(QX2, QY2);
    expect(await wallet.ownerCount()).to.equal(1n);
  });

  it("cannot remove last owner", async function () {
    const { wallet } = await deployFixture(true);
    await expectRevert(wallet.exposedRemoveOwner(QX, QY), "LastOwner");
  });

  it("recovery initiates pause and pending owner", async function () {
    const { wallet, recovery, guardian } = await deployFixture();
    const newOwner = ethersLib.AbiCoder.defaultAbiCoder().encode(["bytes32", "bytes32"], [QX3, QY3]);
    await recovery.connect(guardian).initiateOwnerRecovery(await wallet.getAddress(), newOwner);
    expect(await wallet.paused()).to.equal(true);
    const pending = await wallet.pendingOwner();
    expect(pending.active).to.equal(true);
    expect(pending.qx).to.equal(QX3);
    expect(pending.qy).to.equal(QY3);
  });

  it("owner cannot add while paused", async function () {
    const { wallet, recovery, guardian } = await deployFixture();
    const newOwner = ethersLib.AbiCoder.defaultAbiCoder().encode(["bytes32", "bytes32"], [QX3, QY3]);
    await recovery.connect(guardian).initiateOwnerRecovery(await wallet.getAddress(), newOwner);
    await expectRevert(wallet.addOwner(QX2, QY2), "AccountUnauthorized");
  });

  it("non-recovery cannot pause or recoveryAddOwner", async function () {
    const { wallet, attacker } = await deployFixture();
    await expectReverts(wallet.connect(attacker).pause());
    await expectReverts(wallet.connect(attacker).recoveryAddOwner(QX3, QY3));
  });

  it("executes pending owner after timelock", async function () {
    const { ethers, wallet, recovery, guardian } = await deployFixture();
    const newOwner = ethersLib.AbiCoder.defaultAbiCoder().encode(["bytes32", "bytes32"], [QX3, QY3]);
    await recovery.connect(guardian).initiateOwnerRecovery(await wallet.getAddress(), newOwner);
    await ethers.provider.send("evm_increaseTime", [Number(TIMELOCK + 1n)]);
    await ethers.provider.send("evm_mine", []);
    await recovery.executeOwnerRecovery(await wallet.getAddress());
    expect(await wallet.isOwner(QX3, QY3)).to.equal(true);
    expect(await wallet.paused()).to.equal(false);
    const pending = await wallet.pendingOwner();
    expect(pending.active).to.equal(false);
  });

  it("cancels pending owner when not paused path blocked during pause", async function () {
    const { wallet, recovery, guardian } = await deployFixture();
    const newOwner = ethersLib.AbiCoder.defaultAbiCoder().encode(["bytes32", "bytes32"], [QX3, QY3]);
    await recovery.connect(guardian).initiateOwnerRecovery(await wallet.getAddress(), newOwner);
    await expectRevert(wallet.cancelPendingOwner(), "WalletPaused");
  });

  it("guardian can authorize recovery metadata", async function () {
    const { wallet, recovery, guardian } = await deployFixture();
    const update = ethersLib.toUtf8Bytes("email:alice@example.com");
    await recovery.connect(guardian).authorizeRecoveryUpdate(await wallet.getAddress(), update);
    const stored = await wallet.recoveryMetadata();
    expect(ethersLib.hexlify(stored)).to.equal(ethersLib.hexlify(update));
  });

  it("non-guardian cannot initiate recovery", async function () {
    const { wallet, recovery, attacker } = await deployFixture();
    const newOwner = ethersLib.AbiCoder.defaultAbiCoder().encode(["bytes32", "bytes32"], [QX3, QY3]);
    await expectReverts(
      recovery.connect(attacker).initiateOwnerRecovery(await wallet.getAddress(), newOwner)
    );
  });
});

async function expectReverts(promise: Promise<unknown>): Promise<void> {
  try {
    await promise;
    expect.fail("expected revert");
  } catch {
    // expected
  }
}

async function expectRevert(promise: Promise<unknown>, fragment: string): Promise<void> {
  try {
    await promise;
    expect.fail(`expected revert containing ${fragment}`);
  } catch (error) {
    const message = (error instanceof Error ? error.message : String(error)).toLowerCase();
    expect(message).to.include(fragment.toLowerCase());
  }
}
