import { expect } from "chai";
import { network } from "hardhat";
import { zeroPadValue } from "ethers";
import {
  computeKeyId,
  encodeAdvancedSignature,
  KEY_EOA,
  KEY_WEBAUTHN,
} from "../commerce/shared/advanced-wallet.js";
import {
  eoaOwnerCoords,
  signEoaAddKey,
  signEoaAddOwner,
  signEoaUserOpTypedData,
} from "../commerce/shared/wallet-eip712.js";
import { getWalletContractFactory } from "./helpers/wallet-factory.js";

describe("Wallet EOA owners (EIP-712)", function () {
  const ADMIN_ENTITY = "0x" + "aa".repeat(32);
  const HARDHAT_KEYS = [
    "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
    "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
    "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
  ];

  async function deployHelper() {
    const { ethers } = (await network.create()) as Awaited<ReturnType<typeof network.create>> & { ethers: any };
    const [owner, eoaA, stranger] = await ethers.getSigners();
    const QX = zeroPadValue("0x01", 32);
    const QY = zeroPadValue("0x02", 32);

    const Helper = await getWalletContractFactory(ethers, "WalletAdvancedTestHelper");
    const walletImpl = await Helper.deploy();
    const Recovery = await ethers.getContractFactory("AdminGuardianRecovery");
    const recovery = await Recovery.deploy(owner.address, owner.address);
    const Factory = await ethers.getContractFactory("WalletFactory");
    const factory = await Factory.deploy(
      await walletImpl.getAddress(),
      await recovery.getAddress(),
      3600n,
      owner.address
    );
    const salt = ethers.id("wallet-eoa-owner");
    await factory.createAccount(QX, QY, salt);
    const walletAddress = await factory.predictAddress(salt);
    const wallet = await ethers.getContractAt("WalletAdvancedTestHelper", walletAddress);
    const { chainId } = await ethers.provider.getNetwork();

    return { ethers, wallet, walletAddress, owner, eoaA, stranger, QX, QY, chainId: BigInt(chainId) };
  }

  async function selfSigner(ethers: any, walletAddress: string) {
    await ethers.provider.send("hardhat_impersonateAccount", [walletAddress]);
    await ethers.provider.send("hardhat_setBalance", [walletAddress, "0x1000000000000000000"]);
    return ethers.getSigner(walletAddress);
  }

  async function expectRevert(promise: Promise<unknown>, fragment: string): Promise<void> {
    try {
      await promise;
      expect.fail(`Expected revert containing ${fragment}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      const extra = typeof err === "object" && err && "data" in err ? String((err as { data?: unknown }).data) : "";
      expect(`${msg} ${extra}`).to.include(fragment);
    }
  }

  describe("simple connect wallet", function () {
    it("binds AddOwner typed data then stores sentinel owner coords", async function () {
      const { ethers, wallet, walletAddress, eoaA, chainId } = await deployHelper();
      const self = await selfSigner(ethers, walletAddress);
      const owner = await eoaA.getAddress();
      const sig = await signEoaAddOwner(HARDHAT_KEYS[1], walletAddress, owner, chainId);
      await wallet.connect(self).addOwnerEoa(owner, sig);
      const { qx, qy } = eoaOwnerCoords(owner);
      expect(await wallet.isOwner(qx, qy)).to.equal(true);
    });

    it("rejects empty, wrong-owner, or wrong-domain AddOwner signatures", async function () {
      const { ethers, wallet, walletAddress, eoaA, stranger, chainId } = await deployHelper();
      const self = await selfSigner(ethers, walletAddress);
      const owner = await eoaA.getAddress();

      await expectRevert(wallet.connect(self).addOwnerEoa(owner, "0x"), "InvalidSignature");

      const wrongOwner = await signEoaAddOwner(HARDHAT_KEYS[2], walletAddress, owner, chainId);
      await expectRevert(wallet.connect(self).addOwnerEoa(owner, wrongOwner), "InvalidSignature");

      const otherWallet = await stranger.getAddress();
      const wrongDomain = await signEoaAddOwner(HARDHAT_KEYS[1], otherWallet, owner, chainId);
      await expectRevert(wallet.connect(self).addOwnerEoa(owner, wrongDomain), "InvalidSignature");
    });

    it("connected EOA signs UserOp typed data and rejects personal_sign", async function () {
      const { ethers, wallet, walletAddress, eoaA, chainId } = await deployHelper();
      const self = await selfSigner(ethers, walletAddress);
      const owner = await eoaA.getAddress();
      const bind = await signEoaAddOwner(HARDHAT_KEYS[1], walletAddress, owner, chainId);
      await wallet.connect(self).addOwnerEoa(owner, bind);

      const digest = ethers.id("simple-eoa-userop");
      const sig = await signEoaUserOpTypedData(HARDHAT_KEYS[1], walletAddress, digest, chainId);
      expect(await wallet.exposedValidateRaw(digest, sig)).to.equal(true);

      const personal = await eoaA.signMessage(ethers.getBytes(digest));
      expect(await wallet.exposedValidateRaw(digest, personal)).to.equal(false);
    });

    it("existing EOA owner can authorize adding a new passkey", async function () {
      const { ethers, wallet, walletAddress, eoaA, chainId } = await deployHelper();
      const self = await selfSigner(ethers, walletAddress);
      const owner = await eoaA.getAddress();
      const bind = await signEoaAddOwner(HARDHAT_KEYS[1], walletAddress, owner, chainId);
      await wallet.connect(self).addOwnerEoa(owner, bind);

      const digest = ethers.id("simple-eoa-add-passkey");
      const sig = await signEoaUserOpTypedData(HARDHAT_KEYS[1], walletAddress, digest, chainId);
      expect(await wallet.exposedValidateRaw(digest, sig)).to.equal(true);

      const newQx = zeroPadValue("0x11", 32);
      const newQy = zeroPadValue("0x22", 32);
      await wallet.connect(self).addOwner(newQx, newQy);
      expect(await wallet.isOwner(newQx, newQy)).to.equal(true);
    });
  });

  describe("advanced connect wallet", function () {
    it("enableAdvanced migrates sentinel EOA owners to KEY_EOA", async function () {
      const { ethers, wallet, walletAddress, eoaA, QX, QY, chainId } = await deployHelper();
      const self = await selfSigner(ethers, walletAddress);
      const owner = await eoaA.getAddress();
      const bind = await signEoaAddOwner(HARDHAT_KEYS[1], walletAddress, owner, chainId);
      await wallet.connect(self).addOwnerEoa(owner, bind);
      await wallet.exposedEnableAdvanced(ADMIN_ENTITY);

      const eoaKeyId = computeKeyId(ADMIN_ENTITY, KEY_EOA, zeroPadValue("0x00", 32), zeroPadValue("0x00", 32), owner);
      const eoaRec = await wallet.getKeyRecord(eoaKeyId);
      expect(Number(eoaRec.keyType)).to.equal(KEY_EOA);
      expect(eoaRec.eoa.toLowerCase()).to.equal(owner.toLowerCase());

      const passkeyId = computeKeyId(ADMIN_ENTITY, KEY_WEBAUTHN, QX, QY, "0x0000000000000000000000000000000000000000");
      const passRec = await wallet.getKeyRecord(passkeyId);
      expect(Number(passRec.keyType)).to.equal(KEY_WEBAUTHN);
    });

    it("binds AddKey typed data on the current identity then validates UserOp", async function () {
      const { ethers, wallet, walletAddress, eoaA, chainId } = await deployHelper();
      await wallet.exposedEnableAdvanced(ADMIN_ENTITY);
      const self = await selfSigner(ethers, walletAddress);
      const owner = await eoaA.getAddress();

      const wrong = await signEoaAddOwner(HARDHAT_KEYS[1], walletAddress, owner, chainId);
      await expectRevert(wallet.connect(self).addKeyEoa(ADMIN_ENTITY, owner, wrong), "InvalidSignature");

      const bind = await signEoaAddKey(HARDHAT_KEYS[1], walletAddress, ADMIN_ENTITY, owner, chainId);
      await wallet.connect(self).addKeyEoa(ADMIN_ENTITY, owner, bind);

      const keyId = computeKeyId(ADMIN_ENTITY, KEY_EOA, zeroPadValue("0x00", 32), zeroPadValue("0x00", 32), owner);
      const rec = await wallet.getKeyRecord(keyId);
      expect(rec.eoa.toLowerCase()).to.equal(owner.toLowerCase());
      expect(rec.entityId).to.equal(ADMIN_ENTITY);

      const digest = ethers.id("advanced-eoa-userop");
      const userOpSig = await signEoaUserOpTypedData(HARDHAT_KEYS[1], walletAddress, digest, chainId);
      const packed = encodeAdvancedSignature([{ keyId, sig: userOpSig }]);
      expect(await wallet.exposedValidateAdvanced(digest, packed)).to.equal(true);

      const personal = await eoaA.signMessage(ethers.getBytes(digest));
      const packedPersonal = encodeAdvancedSignature([{ keyId, sig: personal }]);
      expect(await wallet.exposedValidateAdvanced(digest, packedPersonal)).to.equal(false);
    });

    it("existing EOA key can authorize adding a new passkey on the identity", async function () {
      const { ethers, wallet, walletAddress, eoaA, chainId } = await deployHelper();
      await wallet.exposedEnableAdvanced(ADMIN_ENTITY);
      const self = await selfSigner(ethers, walletAddress);
      const owner = await eoaA.getAddress();
      const bind = await signEoaAddKey(HARDHAT_KEYS[1], walletAddress, ADMIN_ENTITY, owner, chainId);
      await wallet.connect(self).addKeyEoa(ADMIN_ENTITY, owner, bind);

      const digest = ethers.id("advanced-eoa-add-passkey");
      const sig = await signEoaUserOpTypedData(HARDHAT_KEYS[1], walletAddress, digest, chainId);
      const keyId = computeKeyId(ADMIN_ENTITY, KEY_EOA, zeroPadValue("0x00", 32), zeroPadValue("0x00", 32), owner);
      expect(await wallet.exposedValidateAdvanced(digest, encodeAdvancedSignature([{ keyId, sig }]))).to.equal(true);

      const newQx = zeroPadValue("0x33", 32);
      const newQy = zeroPadValue("0x44", 32);
      await wallet.exposedAddKey(ADMIN_ENTITY, KEY_WEBAUTHN, newQx, newQy, "0x0000000000000000000000000000000000000000");
      const passkeyId = computeKeyId(ADMIN_ENTITY, KEY_WEBAUTHN, newQx, newQy, "0x0000000000000000000000000000000000000000");
      expect((await wallet.getKeyRecord(passkeyId)).entityId).to.equal(ADMIN_ENTITY);
    });
  });
});
