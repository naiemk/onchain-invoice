import { expect } from "chai";
import { network } from "hardhat";
import { ZeroAddress } from "ethers";

async function expectRevert(promise: Promise<unknown>, name: string): Promise<void> {
  try {
    await promise;
    expect.fail(`Expected revert ${name}`);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    expect(msg).to.include(name);
  }
}

describe("IdentityStoreTimelock", function () {
  it("blocks a direct EOA from store owner setters until the delay elapses", async function () {
    const { ethers } = (await network.create()) as Awaited<ReturnType<typeof network.create>> & { ethers: any };
    const [deployer, proposer, stranger, nextOperator] = await ethers.getSigners();
    const Store = await ethers.getContractFactory("IdentityStore");
    const store = await Store.deploy(deployer.address, deployer.address);
    await store.waitForDeployment();
    const Lock = await ethers.getContractFactory("IdentityStoreTimelock");
    const lock = await Lock.deploy(await store.getAddress(), proposer.address, 3600);
    await lock.waitForDeployment();
    await store.transferOwnership(await lock.getAddress());

    await expectRevert(store.connect(stranger).setRecoveryOperator.staticCall(nextOperator.address), "OwnableUnauthorizedAccount");
    await expectRevert(store.connect(deployer).setRestoreDelay.staticCall(1), "OwnableUnauthorizedAccount");
    await expectRevert(lock.connect(stranger).scheduleRecoveryOperator.staticCall(nextOperator.address), "NotProposer");

    await lock.connect(proposer).scheduleRecoveryOperator(nextOperator.address);
    await expectRevert(lock.executeRecoveryOperator.staticCall(nextOperator.address), "TimelockNotReady");
    await ethers.provider.send("evm_increaseTime", [3600]);
    await ethers.provider.send("evm_mine", []);
    await lock.executeRecoveryOperator(nextOperator.address);
    expect(await store.recoveryOperator()).to.equal(nextOperator.address);

    await lock.connect(proposer).scheduleRestoreDelay(259200);
    await ethers.provider.send("evm_increaseTime", [3600]);
    await ethers.provider.send("evm_mine", []);
    await lock.executeRestoreDelay(259200);
    expect(await store.restoreDelay()).to.equal(259200n);
    expect(ZeroAddress).to.not.equal(await lock.getAddress());
  });
});
