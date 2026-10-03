import { expect } from "chai";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { network } from "hardhat";
import { Wallet, ZeroAddress, keccak256, toUtf8Bytes, zeroPadValue } from "ethers";
import { registerIdentityOnChain } from "../commerce/server/identity-onchain.js";
import type { IdentityConfig } from "../commerce/server/config.js";
import {
  METHOD_EOA,
  METHOD_WEBAUTHN,
  METHOD_YUBIKEY,
  computeIdentityMethodId,
  hashIdentityAddMethod,
  hashIdentityCancelRestore,
  hashIdentityDisableRestore,
  hashIdentityRemoveMethod,
  freshAuthId,
  loginOptionsAfterFailedGet,
  randomIdentityId,
  signIdentityAddMethodEoa,
  wrapIdentityMethodSignature,
} from "../commerce/shared/identity-store.js";
import {
  identityEoaBlob,
  identityPasskeyBlob,
  registrationAssertion,
  simulatePasskey,
  yubikeyBlob,
} from "./helpers/identity-signing.js";

const HARDHAT_KEY1 = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";

async function exposeRpc(
  send: (method: string, params: unknown[]) => Promise<unknown>
): Promise<{ url: string; close: () => Promise<void> }> {
  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const payload = JSON.parse(Buffer.concat(chunks).toString() || "{}") as
      | { id?: number; method: string; params?: unknown[] }
      | { id?: number; method: string; params?: unknown[] }[];
    const items = Array.isArray(payload) ? payload : [payload];
    const results = [];
    for (const body of items) {
      try {
        const result = await send(body.method, body.params ?? []);
        results.push({ jsonrpc: "2.0", id: body.id ?? null, result });
      } catch (err) {
        results.push({
          jsonrpc: "2.0",
          id: body.id ?? null,
          error: { code: -32000, message: err instanceof Error ? err.message : String(err) },
        });
      }
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(Array.isArray(payload) ? results : results[0]));
  }
  const server = createServer((req, res) => {
    void handle(req, res);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("expected a TCP port");
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}

function signerConfig(rpcUrl: string, storeAddress: string): IdentityConfig {
  return {
    sessionSecret: "identity-register-test",
    googleAuthUrl: "http://127.0.0.1",
    googleTokenUrl: "http://127.0.0.1",
    skipIdTokenVerify: true,
    successRedirect: "http://127.0.0.1",
    devOtp: false,
    rpcUrl,
    deployerPrivateKey: HARDHAT_KEY1,
    storeAddress,
  };
}

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
    await store.register(identityId, pk.qx, pk.qy, registrationAssertion(pk, identityId));
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
    await expectRevert(store.register.staticCall(zeroPadValue("0x00", 32), pk.qx, pk.qy, "0x"), "InvalidIdentity");
    const identityId = randomIdentityId();
    await store.register(identityId, pk.qx, pk.qy, registrationAssertion(pk, identityId));
    await expectRevert(
      store.register.staticCall(identityId, pk.qx, pk.qy, registrationAssertion(pk, identityId)),
      "IdentityExists"
    );
    await expectRevert(
      store.register.staticCall(randomIdentityId(), zeroPadValue("0x00", 32), zeroPadValue("0x00", 32), "0x"),
      "InvalidMethod"
    );
  });

  it("verifies a simulated WebAuthn assertion and rejects the wrong key", async function () {
    const { store } = await deployStore();
    const identityId = randomIdentityId();
    const pk = simulatePasskey();
    const other = simulatePasskey();
    await store.register(identityId, pk.qx, pk.qy, registrationAssertion(pk, identityId));
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
    await store.register(identityId, first.qx, first.qy, registrationAssertion(first, identityId));
    const authId0 = freshAuthId();
    const digest = await store.hashAddMethod(identityId, METHOD_WEBAUTHN, second.qx, second.qy, ZeroAddress, authId0);
    const auth = identityPasskeyBlob({ identityId, key: first, message: digest });
    await store.addMethod(identityId, METHOD_WEBAUTHN, second.qx, second.qy, ZeroAddress, authId0, auth);
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
    await store.register(identityId, passkey.qx, passkey.qy, registrationAssertion(passkey, identityId));
    const authId1 = freshAuthId();
    const digest = await store.hashAddMethod(identityId, METHOD_YUBIKEY, yubi.qx, yubi.qy, ZeroAddress, authId1);
    await store.addMethod(
      identityId,
      METHOD_YUBIKEY,
      yubi.qx,
      yubi.qy,
      ZeroAddress, authId1, identityPasskeyBlob({ identityId, key: passkey, message: digest }));
    expect(await store.hasKind(identityId, METHOD_YUBIKEY)).to.equal(true);
    const msg = keccak256(toUtf8Bytes("yubi-open"));
    expect(await store.verify(msg, yubikeyBlob(identityId, yubi, msg))).to.equal(identityId);
  });

  it("adds a crypto wallet, signs with it, and disables restore only from that EOA", async function () {
    const { store, eoa, other, chainId, storeAddress } = await deployStore();
    const identityId = randomIdentityId();
    const passkey = simulatePasskey();
    await store.register(identityId, passkey.qx, passkey.qy, registrationAssertion(passkey, identityId));
    const authId2 = freshAuthId();
    const digest = await store.hashAddMethod(identityId, METHOD_EOA, zeroPadValue("0x00", 32), zeroPadValue("0x00", 32), eoa.address, authId2);
    await store.addMethod(
      identityId,
      METHOD_EOA,
      zeroPadValue("0x00", 32),
      zeroPadValue("0x00", 32),
      eoa.address, authId2, identityPasskeyBlob({ identityId, key: passkey, message: digest }));
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
    await store.register(identityId, passkey.qx, passkey.qy, registrationAssertion(passkey, identityId));
    const authId3 = freshAuthId();
    const addEoa = await store.hashAddMethod(
      identityId,
      METHOD_EOA,
      zeroPadValue("0x00", 32),
      zeroPadValue("0x00", 32),
      eoa.address, authId3);
    await store.addMethod(
      identityId,
      METHOD_EOA,
      zeroPadValue("0x00", 32),
      zeroPadValue("0x00", 32),
      eoa.address, authId3, identityPasskeyBlob({ identityId, key: passkey, message: addEoa }));
    const extraAuthId = freshAuthId();
    const inner = await signIdentityAddMethodEoa(HARDHAT_KEY1, storeAddress, chainId, {
      identityId,
      kind: METHOD_WEBAUTHN,
      qx: extra.qx,
      qy: extra.qy,
      eoa: ZeroAddress,
      authId: extraAuthId,
    });
    await store.addMethod(
      identityId,
      METHOD_WEBAUTHN,
      extra.qx,
      extra.qy,
      ZeroAddress,
      extraAuthId,
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
    await store.register(identityId, passkey.qx, passkey.qy, registrationAssertion(passkey, identityId));
    await expectRevert(store.connect(eoa).disableRestore.staticCall(identityId), "RestoreNeedsTwoMethods");
    const second = simulatePasskey();
    const addAuthId = freshAuthId();
    const addDigest = await store.hashAddMethod(identityId, METHOD_WEBAUTHN, second.qx, second.qy, ZeroAddress, addAuthId);
    await store.addMethod(
      identityId,
      METHOD_WEBAUTHN,
      second.qx,
      second.qy,
      ZeroAddress,
      addAuthId,
      identityPasskeyBlob({ identityId, key: passkey, message: addDigest })
    );
    await expectRevert(store.connect(eoa).disableRestore.staticCall(identityId), "RestoreRequiresEoa");
    await expectRevert(store.disableRestore.staticCall(randomIdentityId()), "IdentityNotFound");
  });

  it("restoreAddMethod works while restore is on and is blocked after disable", async function () {
    const { ethers, store, owner, eoa, other } = await deployStore();
    const identityId = randomIdentityId();
    const passkey = simulatePasskey();
    const recovered = simulatePasskey();
    await store.register(identityId, passkey.qx, passkey.qy, registrationAssertion(passkey, identityId));
    await expectRevert(store.connect(other).restoreAddMethod.staticCall(identityId, METHOD_WEBAUTHN, recovered.qx, recovered.qy, ZeroAddress), "NotRecoveryOperator");

    await store.restoreAddMethod(identityId, METHOD_WEBAUTHN, recovered.qx, recovered.qy, ZeroAddress);
    const login = keccak256(toUtf8Bytes("recovered-device"));
    expect(
      await store.verify(login, identityPasskeyBlob({ identityId, key: recovered, message: login }))
    ).to.equal(zeroPadValue("0x00", 32));
    expect((await store.pendingRestores(identityId)).active).to.equal(true);
    await ethers.provider.send("evm_increaseTime", [259201]);
    await ethers.provider.send("evm_mine", []);
    await store.executeRestore(identityId);
    expect(
      await store.verify(login, identityPasskeyBlob({ identityId, key: recovered, message: login }))
    ).to.equal(identityId);

    const authId4 = freshAuthId();
    const addEoa = await store.hashAddMethod(
      identityId,
      METHOD_EOA,
      zeroPadValue("0x00", 32),
      zeroPadValue("0x00", 32),
      eoa.address, authId4);
    await store.addMethod(
      identityId,
      METHOD_EOA,
      zeroPadValue("0x00", 32),
      zeroPadValue("0x00", 32),
      eoa.address, authId4, identityPasskeyBlob({ identityId, key: passkey, message: addEoa }));
    await store.connect(eoa).disableRestore(identityId);
    await expectRevert(store.restoreAddMethod.staticCall(identityId, METHOD_WEBAUTHN, simulatePasskey().qx, simulatePasskey().qy, ZeroAddress), "RestoreIsDisabled");
    await expectRevert(
      store.restoreAddMethod.staticCall(randomIdentityId(), METHOD_WEBAUTHN, recovered.qx, recovered.qy, ZeroAddress),
      "IdentityNotFound"
    );
    expect(owner.address).to.be.a("string");
  });

  it("rejects a recovery operator of the zero address", async function () {
    const { store, owner } = await deployStore();
    await expectRevert(store.connect(owner).scheduleRecoveryOperator.staticCall(ZeroAddress), "ZeroAddress");
    expect(await store.recoveryOperator()).to.equal(owner.address);
  });

  it("addMethodByEoa pays gas without a bundler", async function () {
    const { store, eoa } = await deployStore();
    const identityId = randomIdentityId();
    const passkey = simulatePasskey();
    const extra = simulatePasskey();
    await store.register(identityId, passkey.qx, passkey.qy, registrationAssertion(passkey, identityId));
    const authId5 = freshAuthId();
    const digest = await store.hashAddMethod(
      identityId,
      METHOD_EOA,
      zeroPadValue("0x00", 32),
      zeroPadValue("0x00", 32),
      eoa.address, authId5);
    await store.addMethod(
      identityId,
      METHOD_EOA,
      zeroPadValue("0x00", 32),
      zeroPadValue("0x00", 32),
      eoa.address, authId5, identityPasskeyBlob({ identityId, key: passkey, message: digest }));
    await expectRevert(store.addMethodByEoa.staticCall(identityId, METHOD_WEBAUTHN, extra.qx, extra.qy, ZeroAddress), "NotIdentityEoa");
    await store.connect(eoa).addMethodByEoa(identityId, METHOD_WEBAUTHN, extra.qx, extra.qy, ZeroAddress);
    expect((await store.getIdentity(identityId)).webauthnCount).to.equal(2n);
  });

  it("rejects invalid addMethod payloads and duplicate methods", async function () {
    const { store, eoa } = await deployStore();
    const identityId = randomIdentityId();
    const passkey = simulatePasskey();
    await store.register(identityId, passkey.qx, passkey.qy, registrationAssertion(passkey, identityId));
    const authId6 = freshAuthId();
    const digest = await store.hashAddMethod(identityId, METHOD_WEBAUTHN, passkey.qx, passkey.qy, ZeroAddress, authId6);
    await expectRevert(store.addMethod.staticCall(
        identityId,
        METHOD_WEBAUTHN,
        passkey.qx,
        passkey.qy,
        ZeroAddress, authId6, identityPasskeyBlob({ identityId, key: passkey, message: digest })), "MethodExists");
    const authId7 = freshAuthId();
    const kindDigest = await store.hashAddMethod(identityId, 9, passkey.qx, passkey.qy, ZeroAddress, authId7);
    await expectRevert(store.addMethod.staticCall(
        identityId,
        9,
        passkey.qx,
        passkey.qy,
        ZeroAddress, authId7, identityPasskeyBlob({ identityId, key: passkey, message: kindDigest })), "InvalidMethodKind");
    const missing = randomIdentityId();
    const authId8 = freshAuthId();
    const addDigest = await store.hashAddMethod(missing, METHOD_WEBAUTHN, passkey.qx, passkey.qy, ZeroAddress, authId8);
    await expectRevert(store.addMethod.staticCall(
        missing,
        METHOD_WEBAUTHN,
        passkey.qx,
        passkey.qy,
        ZeroAddress, authId8, identityPasskeyBlob({ identityId, key: passkey, message: addDigest })), "InvalidSignature");
    const authId9 = freshAuthId();
    const yDigest = await store.hashAddMethod(identityId, METHOD_EOA, passkey.qx, passkey.qy, eoa.address, authId9);
    await expectRevert(store.addMethod.staticCall(
        identityId,
        METHOD_EOA,
        passkey.qx,
        passkey.qy,
        eoa.address, authId9, identityPasskeyBlob({ identityId, key: passkey, message: yDigest })), "InvalidMethod");
  });

  it("rejects EOA methods with pubkey fields and P256 methods with an eoa", async function () {
    const { store, eoa } = await deployStore();
    const identityId = randomIdentityId();
    const passkey = simulatePasskey();
    await store.register(identityId, passkey.qx, passkey.qy, registrationAssertion(passkey, identityId));
    const authId10 = freshAuthId();
    const eoaDigest = await store.hashAddMethod(
      identityId,
      METHOD_EOA,
      passkey.qx,
      zeroPadValue("0x00", 32),
      eoa.address, authId10);
    await expectRevert(store.addMethod.staticCall(
        identityId,
        METHOD_EOA,
        passkey.qx,
        zeroPadValue("0x00", 32),
        eoa.address, authId10, identityPasskeyBlob({ identityId, key: passkey, message: eoaDigest })), "InvalidMethod");
    const authId11 = freshAuthId();
    const webDigest = await store.hashAddMethod(identityId, METHOD_WEBAUTHN, passkey.qx, passkey.qy, eoa.address, authId11);
    await expectRevert(store.addMethod.staticCall(
        identityId,
        METHOD_WEBAUTHN,
        passkey.qx,
        passkey.qy,
        eoa.address, authId11, identityPasskeyBlob({ identityId, key: passkey, message: webDigest })), "InvalidMethod");
  });

  it("removes a method with a remaining passkey authorization", async function () {
    const { store } = await deployStore();
    const identityId = randomIdentityId();
    const first = simulatePasskey();
    const second = simulatePasskey();
    await store.register(identityId, first.qx, first.qy, registrationAssertion(first, identityId));
    const authId12 = freshAuthId();
    const addDigest = await store.hashAddMethod(identityId, METHOD_WEBAUTHN, second.qx, second.qy, ZeroAddress, authId12);
    await store.addMethod(
      identityId,
      METHOD_WEBAUTHN,
      second.qx,
      second.qy,
      ZeroAddress, authId12, identityPasskeyBlob({ identityId, key: first, message: addDigest }));
    const secondId = computeIdentityMethodId(identityId, METHOD_WEBAUTHN, second.qx, second.qy, ZeroAddress);
    const authId13 = freshAuthId();
    const removeDigest = await store.hashRemoveMethod(identityId, secondId, authId13);
    await store.removeMethod(
      identityId,
      secondId, authId13, identityPasskeyBlob({ identityId, key: first, message: removeDigest }));
    expect((await store.getIdentity(identityId)).webauthnCount).to.equal(1n);
    expect((await store.methodIdsOf(identityId)).length).to.equal(1);

    const firstId = computeIdentityMethodId(identityId, METHOD_WEBAUTHN, first.qx, first.qy, ZeroAddress);
    const lastAuthId = freshAuthId();
    await expectRevert(store.removeMethod.staticCall(
        identityId,
        firstId,
        lastAuthId,
        identityPasskeyBlob({ identityId, key: first, message: await store.hashRemoveMethod(identityId, firstId, lastAuthId) })
      ), "LastMethod");
    await expectRevert(
      store.removeMethod.staticCall(identityId, keccak256(toUtf8Bytes("missing")), freshAuthId(), "0x"),
      "MethodNotFound"
    );
  });

  it("TypeScript EIP-712 add/remove hashes match the store", async function () {
    const { store, chainId, storeAddress } = await deployStore();
    const identityId = randomIdentityId();
    const pk = simulatePasskey();
    const addAuthId = freshAuthId();
    const removeAuthId = freshAuthId();
    expect(
      hashIdentityAddMethod(storeAddress, chainId, {
        identityId,
        kind: METHOD_YUBIKEY,
        qx: pk.qx,
        qy: pk.qy,
        eoa: ZeroAddress,
        authId: addAuthId,
      })
    ).to.equal(await store.hashAddMethod(identityId, METHOD_YUBIKEY, pk.qx, pk.qy, ZeroAddress, addAuthId));
    const methodId = computeIdentityMethodId(identityId, METHOD_YUBIKEY, pk.qx, pk.qy, ZeroAddress);
    expect(hashIdentityRemoveMethod(storeAddress, chainId, identityId, methodId, removeAuthId)).to.equal(
      await store.hashRemoveMethod(identityId, methodId, removeAuthId)
    );
    expect(hashIdentityDisableRestore(storeAddress, chainId, identityId)).to.equal(
      await store.hashDisableRestore(identityId)
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
    await store.register(identityId, first.qx, first.qy, registrationAssertion(first, identityId));
    for (let i = 0; i < 31; i++) {
      const extra = simulatePasskey();
      const authId14 = freshAuthId();
      const digest = await store.hashAddMethod(identityId, METHOD_WEBAUTHN, extra.qx, extra.qy, ZeroAddress, authId14);
      await store.addMethod(
        identityId,
        METHOD_WEBAUTHN,
        extra.qx,
        extra.qy,
        ZeroAddress, authId14, identityPasskeyBlob({ identityId, key: first, message: digest }));
    }
    const overflow = simulatePasskey();
    const authId15 = freshAuthId();
    const digest = await store.hashAddMethod(identityId, METHOD_WEBAUTHN, overflow.qx, overflow.qy, ZeroAddress, authId15);
    await expectRevert(store.addMethod.staticCall(
        identityId,
        METHOD_WEBAUTHN,
        overflow.qx,
        overflow.qy,
        ZeroAddress, authId15, identityPasskeyBlob({ identityId, key: first, message: digest })), "TooManyMethods");
    await expectRevert(
      store.initiateRestore.staticCall(identityId, METHOD_WEBAUTHN, overflow.qx, overflow.qy, ZeroAddress),
      "TooManyMethods"
    );
  });

  it("addMethod still works after disableRestore", async function () {
    const { store, eoa } = await deployStore();
    const identityId = randomIdentityId();
    const passkey = simulatePasskey();
    const yubi = simulatePasskey();
    const recovered = simulatePasskey();
    await store.register(identityId, passkey.qx, passkey.qy, registrationAssertion(passkey, identityId));
    const authId16 = freshAuthId();
    const eoaDigest = await store.hashAddMethod(
      identityId,
      METHOD_EOA,
      zeroPadValue("0x00", 32),
      zeroPadValue("0x00", 32),
      eoa.address, authId16);
    await store.addMethod(
      identityId,
      METHOD_EOA,
      zeroPadValue("0x00", 32),
      zeroPadValue("0x00", 32),
      eoa.address, authId16, identityPasskeyBlob({ identityId, key: passkey, message: eoaDigest }));
    const authId17 = freshAuthId();
    const yDigest = await store.hashAddMethod(identityId, METHOD_YUBIKEY, yubi.qx, yubi.qy, ZeroAddress, authId17);
    await store.addMethod(
      identityId,
      METHOD_YUBIKEY,
      yubi.qx,
      yubi.qy,
      ZeroAddress, authId17, identityPasskeyBlob({ identityId, key: passkey, message: yDigest }));
    await store.connect(eoa).disableRestore(identityId);
    expect((await store.getIdentity(identityId)).restoreEnabled).to.equal(false);
    const authId18 = freshAuthId();
    const addDigest = await store.hashAddMethod(identityId, METHOD_WEBAUTHN, recovered.qx, recovered.qy, ZeroAddress, authId18);
    await store.addMethod(
      identityId,
      METHOD_WEBAUTHN,
      recovered.qx,
      recovered.qy,
      ZeroAddress, authId18, yubikeyBlob(identityId, yubi, addDigest));
    expect((await store.getIdentity(identityId)).webauthnCount).to.equal(2n);
    const extra = simulatePasskey();
    await store.connect(eoa).addMethodByEoa(identityId, METHOD_WEBAUTHN, extra.qx, extra.qy, ZeroAddress);
    expect((await store.getIdentity(identityId)).webauthnCount).to.equal(3n);
  });

  it("delayed restore: initiate, too-early execute, cancel with old key, then execute after delay", async function () {
    const { ethers, store, storeAddress, chainId } = await deployStore();
    const identityId = randomIdentityId();
    const passkey = simulatePasskey();
    const recovered = simulatePasskey();
    await store.register(identityId, passkey.qx, passkey.qy, registrationAssertion(passkey, identityId));

    await store.initiateRestore(identityId, METHOD_WEBAUTHN, recovered.qx, recovered.qy, ZeroAddress);
    const pending = await store.pendingRestores(identityId);
    expect(pending.active).to.equal(true);
    await expectRevert(store.executeRestore.staticCall(identityId), "RestoreNotReady");
    await expectRevert(
      store.initiateRestore.staticCall(identityId, METHOD_WEBAUTHN, simulatePasskey().qx, simulatePasskey().qy, ZeroAddress),
      "RestorePending"
    );

    const cancelDigest = await store.hashCancelRestore(identityId);
    expect(pending.restoreNonce).to.equal(1n);
    expect(
      hashIdentityCancelRestore(storeAddress, chainId, {
        identityId,
        restoreNonce: pending.restoreNonce,
        qx: pending.qx,
        qy: pending.qy,
        eoa: pending.eoa,
        executeAfter: pending.executeAfter,
      })
    ).to.equal(cancelDigest);
    await store.cancelRestore(identityId, identityPasskeyBlob({ identityId, key: passkey, message: cancelDigest }));
    expect((await store.pendingRestores(identityId)).active).to.equal(false);

    await store.initiateRestore(identityId, METHOD_WEBAUTHN, recovered.qx, recovered.qy, ZeroAddress);
    const secondPending = await store.pendingRestores(identityId);
    const secondDigest = await store.hashCancelRestore(identityId);
    expect(secondPending.restoreNonce).to.equal(2n);
    expect(secondDigest).to.not.equal(cancelDigest);
    await ethers.provider.send("evm_increaseTime", [259201]);
    await ethers.provider.send("evm_mine", []);
    await store.executeRestore(identityId);
    const login = keccak256(toUtf8Bytes("delayed-restore"));
    expect(
      await store.verify(login, identityPasskeyBlob({ identityId, key: recovered, message: login }))
    ).to.equal(identityId);
  });

  it("disableRestore clears a pending restore and blocks execute", async function () {
    const { store, eoa } = await deployStore();
    const identityId = randomIdentityId();
    const passkey = simulatePasskey();
    await store.register(identityId, passkey.qx, passkey.qy, registrationAssertion(passkey, identityId));
    const authId19 = freshAuthId();
    const addEoa = await store.hashAddMethod(
      identityId,
      METHOD_EOA,
      zeroPadValue("0x00", 32),
      zeroPadValue("0x00", 32),
      eoa.address, authId19);
    await store.addMethod(
      identityId,
      METHOD_EOA,
      zeroPadValue("0x00", 32),
      zeroPadValue("0x00", 32),
      eoa.address, authId19, identityPasskeyBlob({ identityId, key: passkey, message: addEoa }));
    await store.initiateRestore(identityId, METHOD_WEBAUTHN, simulatePasskey().qx, simulatePasskey().qy, ZeroAddress);
    await store.connect(eoa).disableRestore(identityId);
    expect((await store.pendingRestores(identityId)).active).to.equal(false);
    await expectRevert(store.executeRestore.staticCall(identityId), "RestoreNotPending");
    await expectRevert(
      store.initiateRestore.staticCall(identityId, METHOD_WEBAUTHN, simulatePasskey().qx, simulatePasskey().qy, ZeroAddress),
      "RestoreIsDisabled"
    );
  });

  it("an existing on-chain identity succeeds only when the passkey matches", async function () {
    const { ethers, store } = await deployStore();
    const deployer = new Wallet(HARDHAT_KEY1);
    await ethers.provider.send("hardhat_setBalance", [deployer.address, "0x1000000000000000000"]);
    const rpc = await exposeRpc((method, params) => ethers.provider.send(method, params));
    try {
      const config = signerConfig(rpc.url, await store.getAddress());
      const identityId = randomIdentityId();
      const passkey = simulatePasskey();
      const other = simulatePasskey();
      expect(
        await registerIdentityOnChain(config, identityId, passkey.qx, passkey.qy, registrationAssertion(passkey, identityId))
      ).to.equal(true);
      expect(
        await registerIdentityOnChain(config, identityId, passkey.qx, passkey.qy, registrationAssertion(passkey, identityId))
      ).to.equal(true);
      const stored = await store.getMethod(
        computeIdentityMethodId(identityId, METHOD_WEBAUTHN, passkey.qx, passkey.qy, ZeroAddress)
      );
      expect(stored.exists).to.equal(true);
      let mismatch: unknown;
      try {
        await registerIdentityOnChain(config, identityId, other.qx, other.qy, registrationAssertion(other, identityId));
      } catch (err) {
        mismatch = err;
      }
      expect((mismatch as { code?: string } | undefined)?.code).to.equal("identity_key_mismatch");
      expect(
        (
          await store.getMethod(
            computeIdentityMethodId(identityId, METHOD_WEBAUTHN, other.qx, other.qy, ZeroAddress)
          )
        ).exists
      ).to.equal(false);
      const unread = await registerIdentityOnChain(
        { ...config, rpcUrl: undefined, deployerPrivateKey: undefined, storeAddress: undefined },
        identityId,
        other.qx,
        other.qy,
        registrationAssertion(other, identityId)
      );
      expect(unread).to.equal(false);
    } finally {
      await rpc.close();
    }
  });
});
