import { expect } from "chai";
import { network } from "hardhat";
import { deriveIdentityWalletSalt, predictWalletAddress } from "../commerce/shared/wallet-address.js";
import { randomIdentityId } from "../commerce/shared/identity-store.js";
import { simulatePasskey } from "./helpers/identity-signing.js";

describe("IdentityWallet counterfactual address", function () {
  it("deriveIdentityWalletSalt is deterministic", function () {
    const id = randomIdentityId();
    const a = deriveIdentityWalletSalt(id, 0);
    const b = deriveIdentityWalletSalt(id, 0);
    expect(a).to.equal(b);
    expect(deriveIdentityWalletSalt(id, 1)).to.not.equal(a);
  });

  it("predictWalletAddress matches factory before deploy", async function () {
    const { ethers } = (await network.create()) as Awaited<ReturnType<typeof network.create>> & { ethers: any };
    const [owner] = await ethers.getSigners();
    const key = simulatePasskey();
    const identityId = randomIdentityId();
    const Store = await ethers.getContractFactory("IdentityStore");
    const store = await Store.deploy(owner.address, owner.address);
    await store.register(identityId, key.qx, key.qy);
    const Impl = await ethers.getContractFactory("IdentityWallet");
    const impl = await Impl.deploy();
    const Factory = await ethers.getContractFactory("IdentityWalletFactory");
    const factory = await Factory.deploy(await impl.getAddress(), await store.getAddress(), owner.address);
    const factoryAddr = await factory.getAddress();
    const implAddr = await impl.getAddress();
    const salt = deriveIdentityWalletSalt(identityId, 0);
    const predictedOffchain = predictWalletAddress(factoryAddr, implAddr, salt);
    const predictedOnchain = await factory.predictAddress(salt);
    expect(predictedOffchain.toLowerCase()).to.equal(predictedOnchain.toLowerCase());
    const code = await ethers.provider.getCode(predictedOffchain);
    expect(code).to.equal("0x");
  });
});
