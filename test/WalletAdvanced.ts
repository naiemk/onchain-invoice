import { expect } from "chai";
import { network } from "hardhat";
import { zeroPadValue } from "ethers";
import {
  encodeAdvancedSignature,
  computeKeyId,
  KEY_EOA,
  KEY_YUBIKEY,
  KEY_WEBAUTHN,
  signEoaPersonalDigest,
} from "../commerce/shared/advanced-wallet.js";
import {
  ERC7821_BATCH_MODE,
  encodeBatch,
  encodeEnableAdvanced,
  buildFeeTransferCall,
  encodeErc20Transfer,
} from "../commerce/shared/userop.js";

describe("Wallet advanced entity M-of-N", function () {
  const ENTRYPOINT = "0x433709009B8330FDa32311DF1C2AFA402eD8D009";
  const ADMIN_ENTITY = "0x" + "aa".repeat(32);
  const ENTITY_B = "0x" + "bb".repeat(32);
  const ENTITY_C = "0x" + "cc".repeat(32);
  const ENTITY_VETO = "0x" + "dd".repeat(32);
  const HARDHAT_KEYS = [
    "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
    "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
    "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
    "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6",
    "0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a",
  ];

  async function deployHelper() {
    const { ethers } = (await network.create()) as Awaited<ReturnType<typeof network.create>> & { ethers: any };
    const [owner, eoaA, eoaB, eoaC, eoaVeto] = await ethers.getSigners();
    const QX = zeroPadValue("0x01", 32);
    const QY = zeroPadValue("0x02", 32);

    const Helper = await ethers.getContractFactory("WalletAdvancedTestHelper");
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
    const salt = ethers.id("wallet-advanced-test");
    await factory.createAccount(QX, QY, salt);
    const walletAddress = await factory.predictAddress(salt);
    const wallet = await ethers.getContractAt("WalletAdvancedTestHelper", walletAddress);

    return { ethers, wallet, owner, eoaA, eoaB, eoaC, eoaVeto, QX, QY };
  }

  async function selfSigner(ethers: any, wallet: { getAddress: () => Promise<string> }) {
    const walletAddress = await wallet.getAddress();
    await ethers.provider.send("hardhat_impersonateAccount", [walletAddress]);
    await ethers.provider.send("hardhat_setBalance", [walletAddress, "0x1000000000000000000"]);
    return ethers.getSigner(walletAddress);
  }

  it("enableAdvanced migrates passkeys and disables recovery", async function () {
    const { wallet, QX, QY } = await deployHelper();
    await wallet.exposedEnableAdvanced(ADMIN_ENTITY);
    expect(await wallet.advanced()).to.equal(true);
    expect(await wallet.threshold()).to.equal(1n);
    expect(await wallet.entityCount()).to.equal(1n);
    expect(await wallet.recoveryContract()).to.equal("0x0000000000000000000000000000000000000000");

    const keyId = computeKeyId(ADMIN_ENTITY, 0, QX, QY, "0x0000000000000000000000000000000000000000");
    const rec = await wallet.getKeyRecord(keyId);
    expect(rec.entityId).to.equal(ADMIN_ENTITY);
    expect(rec.qx).to.equal(QX);
    expect(rec.qy).to.equal(QY);
  });

  it("rejects simple addOwner when advanced", async function () {
    const { ethers, wallet } = await deployHelper();
    await wallet.exposedEnableAdvanced(ADMIN_ENTITY);
    const self = await selfSigner(ethers, wallet);
    await expectRevert(
      wallet.connect(self).addOwner(zeroPadValue("0x03", 32), zeroPadValue("0x04", 32)),
      "0xd19c36d2"
    );
  });

  it("validates 2-of-3 EOA entity signatures", async function () {
    const { ethers, wallet, eoaA, eoaB, eoaC } = await deployHelper();
    await wallet.exposedEnableAdvanced(ADMIN_ENTITY);

    await wallet.exposedAddEntity(ENTITY_B);
    await wallet.exposedAddEntity(ENTITY_C);

    const keyA = computeKeyId(ADMIN_ENTITY, KEY_EOA, zeroPadValue("0x00", 32), zeroPadValue("0x00", 32), await eoaA.getAddress());
    const keyB = computeKeyId(ENTITY_B, KEY_EOA, zeroPadValue("0x00", 32), zeroPadValue("0x00", 32), await eoaB.getAddress());
    const keyC = computeKeyId(ENTITY_C, KEY_EOA, zeroPadValue("0x00", 32), zeroPadValue("0x00", 32), await eoaC.getAddress());

    await wallet.exposedAddKey(ADMIN_ENTITY, KEY_EOA, zeroPadValue("0x00", 32), zeroPadValue("0x00", 32), await eoaA.getAddress());
    await wallet.exposedAddKey(ENTITY_B, KEY_EOA, zeroPadValue("0x00", 32), zeroPadValue("0x00", 32), await eoaB.getAddress());
    await wallet.exposedAddKey(ENTITY_C, KEY_EOA, zeroPadValue("0x00", 32), zeroPadValue("0x00", 32), await eoaC.getAddress());
    await wallet.exposedSetThreshold(2);

    const digest = ethers.id("user-op-hash");
    const sigA = await signEoaPersonalDigest(HARDHAT_KEYS[1], digest);
    const sigB = await signEoaPersonalDigest(HARDHAT_KEYS[2], digest);

    const packed = encodeAdvancedSignature([
      { keyId: keyA, sig: sigA },
      { keyId: keyB, sig: sigB },
    ]);
    expect(await wallet.exposedValidateAdvanced(digest, packed)).to.equal(true);

    const sigC = await signEoaPersonalDigest(HARDHAT_KEYS[3], digest);
    const onlyOne = encodeAdvancedSignature([{ keyId: keyC, sig: sigC }]);
    expect(await wallet.exposedValidateAdvanced(digest, onlyOne)).to.equal(false);
  });

  it("requires veto entity when veto set", async function () {
    const { ethers, wallet, eoaA, eoaB, eoaVeto } = await deployHelper();
    await wallet.exposedEnableAdvanced(ADMIN_ENTITY);
    await wallet.exposedAddEntity(ENTITY_B);
    await wallet.exposedAddEntity(ENTITY_VETO);

    await wallet.exposedAddKey(ADMIN_ENTITY, KEY_EOA, zeroPadValue("0x00", 32), zeroPadValue("0x00", 32), await eoaA.getAddress());
    await wallet.exposedAddKey(ENTITY_B, KEY_EOA, zeroPadValue("0x00", 32), zeroPadValue("0x00", 32), await eoaB.getAddress());
    await wallet.exposedAddKey(ENTITY_VETO, KEY_EOA, zeroPadValue("0x00", 32), zeroPadValue("0x00", 32), await eoaVeto.getAddress());
    await wallet.exposedSetThreshold(2);
    await wallet.exposedSetVeto(ENTITY_VETO, true);

    const digest = ethers.id("veto-test");
    const sigA = await signEoaPersonalDigest(HARDHAT_KEYS[1], digest);
    const sigB = await signEoaPersonalDigest(HARDHAT_KEYS[2], digest);
    const withoutVeto = encodeAdvancedSignature([
      { keyId: computeKeyId(ADMIN_ENTITY, KEY_EOA, zeroPadValue("0x00", 32), zeroPadValue("0x00", 32), await eoaA.getAddress()), sig: sigA },
      { keyId: computeKeyId(ENTITY_B, KEY_EOA, zeroPadValue("0x00", 32), zeroPadValue("0x00", 32), await eoaB.getAddress()), sig: sigB },
    ]);
    expect(await wallet.exposedValidateAdvanced(digest, withoutVeto)).to.equal(false);

    const sigV = await signEoaPersonalDigest(HARDHAT_KEYS[4], digest);
    const withVeto = encodeAdvancedSignature([
      { keyId: computeKeyId(ADMIN_ENTITY, KEY_EOA, zeroPadValue("0x00", 32), zeroPadValue("0x00", 32), await eoaA.getAddress()), sig: sigA },
      { keyId: computeKeyId(ENTITY_VETO, KEY_EOA, zeroPadValue("0x00", 32), zeroPadValue("0x00", 32), await eoaVeto.getAddress()), sig: sigV },
    ]);
    expect(await wallet.exposedValidateAdvanced(digest, withVeto)).to.equal(true);
  });

  it("configureMultisig replaces policy in one call", async function () {
    const { ethers, wallet, eoaA, eoaB } = await deployHelper();
    await wallet.exposedEnableAdvanced(ADMIN_ENTITY);
    const self = await selfSigner(ethers, wallet);

    const oldKeyId = computeKeyId(ADMIN_ENTITY, 0, zeroPadValue("0x01", 32), zeroPadValue("0x02", 32), "0x0000000000000000000000000000000000000000");
    const keyA = computeKeyId(ADMIN_ENTITY, KEY_EOA, zeroPadValue("0x00", 32), zeroPadValue("0x00", 32), await eoaA.getAddress());
    const keyB = computeKeyId(ENTITY_B, KEY_EOA, zeroPadValue("0x00", 32), zeroPadValue("0x00", 32), await eoaB.getAddress());

    await wallet.connect(self).configureMultisig(
      [oldKeyId],
      [ENTITY_B],
      [ADMIN_ENTITY, ENTITY_B],
      [KEY_EOA, KEY_EOA],
      [zeroPadValue("0x00", 32), zeroPadValue("0x00", 32)],
      [zeroPadValue("0x00", 32), zeroPadValue("0x00", 32)],
      [await eoaA.getAddress(), await eoaB.getAddress()],
      2,
      []
    );

    expect(await wallet.entityCount()).to.equal(2n);
    expect(await wallet.threshold()).to.equal(2n);
    expect((await wallet.getKeyRecord(keyA)).entityId).to.equal(ADMIN_ENTITY);
    expect((await wallet.getKeyRecord(keyB)).entityId).to.equal(ENTITY_B);
  });

  it("execute validation gas is lower than configureMultisig", async function () {
    const { ethers, wallet, eoaA, eoaB, eoaC, eoaVeto } = await deployHelper();
    await wallet.exposedEnableAdvanced(ADMIN_ENTITY);
    const self = await selfSigner(ethers, wallet);
    await wallet.exposedAddEntity(ENTITY_B);
    await wallet.exposedAddEntity(ENTITY_C);
    await wallet.exposedAddKey(ADMIN_ENTITY, KEY_EOA, zeroPadValue("0x00", 32), zeroPadValue("0x00", 32), await eoaA.getAddress());
    await wallet.exposedAddKey(ENTITY_B, KEY_EOA, zeroPadValue("0x00", 32), zeroPadValue("0x00", 32), await eoaB.getAddress());
    await wallet.exposedAddKey(ENTITY_C, KEY_EOA, zeroPadValue("0x00", 32), zeroPadValue("0x00", 32), await eoaC.getAddress());
    await wallet.exposedSetThreshold(2);

    const digest = ethers.id("gas-compare");
    const sigA = await signEoaPersonalDigest(HARDHAT_KEYS[1], digest);
    const sigB = await signEoaPersonalDigest(HARDHAT_KEYS[2], digest);
    const packed = encodeAdvancedSignature([
      { keyId: computeKeyId(ADMIN_ENTITY, KEY_EOA, zeroPadValue("0x00", 32), zeroPadValue("0x00", 32), await eoaA.getAddress()), sig: sigA },
      { keyId: computeKeyId(ENTITY_B, KEY_EOA, zeroPadValue("0x00", 32), zeroPadValue("0x00", 32), await eoaB.getAddress()), sig: sigB },
    ]);

    const validateGas = await wallet.exposedValidateAdvanced.estimateGas(digest, packed);
    const configureGas = await wallet.connect(self).configureMultisig.estimateGas(
      [],
      [ENTITY_VETO],
      [ENTITY_VETO],
      [KEY_EOA],
      [zeroPadValue("0x00", 32)],
      [zeroPadValue("0x00", 32)],
      [await eoaVeto.getAddress()],
      2,
      [ENTITY_VETO]
    );
    expect(validateGas).to.be.lessThan(configureGas);
  });

  it("KEY_YUBIKEY uses distinct keyId from KEY_WEBAUTHN", async function () {
    const { wallet } = await deployHelper();
    await wallet.exposedEnableAdvanced(ADMIN_ENTITY);
    const qx = zeroPadValue("0x05", 32);
    const qy = zeroPadValue("0x06", 32);
    await wallet.exposedAddKey(ADMIN_ENTITY, KEY_WEBAUTHN, qx, qy, "0x0000000000000000000000000000000000000000");
    await wallet.exposedAddKey(ADMIN_ENTITY, KEY_YUBIKEY, qx, qy, "0x0000000000000000000000000000000000000000");
    const webAuthnId = computeKeyId(ADMIN_ENTITY, KEY_WEBAUTHN, qx, qy, "0x0000000000000000000000000000000000000000");
    const yubiId = computeKeyId(ADMIN_ENTITY, KEY_YUBIKEY, qx, qy, "0x0000000000000000000000000000000000000000");
    expect(webAuthnId).to.not.equal(yubiId);
    expect(Number((await wallet.getKeyRecord(webAuthnId)).keyType)).to.equal(KEY_WEBAUTHN);
    expect(Number((await wallet.getKeyRecord(yubiId)).keyType)).to.equal(KEY_YUBIKEY);
  });

  it("enableAdvanced via EntryPoint execute batch (not helper)", async function () {
    const { ethers, wallet } = await deployHelper();
    await ethers.provider.send("hardhat_setBalance", [ENTRYPOINT, "0x1000000000000000000"]);
    await ethers.provider.send("hardhat_impersonateAccount", [ENTRYPOINT]);
    const epSigner = await ethers.getSigner(ENTRYPOINT);
    const walletAddress = await wallet.getAddress();
    const executionData = encodeBatch([
      { target: walletAddress, value: 0n, data: encodeEnableAdvanced(ADMIN_ENTITY) },
    ]);
    await wallet.connect(epSigner).execute(ERC7821_BATCH_MODE, executionData);
    expect(await wallet.advanced()).to.equal(true);
    expect(await wallet.threshold()).to.equal(1n);
  });

  it("EntryPoint executes fee+transfer batch in advanced mode with EOA sig validation", async function () {
    const { ethers, wallet, eoaA } = await deployHelper();
    await wallet.exposedEnableAdvanced(ADMIN_ENTITY);
    await wallet.exposedAddKey(
      ADMIN_ENTITY,
      KEY_EOA,
      zeroPadValue("0x00", 32),
      zeroPadValue("0x00", 32),
      await eoaA.getAddress()
    );

    const MockToken = await ethers.getContractFactory("MockFeeToken");
    const token = await MockToken.deploy();
    const tokenAddress = await token.getAddress();
    const BENEFICIARY = "0x1111111111111111111111111111111111111111";
    const RECIPIENT = "0x2222222222222222222222222222222222222222";
    const feeAmount = 100_000n;
    const sendAmount = 500_000n;
    const walletAddress = await wallet.getAddress();
    await token.mint(walletAddress, feeAmount + sendAmount);

    await ethers.provider.send("hardhat_setBalance", [ENTRYPOINT, "0x1000000000000000000"]);
    await ethers.provider.send("hardhat_impersonateAccount", [ENTRYPOINT]);
    const epSigner = await ethers.getSigner(ENTRYPOINT);

    const executionData = encodeBatch([
      buildFeeTransferCall(tokenAddress, BENEFICIARY, feeAmount),
      { target: tokenAddress, value: 0n, data: encodeErc20Transfer(RECIPIENT, sendAmount) },
    ]);
    await wallet.connect(epSigner).execute(ERC7821_BATCH_MODE, executionData);

    expect(await token.balanceOf(BENEFICIARY)).to.equal(feeAmount);
    expect(await token.balanceOf(RECIPIENT)).to.equal(sendAmount);

    const digest = ethers.id("advanced-userop-hash");
    const sig = await signEoaPersonalDigest(HARDHAT_KEYS[1], digest);
    const keyId = computeKeyId(
      ADMIN_ENTITY,
      KEY_EOA,
      zeroPadValue("0x00", 32),
      zeroPadValue("0x00", 32),
      await eoaA.getAddress()
    );
    const packed = encodeAdvancedSignature([{ keyId, sig }]);
    expect(await wallet.exposedValidateAdvanced(digest, packed)).to.equal(true);
  });
});

async function expectRevert(promise: Promise<unknown>, fragment: string): Promise<void> {
  try {
    await promise;
    expect.fail(`Expected revert containing ${fragment}`);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    expect(msg).to.include(fragment);
  }
}
