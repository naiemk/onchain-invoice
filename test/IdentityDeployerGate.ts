import { expect } from "chai";
import { keccak256, toUtf8Bytes, ZeroAddress } from "ethers";
import { network } from "hardhat";
import { deployIdentityIfReady } from "../commerce/wallet-deployer/worker.js";
import { METHOD_WEBAUTHN, randomIdentityId } from "../commerce/shared/identity-store.js";
import { identityPasskeyBlob, simulatePasskey } from "./helpers/identity-signing.js";

describe("identity deployer second-method gate", function () {
  it("leaves a one-method funded wallet undeployed, then deploys after the second method", async function () {
    const { ethers } = (await network.create()) as Awaited<ReturnType<typeof network.create>> & { ethers: any };
    const [owner] = await ethers.getSigners();
    const Store = await ethers.getContractFactory("IdentityStore");
    const store = await Store.deploy(owner.address, owner.address);
    await store.waitForDeployment();
    const Impl = await ethers.getContractFactory("IdentityWallet");
    const impl = await Impl.deploy();
    await impl.waitForDeployment();
    const Factory = await ethers.getContractFactory("IdentityWalletFactory");
    const factory = await Factory.deploy(await impl.getAddress(), await store.getAddress(), owner.address);
    await factory.waitForDeployment();
    const Token = await ethers.getContractFactory("MockERC20");
    const token = await Token.deploy("USD Coin", "USDC", 6);
    await token.waitForDeployment();

    const identityId = randomIdentityId();
    const first = simulatePasskey();
    await store.register(identityId, first.qx, first.qy);
    const salt = keccak256(toUtf8Bytes("deploy-gate"));
    const address = await factory.predictAddress(salt);
    await token.mint(address, 2_000_000n);

    const provider = ethers.provider;
    expect(await deployIdentityIfReady(factory, identityId, salt)).to.equal("needs_second_method");
    expect(await provider.getCode(address)).to.equal("0x");

    const second = simulatePasskey();
    const digest = await store.hashAddMethod(identityId, METHOD_WEBAUTHN, second.qx, second.qy, ZeroAddress);
    await store.addMethod(
      identityId,
      METHOD_WEBAUTHN,
      second.qx,
      second.qy,
      ZeroAddress,
      identityPasskeyBlob({ identityId, key: first, message: digest })
    );

    expect(await provider.getCode(address)).to.equal("0x");
    expect(await deployIdentityIfReady(factory, identityId, salt)).to.equal("deployed");
    expect(await provider.getCode(address)).to.not.equal("0x");
    expect(BigInt(await token.balanceOf(address))).to.equal(2_000_000n);
  });
});
