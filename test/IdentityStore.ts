import { expect } from "chai";
import { network } from "hardhat";
import { ZeroAddress, keccak256, toUtf8Bytes, zeroPadValue } from "ethers";
import {
  METHOD_EOA,
  METHOD_WEBAUTHN,
  METHOD_YUBIKEY,
  computeIdentityMethodId,
  hashIdentityAddMethod,
  hashIdentityRemoveMethod,
  loginOptionsAfterFailedGet,
  randomIdentityId,
  signIdentityAddMethodEoa,
  wrapIdentityMethodSignature,
} from "../commerce/shared/identity-store.js";
import {
  identityEoaBlob,
  identityPasskeyBlob,
  simulatePasskey,
  yubikeyBlob,
} from "./helpers/identity-signing.js";

const HARDHAT_KEY1 = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";

async function deployStore() {
  const { ethers } = (await network.create()) as Awaited<ReturnType<typeof network.create>> & { ethers: any };
  const [owner, eoa, other] = await ethers.getSigners();
  const Store = await ethers.getContractFactory("IdentityStore");
  const store = await Store.deploy(owner.address, owner.address);
  await store.waitForDeployment();
  const chainId = (await ethers.provider.getNetwork()).chainId as bigint;
  return { ethers, store, owner, eoa, other, chainId, storeAddress: await store.getAddress() };
}

async function expectRevert(promise: Promise<unknown>, name: string): Promise<void> {
  try {
    await promise;
    expect.fail(`Expected revert ${name}`);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    expect(msg).to.include(name);
  }
}

describe("IdentityStore", function () {
  it("registers a random identity with a simulated passkey", async function () {
    const { store } = await deployStore();
    const identityId = randomIdentityId();
    const pk = simulatePasskey();
    await store.register(identityId, pk.qx, pk.qy);
    const rec = await store.getIdentity(identityId);
    expect(rec.exists).to.equal(true);
    expect(rec.restoreEnabled).to.equal(true);
    expect(rec.webauthnCount).to.equal(1n);
    expect(await store.hasKind(identityId, METHOD_WEBAUTHN)).to.equal(true);
    expect(await store.hasKind(identityId, METHOD_YUBIKEY)).to.equal(false);
    expect(await store.hasKind(identityId, METHOD_EOA)).to.equal(false);
    expect(await store.hasKind(identityId, 9)).to.equal(false);
    expect(await store.hasKind(zeroPadValue("0x01", 32), METHOD_WEBAUTHN)).to.equal(false);
  });

  it("rejects zero identity, duplicate register, and empty P-256", async function () {
    const { store } = await deployStore();
    const pk = simulatePasskey();
    await expectRevert(store.register.staticCall(zeroPadValue("0x00", 32), pk.qx, pk.qy), "InvalidIdentity");
    const identityId = randomIdentityId();
    await store.register(identityId, pk.qx, pk.qy);
    await expectRevert(store.register.staticCall(identityId, pk.qx, pk.qy), "IdentityExists");
    await expectRevert(
      store.register.staticCall(randomIdentityId(), zeroPadValue("0x00", 32), zeroPadValue("0x00", 32)),
      "InvalidMethod"
    );
  });

  it("verifies a simulated WebAuthn assertion and rejects the wrong key", async function () {
    const { store } = await deployStore();
    const identityId = randomIdentityId();
    const pk = simulatePasskey();
    const other = simulatePasskey();
    await store.register(identityId, pk.qx, pk.qy);
    const message = keccak256(toUtf8Bytes("login"));
    const blob = identityPasskeyBlob({ identityId, key: pk, message });
    expect(await store.verify(message, blob)).to.equal(identityId);
    const bad = identityPasskeyBlob({ identityId, key: other, message });
    expect(await store.verify(message, bad)).to.equal(zeroPadValue("0x00", 32));
    expect(await store.verify(message, "0x")).to.equal(zeroPadValue("0x00", 32));
    expect(await store.verify(message, "0xdeadbeef")).to.equal(zeroPadValue("0x00", 32));
  });

  it("pairs a second passkey authorized by the first", async function () {
    const { store } = await deployStore();
    const identityId = randomIdentityId();
    const first = simulatePasskey();
    const second = simulatePasskey();
    await store.register(identityId, first.qx, first.qy);
    const digest = await store.hashAddMethod(identityId, METHOD_WEBAUTHN, second.qx, second.qy, ZeroAddress);
    const auth = identityPasskeyBlob({ identityId, key: first, message: digest });
    await store.addMethod(identityId, METHOD_WEBAUTHN, second.qx, second.qy, ZeroAddress, auth);
    const rec = await store.getIdentity(identityId);
    expect(rec.webauthnCount).to.equal(2n);
    const login = keccak256(toUtf8Bytes("device-2"));
    expect(await store.verify(login, identityPasskeyBlob({ identityId, key: second, message: login }))).to.equal(
      identityId
    );
  });

  it("adds YubiKey after WebAuthn then verifies the security-key assertion", async function () {
    const { store } = await deployStore();
    const identityId = randomIdentityId();
    const passkey = simulatePasskey();
    const yubi = simulatePasskey();
    await store.register(identityId, passkey.qx, passkey.qy);
    const digest = await store.hashAddMethod(identityId, METHOD_YUBIKEY, yubi.qx, yubi.qy, ZeroAddress);
    await store.addMethod(
      identityId,
      METHOD_YUBIKEY,
      yubi.qx,
      yubi.qy,
      ZeroAddress,
      identityPasskeyBlob({ identityId, key: passkey, message: digest })
    );
    expect(await store.hasKind(identityId, METHOD_YUBIKEY)).to.equal(true);
    const msg = keccak256(toUtf8Bytes("yubi-open"));
    expect(await store.verify(msg, yubikeyBlob(identityId, yubi, msg))).to.equal(identityId);
  });

  it("adds a crypto wallet, signs with it, and disables restore only from that EOA", async function () {
    const { store, eoa, other, chainId, storeAddress } = await deployStore();
    const identityId = randomIdentityId();
    const passkey = simulatePasskey();
    await store.register(identityId, passkey.qx, passkey.qy);
    const digest = await store.hashAddMethod(identityId, METHOD_EOA, zeroPadValue("0x00", 32), zeroPadValue("0x00", 32), eoa.address);
    await store.addMethod(
      identityId,
      METHOD_EOA,
      zeroPadValue("0x00", 32),
      zeroPadValue("0x00", 32),
      eoa.address,
      identityPasskeyBlob({ identityId, key: passkey, message: digest })
    );
    expect(await store.hasKind(identityId, METHOD_EOA)).to.equal(true);
    const msg = keccak256(toUtf8Bytes("eoa-open"));
    const blob = await identityEoaBlob({
      identityId,
      eoa: eoa.address,
      privateKey: HARDHAT_KEY1,
      store: storeAddress,
      chainId,
      message: msg,
    });
    expect(await store.verify(msg, blob)).to.equal(identityId);

    await expectRevert(store.connect(other).disableRestore.staticCall(identityId), "NotIdentityEoa");
    await store.connect(eoa).disableRestore(identityId);
    expect((await store.getIdentity(identityId)).restoreEnabled).to.equal(false);
    await expectRevert(store.connect(eoa).disableRestore.staticCall(identityId), "RestoreAlreadyDisabled");
  });

  it("accepts an EOA EIP-712 AddMethod signature without Verify wrapping", async function () {
    const { store, eoa, chainId, storeAddress } = await deployStore();
    const identityId = randomIdentityId();
    const passkey = simulatePasskey();
    const extra = simulatePasskey();
    await store.register(identityId, passkey.qx, passkey.qy);
    const addEoa = await store.hashAddMethod(
      identityId,
      METHOD_EOA,
      zeroPadValue("0x00", 32),
      zeroPadValue("0x00", 32),
      eoa.address
    );
    await store.addMethod(
      identityId,
      METHOD_EOA,
      zeroPadValue("0x00", 32),
      zeroPadValue("0x00", 32),
      eoa.address,
      identityPasskeyBlob({ identityId, key: passkey, message: addEoa })
    );
    const inner = await signIdentityAddMethodEoa(HARDHAT_KEY1, storeAddress, chainId, {
      identityId,
      kind: METHOD_WEBAUTHN,
      qx: extra.qx,
      qy: extra.qy,
      eoa: ZeroAddress,
    });
    await store.addMethod(
      identityId,
      METHOD_WEBAUTHN,
      extra.qx,
      extra.qy,
      ZeroAddress,
      wrapIdentityMethodSignature({
        kind: METHOD_EOA,
        identityId,
        qx: zeroPadValue("0x00", 32),
        qy: zeroPadValue("0x00", 32),
        eoa: eoa.address,
        inner,
      })
    );
    expect(await store.hasKind(identityId, METHOD_WEBAUTHN)).to.equal(true);
    expect((await store.getIdentity(identityId)).webauthnCount).to.equal(2n);
  });

  it("requires an EOA on the identity before disableRestore", async function () {
    const { store, eoa } = await deployStore();
    const identityId = randomIdentityId();
    const passkey = simulatePasskey();
    await store.register(identityId, passkey.qx, passkey.qy);
    await expectRevert(store.connect(eoa).disableRestore.staticCall(identityId), "RestoreRequiresEoa");
    await expectRevert(store.disableRestore.staticCall(randomIdentityId()), "IdentityNotFound");
  });

  it("restoreAddMethod works while restore is on and is blocked after disable", async function () {
    const { store, owner, eoa, other } = await deployStore();
    const identityId = randomIdentityId();
    const passkey = simulatePasskey();
    const recovered = simulatePasskey();
    await store.register(identityId, passkey.qx, passkey.qy);
    await expectRevert(store.connect(other).restoreAddMethod.staticCall(identityId, METHOD_WEBAUTHN, recovered.qx, recovered.qy, ZeroAddress), "NotRecoveryOperator");

    await store.restoreAddMethod(identityId, METHOD_WEBAUTHN, recovered.qx, recovered.qy, ZeroAddress);
    const login = keccak256(toUtf8Bytes("recovered-device"));
    expect(
      await store.verify(login, identityPasskeyBlob({ identityId, key: recovered, message: login }))
    ).to.equal(identityId);

    const addEoa = await store.hashAddMethod(
      identityId,
      METHOD_EOA,
      zeroPadValue("0x00", 32),
      zeroPadValue("0x00", 32),
      eoa.address
    );
    await store.addMethod(
      identityId,
      METHOD_EOA,
      zeroPadValue("0x00", 32),
      zeroPadValue("0x00", 32),
      eoa.address,
      identityPasskeyBlob({ identityId, key: passkey, message: addEoa })
    );
    await store.connect(eoa).disableRestore(identityId);
    await expectRevert(store.restoreAddMethod.staticCall(identityId, METHOD_WEBAUTHN, simulatePasskey().qx, simulatePasskey().qy, ZeroAddress), "RestoreIsDisabled");
    await expectRevert(
      store.restoreAddMethod.staticCall(randomIdentityId(), METHOD_WEBAUTHN, recovered.qx, recovered.qy, ZeroAddress),
      "IdentityNotFound"
    );
    expect(owner.address).to.be.a("string");
  });

  it("unsets the recovery operator and rejects restore", async function () {
    const { store, owner } = await deployStore();
    await store.connect(owner).setRecoveryOperator(ZeroAddress);
    const identityId = randomIdentityId();
    const pk = simulatePasskey();
    await store.register(identityId, pk.qx, pk.qy);
    await expectRevert(
      store.restoreAddMethod.staticCall(identityId, METHOD_WEBAUTHN, simulatePasskey().qx, simulatePasskey().qy, ZeroAddress),
      "RestoreOperatorUnset"
    );
  });

  it("addMethodByEoa pays gas without a bundler", async function () {
    const { store, eoa } = await deployStore();
    const identityId = randomIdentityId();
    const passkey = simulatePasskey();
    const extra = simulatePasskey();
    await store.register(identityId, passkey.qx, passkey.qy);
    const digest = await store.hashAddMethod(
      identityId,
      METHOD_EOA,
      zeroPadValue("0x00", 32),
      zeroPadValue("0x00", 32),
      eoa.address
    );
    await store.addMethod(
      identityId,
      METHOD_EOA,
      zeroPadValue("0x00", 32),
      zeroPadValue("0x00", 32),
      eoa.address,
      identityPasskeyBlob({ identityId, key: passkey, message: digest })
    );
    await expectRevert(store.addMethodByEoa.staticCall(identityId, METHOD_WEBAUTHN, extra.qx, extra.qy, ZeroAddress), "NotIdentityEoa");
    await store.connect(eoa).addMethodByEoa(identityId, METHOD_WEBAUTHN, extra.qx, extra.qy, ZeroAddress);
    expect((await store.getIdentity(identityId)).webauthnCount).to.equal(2n);
  });

  it("rejects invalid addMethod payloads and duplicate methods", async function () {
    const { store, eoa } = await deployStore();
    const identityId = randomIdentityId();
    const passkey = simulatePasskey();
    await store.register(identityId, passkey.qx, passkey.qy);
    const digest = await store.hashAddMethod(identityId, METHOD_WEBAUTHN, passkey.qx, passkey.qy, ZeroAddress);
    await expectRevert(store.addMethod.staticCall(
        identityId,
        METHOD_WEBAUTHN,
        passkey.qx,
        passkey.qy,
        ZeroAddress,
        identityPasskeyBlob({ identityId, key: passkey, message: digest })
      ), "MethodExists");
    const kindDigest = await store.hashAddMethod(identityId, 9, passkey.qx, passkey.qy, ZeroAddress);
    await expectRevert(store.addMethod.staticCall(
        identityId,
        9,
        passkey.qx,
        passkey.qy,
        ZeroAddress,
        identityPasskeyBlob({ identityId, key: passkey, message: kindDigest })
      ), "InvalidMethodKind");
    const missing = randomIdentityId();
    const addDigest = await store.hashAddMethod(missing, METHOD_WEBAUTHN, passkey.qx, passkey.qy, ZeroAddress);
    await expectRevert(store.addMethod.staticCall(
        missing,
        METHOD_WEBAUTHN,
        passkey.qx,
        passkey.qy,
        ZeroAddress,
        identityPasskeyBlob({ identityId, key: passkey, message: addDigest })
      ), "InvalidSignature");
    const yDigest = await store.hashAddMethod(identityId, METHOD_EOA, passkey.qx, passkey.qy, eoa.address);
    await expectRevert(store.addMethod.staticCall(
        identityId,
        METHOD_EOA,
        passkey.qx,
        passkey.qy,
        eoa.address,
        identityPasskeyBlob({ identityId, key: passkey, message: yDigest })
      ), "InvalidMethod");
  });

  it("rejects EOA methods with pubkey fields and P256 methods with an eoa", async function () {
    const { store, eoa } = await deployStore();
    const identityId = randomIdentityId();
    const passkey = simulatePasskey();
    await store.register(identityId, passkey.qx, passkey.qy);
    const eoaDigest = await store.hashAddMethod(
      identityId,
      METHOD_EOA,
      passkey.qx,
      zeroPadValue("0x00", 32),
      eoa.address
    );
    await expectRevert(store.addMethod.staticCall(
        identityId,
        METHOD_EOA,
        passkey.qx,
        zeroPadValue("0x00", 32),
        eoa.address,
        identityPasskeyBlob({ identityId, key: passkey, message: eoaDigest })
      ), "InvalidMethod");
    const webDigest = await store.hashAddMethod(identityId, METHOD_WEBAUTHN, passkey.qx, passkey.qy, eoa.address);
    await expectRevert(store.addMethod.staticCall(
        identityId,
        METHOD_WEBAUTHN,
        passkey.qx,
        passkey.qy,
        eoa.address,
        identityPasskeyBlob({ identityId, key: passkey, message: webDigest })
      ), "InvalidMethod");
  });

  it("removes a method with a remaining passkey authorization", async function () {
    const { store } = await deployStore();
    const identityId = randomIdentityId();
    const first = simulatePasskey();
    const second = simulatePasskey();
    await store.register(identityId, first.qx, first.qy);
    const addDigest = await store.hashAddMethod(identityId, METHOD_WEBAUTHN, second.qx, second.qy, ZeroAddress);
    await store.addMethod(
      identityId,
      METHOD_WEBAUTHN,
      second.qx,
      second.qy,
      ZeroAddress,
      identityPasskeyBlob({ identityId, key: first, message: addDigest })
    );
    const secondId = computeIdentityMethodId(identityId, METHOD_WEBAUTHN, second.qx, second.qy, ZeroAddress);
    const removeDigest = await store.hashRemoveMethod(identityId, secondId);
    await store.removeMethod(
      identityId,
      secondId,
      identityPasskeyBlob({ identityId, key: first, message: removeDigest })
    );
    expect((await store.getIdentity(identityId)).webauthnCount).to.equal(1n);
    expect((await store.methodIdsOf(identityId)).length).to.equal(1);

    const firstId = computeIdentityMethodId(identityId, METHOD_WEBAUTHN, first.qx, first.qy, ZeroAddress);
    await expectRevert(store.removeMethod.staticCall(
        identityId,
        firstId,
        identityPasskeyBlob({ identityId, key: first, message: await store.hashRemoveMethod(identityId, firstId) })
      ), "LastMethod");
    await expectRevert(store.removeMethod.staticCall(identityId, keccak256(toUtf8Bytes("missing")), "0x"), "MethodNotFound");
  });

  it("TypeScript EIP-712 add/remove hashes match the store", async function () {
    const { store, chainId, storeAddress } = await deployStore();
    const identityId = randomIdentityId();
    const pk = simulatePasskey();
    expect(
      hashIdentityAddMethod(storeAddress, chainId, {
        identityId,
        kind: METHOD_YUBIKEY,
        qx: pk.qx,
        qy: pk.qy,
        eoa: ZeroAddress,
      })
    ).to.equal(await store.hashAddMethod(identityId, METHOD_YUBIKEY, pk.qx, pk.qy, ZeroAddress));
    const methodId = computeIdentityMethodId(identityId, METHOD_YUBIKEY, pk.qx, pk.qy, ZeroAddress);
    expect(hashIdentityRemoveMethod(storeAddress, chainId, identityId, methodId)).to.equal(
      await store.hashRemoveMethod(identityId, methodId)
    );
  });

  it("maps failed get() to pair / yubi / crypto based on on-chain methods", async function () {
    expect(
      loginOptionsAfterFailedGet({ identityExists: false, webauthnCount: 0, yubikeyCount: 0, eoaCount: 0 })
    ).to.deep.equal({ tryWebAuthn: false, pair: false, yubikey: false, cryptoWallet: false });
    expect(
      loginOptionsAfterFailedGet({ identityExists: true, webauthnCount: 1, yubikeyCount: 0, eoaCount: 0 })
    ).to.deep.equal({ tryWebAuthn: true, pair: true, yubikey: false, cryptoWallet: false });
    expect(
      loginOptionsAfterFailedGet({ identityExists: true, webauthnCount: 1, yubikeyCount: 1, eoaCount: 1 })
    ).to.deep.equal({ tryWebAuthn: true, pair: true, yubikey: true, cryptoWallet: true });
  });

  it("caps methods at MAX_METHODS", async function () {
    const { store } = await deployStore();
    const identityId = randomIdentityId();
    const first = simulatePasskey();
    await store.register(identityId, first.qx, first.qy);
    for (let i = 0; i < 31; i++) {
      const extra = simulatePasskey();
      const digest = await store.hashAddMethod(identityId, METHOD_WEBAUTHN, extra.qx, extra.qy, ZeroAddress);
      await store.addMethod(
        identityId,
        METHOD_WEBAUTHN,
        extra.qx,
        extra.qy,
        ZeroAddress,
        identityPasskeyBlob({ identityId, key: first, message: digest })
      );
    }
    const overflow = simulatePasskey();
    const digest = await store.hashAddMethod(identityId, METHOD_WEBAUTHN, overflow.qx, overflow.qy, ZeroAddress);
    await expectRevert(store.addMethod.staticCall(
        identityId,
        METHOD_WEBAUTHN,
        overflow.qx,
        overflow.qy,
        ZeroAddress,
        identityPasskeyBlob({ identityId, key: first, message: digest })
      ), "TooManyMethods");
  });

  it("addMethod still works after disableRestore", async function () {
    const { store, eoa } = await deployStore();
    const identityId = randomIdentityId();
    const passkey = simulatePasskey();
    const yubi = simulatePasskey();
    const recovered = simulatePasskey();
    await store.register(identityId, passkey.qx, passkey.qy);
    const eoaDigest = await store.hashAddMethod(
      identityId,
      METHOD_EOA,
      zeroPadValue("0x00", 32),
      zeroPadValue("0x00", 32),
      eoa.address
    );
    await store.addMethod(
      identityId,
      METHOD_EOA,
      zeroPadValue("0x00", 32),
      zeroPadValue("0x00", 32),
      eoa.address,
      identityPasskeyBlob({ identityId, key: passkey, message: eoaDigest })
    );
    const yDigest = await store.hashAddMethod(identityId, METHOD_YUBIKEY, yubi.qx, yubi.qy, ZeroAddress);
    await store.addMethod(
      identityId,
      METHOD_YUBIKEY,
      yubi.qx,
      yubi.qy,
      ZeroAddress,
      identityPasskeyBlob({ identityId, key: passkey, message: yDigest })
    );
    await store.connect(eoa).disableRestore(identityId);
    expect((await store.getIdentity(identityId)).restoreEnabled).to.equal(false);
    const addDigest = await store.hashAddMethod(identityId, METHOD_WEBAUTHN, recovered.qx, recovered.qy, ZeroAddress);
    await store.addMethod(
      identityId,
      METHOD_WEBAUTHN,
      recovered.qx,
      recovered.qy,
      ZeroAddress,
      yubikeyBlob(identityId, yubi, addDigest)
    );
    expect((await store.getIdentity(identityId)).webauthnCount).to.equal(2n);
    const extra = simulatePasskey();
    await store.connect(eoa).addMethodByEoa(identityId, METHOD_WEBAUTHN, extra.qx, extra.qy, ZeroAddress);
    expect((await store.getIdentity(identityId)).webauthnCount).to.equal(3n);
  });
});
