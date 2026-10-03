/**
 * Audit PoCs for IdentityStore / IdentityWallet / IdentityWalletFactory.
 * These tests record broken invariants. They do not change production contracts.
 */
import { expect } from "chai";
import { Interface, ZeroAddress, ZeroHash, keccak256, toUtf8Bytes, zeroPadValue } from "ethers";
import { network } from "hardhat";
import {
  ENTRYPOINT_V09,
  buildPackedUserOperation,
  encodeExecuteCallData,
  userOpToTuple,
} from "../commerce/shared/userop.js";
import { deriveIdentityWalletSalt } from "../commerce/shared/wallet-address.js";
import {
  METHOD_EOA,
  METHOD_WEBAUTHN,
  METHOD_YUBIKEY,
  computeIdentityMethodId,
  encodeSuperIdentityBlobs,
  freshAuthId,
  randomIdentityId,
} from "../commerce/shared/identity-store.js";
import {
  identityPasskeyBlob,
  registrationAssertion,
  simulatePasskey,
  yubikeyBlob,
  type SimulatedPasskey,
} from "./helpers/identity-signing.js";

const PING_IFACE = new Interface(["function ping(bytes32 value)"]);

async function expectRevert(promise: Promise<unknown>, name: string): Promise<void> {
  try {
    await promise;
    expect.fail(`Expected revert ${name}`);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    expect(msg).to.include(name);
  }
}

async function deployAuditStack() {
  const { ethers } = (await network.create()) as Awaited<ReturnType<typeof network.create>> & { ethers: any };
  const [owner, eoa] = await ethers.getSigners();
  const Store = await ethers.getContractFactory("IdentityStore");
  const store = await Store.deploy(owner.address, owner.address);
  await store.waitForDeployment();
  const Harness = await ethers.getContractFactory("IdentityWalletHarness");
  const impl = await Harness.deploy();
  await impl.waitForDeployment();
  const Factory = await ethers.getContractFactory("IdentityWalletFactory");
  const factory = await Factory.deploy(await impl.getAddress(), await store.getAddress(), owner.address);
  await factory.waitForDeployment();
  const Ping = await ethers.getContractFactory("E2ePing");
  const ping = await Ping.deploy();
  await ping.waitForDeployment();
  const EntryPoint = await ethers.getContractFactory("E2eEntryPoint");
  const epImpl = await EntryPoint.deploy();
  await epImpl.waitForDeployment();
  const epCode = await ethers.provider.getCode(await epImpl.getAddress());
  await ethers.provider.send("hardhat_setCode", [ENTRYPOINT_V09, epCode]);
  const entryPoint = await ethers.getContractAt("E2eEntryPoint", ENTRYPOINT_V09);
  return {
    ethers,
    store,
    factory,
    ping,
    entryPoint,
    owner,
    eoa,
    storeAddress: (await store.getAddress()) as string,
    pingAddress: (await ping.getAddress()) as string,
  };
}

type Stack = Awaited<ReturnType<typeof deployAuditStack>>;

async function walletAt(stack: Stack, salt: string) {
  const walletAddress = (await stack.factory.predictAddress(salt)) as string;
  const wallet = await stack.ethers.getContractAt("IdentityWalletHarness", walletAddress);
  return { wallet, walletAddress };
}

async function sendPing(stack: Stack, walletAddress: string, identityId: string, key: SimulatedPasskey, tag: string) {
  const callData = encodeExecuteCallData([
    { target: stack.pingAddress, value: 0n, data: PING_IFACE.encodeFunctionData("ping", [keccak256(toUtf8Bytes(tag))]) },
  ]);
  const nonce = await stack.entryPoint.getNonce(walletAddress, 0);
  const unsigned = buildPackedUserOperation({ sender: walletAddress, nonce, callData });
  const userOpHash = await stack.entryPoint.getUserOpHash(userOpToTuple(unsigned));
  const userOp = buildPackedUserOperation({
    sender: walletAddress,
    nonce,
    callData,
    signature: identityPasskeyBlob({ identityId, key, message: userOpHash }),
  });
  await stack.entryPoint.handleOps([userOpToTuple(userOp)], stack.owner.address);
  return keccak256(toUtf8Bytes(tag));
}

describe("Identity wallet audit", function () {
  it("register accepts only an assertion from the key being stored", async function () {
    const stack = await deployAuditStack();
    const identityId = randomIdentityId();
    const attacker = simulatePasskey();
    const victim = simulatePasskey();
    await expectRevert(
      stack.store.register(identityId, attacker.qx, attacker.qy, registrationAssertion(victim, identityId)),
      "InvalidSignature"
    );
    await stack.store.register(identityId, attacker.qx, attacker.qy, registrationAssertion(attacker, identityId));
    await expectRevert(
      stack.store.register(identityId, victim.qx, victim.qy, registrationAssertion(victim, identityId)),
      "IdentityExists"
    );
    const login = keccak256(toUtf8Bytes("front-run"));
    expect(
      await stack.store.verify(login, identityPasskeyBlob({ identityId, key: attacker, message: login }))
    ).to.equal(identityId);
    expect(
      await stack.store.verify(login, identityPasskeyBlob({ identityId, key: victim, message: login }))
    ).to.equal(ZeroHash);
  });

  it("a caller cannot place their identity at another identity's wallet address", async function () {
    const stack = await deployAuditStack();
    const victimId = randomIdentityId();
    const attackerId = randomIdentityId();
    const victim = simulatePasskey();
    const attacker = simulatePasskey();
    await stack.store.register(victimId, victim.qx, victim.qy, registrationAssertion(victim, victimId));
    await stack.store.register(attackerId, attacker.qx, attacker.qy, registrationAssertion(attacker, attackerId));

    await stack.factory.createAccount(attackerId, 0);
    await stack.factory.createAccount(victimId, 0);

    const victimSalt = deriveIdentityWalletSalt(victimId, 0);
    const attackerSalt = deriveIdentityWalletSalt(attackerId, 0);
    expect(victimSalt).to.not.equal(attackerSalt);
    const victimWallet = await walletAt(stack, victimSalt);
    const attackerWallet = await walletAt(stack, attackerSalt);
    expect(await victimWallet.wallet.identityId()).to.equal(victimId);
    expect(await attackerWallet.wallet.identityId()).to.equal(attackerId);

    const marked = keccak256(toUtf8Bytes("victim-deposit"));
    expect(await sendPing(stack, victimWallet.walletAddress, victimId, victim, "victim-deposit")).to.equal(marked);
    expect(await stack.ping.lastPing()).to.equal(marked);

    const callData = encodeExecuteCallData([
      { target: stack.pingAddress, value: 0n, data: PING_IFACE.encodeFunctionData("ping", [keccak256(toUtf8Bytes("no"))]) },
    ]);
    const nonce = await stack.entryPoint.getNonce(victimWallet.walletAddress, 0);
    const unsigned = buildPackedUserOperation({ sender: victimWallet.walletAddress, nonce, callData });
    const userOpHash = await stack.entryPoint.getUserOpHash(userOpToTuple(unsigned));
    const attackerOp = buildPackedUserOperation({
      sender: victimWallet.walletAddress,
      nonce,
      callData,
      signature: identityPasskeyBlob({ identityId: attackerId, key: attacker, message: userOpHash }),
    });
    await expectRevert(stack.entryPoint.handleOps([userOpToTuple(attackerOp)], stack.owner.address), "AA24");
  });

  it("an add or remove signature can be used once for that identity", async function () {
    const stack = await deployAuditStack();
    const identityId = randomIdentityId();
    const primary = simulatePasskey();
    const stolen = simulatePasskey();
    await stack.store.register(identityId, primary.qx, primary.qy, registrationAssertion(primary, identityId));
    await stack.factory.createAccount(identityId, 0);
    const { wallet, walletAddress } = await walletAt(stack, await stack.factory.walletSalt(identityId, 0));

    const addAuthId = freshAuthId();
    const addDigest = await stack.store.hashAddMethod(
      identityId,
      METHOD_WEBAUTHN,
      stolen.qx,
      stolen.qy,
      ZeroAddress,
      addAuthId
    );
    const addAuth = identityPasskeyBlob({ identityId, key: primary, message: addDigest });
    await stack.store.addMethod(identityId, METHOD_WEBAUTHN, stolen.qx, stolen.qy, ZeroAddress, addAuthId, addAuth);
    const stolenId = computeIdentityMethodId(identityId, METHOD_WEBAUTHN, stolen.qx, stolen.qy, ZeroAddress);
    await expectRevert(
      stack.store.addMethod.staticCall(identityId, METHOD_WEBAUTHN, stolen.qx, stolen.qy, ZeroAddress, addAuthId, addAuth),
      "AuthAlreadyUsed"
    );

    const removeAuthId = freshAuthId();
    const removeDigest = await stack.store.hashRemoveMethod(identityId, stolenId, removeAuthId);
    const removeAuth = identityPasskeyBlob({ identityId, key: primary, message: removeDigest });
    await stack.store.removeMethod(identityId, stolenId, removeAuthId, removeAuth);
    expect((await stack.store.getMethod(stolenId)).exists).to.equal(false);

    const againId = freshAuthId();
    const againDigest = await stack.store.hashAddMethod(
      identityId,
      METHOD_WEBAUTHN,
      stolen.qx,
      stolen.qy,
      ZeroAddress,
      againId
    );
    await stack.store.addMethod(
      identityId,
      METHOD_WEBAUTHN,
      stolen.qx,
      stolen.qy,
      ZeroAddress,
      againId,
      identityPasskeyBlob({ identityId, key: primary, message: againDigest })
    );
    await expectRevert(
      stack.store.removeMethod.staticCall(identityId, stolenId, removeAuthId, removeAuth),
      "AuthAlreadyUsed"
    );
    expect((await stack.store.getMethod(stolenId)).exists).to.equal(true);
    const marked = await sendPing(stack, walletAddress, identityId, stolen, "stolen-key");
    expect(await stack.ping.lastPing()).to.equal(marked);
    expect(await wallet.identityId()).to.equal(identityId);

    const otherId = randomIdentityId();
    const other = simulatePasskey();
    const added = simulatePasskey();
    await stack.store.register(otherId, other.qx, other.qy, registrationAssertion(other, otherId));
    const shared = addAuthId;
    const sharedDigest = await stack.store.hashAddMethod(otherId, METHOD_WEBAUTHN, added.qx, added.qy, ZeroAddress, shared);
    await stack.store.addMethod(
      otherId,
      METHOD_WEBAUTHN,
      added.qx,
      added.qy,
      ZeroAddress,
      shared,
      identityPasskeyBlob({ identityId: otherId, key: other, message: sharedDigest })
    );
    expect(
      (await stack.store.getMethod(computeIdentityMethodId(otherId, METHOD_WEBAUTHN, added.qx, added.qy, ZeroAddress))).exists
    ).to.equal(true);
  });

  it("a cancel signature covers only the pending restore it names", async function () {
    const stack = await deployAuditStack();
    await stack.store.setRestoreDelay(3);
    const identityId = randomIdentityId();
    const passkey = simulatePasskey();
    const first = simulatePasskey();
    const second = simulatePasskey();
    await stack.store.register(identityId, passkey.qx, passkey.qy, registrationAssertion(passkey, identityId));

    await stack.store.initiateRestore(identityId, METHOD_WEBAUTHN, first.qx, first.qy, ZeroAddress);
    const firstDigest = await stack.store.hashCancelRestore(identityId);
    const firstAuth = identityPasskeyBlob({ identityId, key: passkey, message: firstDigest });
    await stack.store.cancelRestore(identityId, firstAuth);
    expect((await stack.store.pendingRestores(identityId)).active).to.equal(false);
    expect((await stack.store.pendingRestores(identityId)).restoreNonce).to.equal(1n);

    await stack.store.initiateRestore(identityId, METHOD_WEBAUTHN, second.qx, second.qy, ZeroAddress);
    const secondDigest = await stack.store.hashCancelRestore(identityId);
    expect(secondDigest).to.not.equal(firstDigest);
    expect((await stack.store.pendingRestores(identityId)).restoreNonce).to.equal(2n);
    await expectRevert(stack.store.cancelRestore.staticCall(identityId, firstAuth), "InvalidSignature");
    expect((await stack.store.pendingRestores(identityId)).active).to.equal(true);
    await stack.store.cancelRestore(identityId, identityPasskeyBlob({ identityId, key: passkey, message: secondDigest }));
    expect((await stack.store.pendingRestores(identityId)).active).to.equal(false);

    await stack.store.initiateRestore(identityId, METHOD_WEBAUTHN, second.qx, second.qy, ZeroAddress);
    await stack.ethers.provider.send("evm_increaseTime", [4]);
    await stack.ethers.provider.send("evm_mine", []);
    await expectRevert(stack.store.cancelRestore.staticCall(identityId, firstAuth), "InvalidSignature");
    await stack.store.executeRestore(identityId);
    const login = keccak256(toUtf8Bytes("restored-key"));
    expect(
      await stack.store.verify(login, identityPasskeyBlob({ identityId, key: second, message: login }))
    ).to.equal(identityId);
  });

  it("a restore does not start for a key already on the identity, and execute clears one that arrives during the delay", async function () {
    const stack = await deployAuditStack();
    await stack.store.setRestoreDelay(2);
    const identityId = randomIdentityId();
    const passkey = simulatePasskey();
    const replacement = simulatePasskey();
    await stack.store.register(identityId, passkey.qx, passkey.qy, registrationAssertion(passkey, identityId));
    await expectRevert(
      stack.store.initiateRestore.staticCall(identityId, METHOD_WEBAUTHN, passkey.qx, passkey.qy, ZeroAddress),
      "MethodExists"
    );
    expect((await stack.store.pendingRestores(identityId)).active).to.equal(false);

    await stack.store.initiateRestore(identityId, METHOD_WEBAUTHN, replacement.qx, replacement.qy, ZeroAddress);
    const arrived = freshAuthId();
    const addDigest = await stack.store.hashAddMethod(
      identityId,
      METHOD_WEBAUTHN,
      replacement.qx,
      replacement.qy,
      ZeroAddress,
      arrived
    );
    await stack.store.addMethod(
      identityId,
      METHOD_WEBAUTHN,
      replacement.qx,
      replacement.qy,
      ZeroAddress,
      arrived,
      identityPasskeyBlob({ identityId, key: passkey, message: addDigest })
    );
    await expectRevert(stack.store.executeRestore.staticCall(identityId), "RestoreNotReady");
    await stack.ethers.provider.send("evm_increaseTime", [3]);
    await stack.ethers.provider.send("evm_mine", []);
    await stack.store.executeRestore(identityId);
    expect((await stack.store.pendingRestores(identityId)).active).to.equal(false);
    expect(
      (
        await stack.store.getMethod(
          computeIdentityMethodId(identityId, METHOD_WEBAUTHN, replacement.qx, replacement.qy, ZeroAddress)
        )
      ).exists
    ).to.equal(true);
    const another = simulatePasskey();
    await stack.store.initiateRestore(identityId, METHOD_WEBAUTHN, another.qx, another.qy, ZeroAddress);
    expect((await stack.store.pendingRestores(identityId)).active).to.equal(true);
  });

  it("turning restore off keeps two methods, and removal cannot go below that", async function () {
    const stack = await deployAuditStack();
    const identityId = randomIdentityId();
    const passkey = simulatePasskey();
    await stack.store.register(identityId, passkey.qx, passkey.qy, registrationAssertion(passkey, identityId));
    await expectRevert(stack.store.connect(stack.eoa).disableRestore.staticCall(identityId), "RestoreNeedsTwoMethods");
    const qx = zeroPadValue("0x00", 32);
    const qy = zeroPadValue("0x00", 32);
    const authId2 = freshAuthId();
    const addDigest = await stack.store.hashAddMethod(identityId, METHOD_EOA, qx, qy, stack.eoa.address, authId2);
    await stack.store.addMethod(
      identityId,
      METHOD_EOA,
      qx,
      qy,
      stack.eoa.address,
      authId2,
      identityPasskeyBlob({ identityId, key: passkey, message: addDigest })
    );
    await stack.store.connect(stack.eoa).disableRestore(identityId);
    const idn = await stack.store.getIdentity(identityId);
    expect(idn.methodCount).to.equal(2n);
    expect(idn.restoreEnabled).to.equal(false);
    const passkeyId = computeIdentityMethodId(identityId, METHOD_WEBAUTHN, passkey.qx, passkey.qy, ZeroAddress);
    const removeAuthId = freshAuthId();
    const removeDigest = await stack.store.hashRemoveMethod(identityId, passkeyId, removeAuthId);
    await expectRevert(
      stack.store.removeMethod.staticCall(
        identityId,
        passkeyId,
        removeAuthId,
        identityPasskeyBlob({ identityId, key: passkey, message: removeDigest })
      ),
      "LastMethod"
    );
    expect((await stack.store.getIdentity(identityId)).methodCount).to.equal(2n);
    const extra = simulatePasskey();
    const extraAuthId = freshAuthId();
    const extraDigest = await stack.store.hashAddMethod(identityId, METHOD_WEBAUTHN, extra.qx, extra.qy, ZeroAddress, extraAuthId);
    await stack.store.addMethod(
      identityId,
      METHOD_WEBAUTHN,
      extra.qx,
      extra.qy,
      ZeroAddress,
      extraAuthId,
      identityPasskeyBlob({ identityId, key: passkey, message: extraDigest })
    );
    expect((await stack.store.getIdentity(identityId)).methodCount).to.equal(3n);
    const recovered = simulatePasskey();
    await expectRevert(
      stack.store.initiateRestore.staticCall(identityId, METHOD_WEBAUTHN, recovered.qx, recovered.qy, ZeroAddress),
      "RestoreIsDisabled"
    );
  });

  it("AUD-06 restoreDelay defaults to 0 and the owner can set it back to 0", async function () {
    const stack = await deployAuditStack();
    expect(await stack.store.restoreDelay()).to.equal(0n);
    await stack.store.setRecoveryOperator(stack.eoa.address);
    await expectRevert(
      stack.store.restoreAddMethod.staticCall(randomIdentityId(), METHOD_WEBAUTHN, zeroPadValue("0x11", 32), zeroPadValue("0x22", 32), ZeroAddress),
      "NotRecoveryOperator"
    );
    await stack.store.connect(stack.owner).setRecoveryOperator(stack.owner.address);
    const identityId = randomIdentityId();
    const passkey = simulatePasskey();
    const injected = simulatePasskey();
    await stack.store.register(identityId, passkey.qx, passkey.qy, registrationAssertion(passkey, identityId));
    await stack.store.restoreAddMethod(identityId, METHOD_WEBAUTHN, injected.qx, injected.qy, ZeroAddress);
    const login = keccak256(toUtf8Bytes("instant"));
    expect(
      await stack.store.verify(login, identityPasskeyBlob({ identityId, key: injected, message: login }))
    ).to.equal(identityId);

    const otherId = randomIdentityId();
    const other = simulatePasskey();
    const later = simulatePasskey();
    await stack.store.register(otherId, other.qx, other.qy, registrationAssertion(other, otherId));
    await stack.store.setRestoreDelay(259200);
    await stack.store.setRestoreDelay(0);
    await stack.store.restoreAddMethod(otherId, METHOD_WEBAUTHN, later.qx, later.qy, ZeroAddress);
    expect(
      await stack.store.verify(login, identityPasskeyBlob({ identityId: otherId, key: later, message: login }))
    ).to.equal(otherId);
  });

  it("a YubiKey on the identity can turn restore off", async function () {
    const stack = await deployAuditStack();
    const identityId = randomIdentityId();
    const passkey = simulatePasskey();
    const yubi = simulatePasskey();
    await stack.store.register(identityId, passkey.qx, passkey.qy, registrationAssertion(passkey, identityId));
    const authId4 = freshAuthId();
    const addDigest = await stack.store.hashAddMethod(identityId, METHOD_YUBIKEY, yubi.qx, yubi.qy, ZeroAddress, authId4);
    await stack.store.addMethod(
      identityId,
      METHOD_YUBIKEY,
      yubi.qx,
      yubi.qy,
      ZeroAddress,
      authId4,
      identityPasskeyBlob({ identityId, key: passkey, message: addDigest })
    );
    expect((await stack.store.getIdentity(identityId)).methodCount).to.equal(2n);
    await expectRevert(stack.store.connect(stack.eoa).disableRestore.staticCall(identityId), "RestoreRequiresEoa");
    const disableBySig = stack.store.getFunction("disableRestore(bytes32,bytes)");
    await expectRevert(
      disableBySig.staticCall(identityId, registrationAssertion(passkey, identityId)),
      "InvalidSignature"
    );
    await expectRevert(
      disableBySig.staticCall(identityId, identityPasskeyBlob({ identityId, key: passkey, message: identityId })),
      "InvalidSignature"
    );
    const digest = await stack.store.hashDisableRestore(identityId);
    await disableBySig(identityId, yubikeyBlob(identityId, yubi, digest));
    expect((await stack.store.getIdentity(identityId)).restoreEnabled).to.equal(false);
    const login = keccak256(toUtf8Bytes("yubi-still-spends"));
    expect(await stack.store.verify(login, yubikeyBlob(identityId, yubi, login))).to.equal(identityId);
  });

  it("two of three operator identities can install a spend method after the delay", async function () {
    const stack = await deployAuditStack();
    await stack.store.setRestoreDelay(1);
    const alice = randomIdentityId();
    const reco1 = randomIdentityId();
    const reco2 = randomIdentityId();
    const reco3 = randomIdentityId();
    const pkAlice = simulatePasskey();
    const pk1 = simulatePasskey();
    const pk2 = simulatePasskey();
    const pk3 = simulatePasskey();
    const injected = simulatePasskey();
    await stack.store.register(alice, pkAlice.qx, pkAlice.qy, registrationAssertion(pkAlice, alice));
    await stack.store.register(reco1, pk1.qx, pk1.qy, registrationAssertion(pk1, reco1));
    await stack.store.register(reco2, pk2.qx, pk2.qy, registrationAssertion(pk2, reco2));
    await stack.store.register(reco3, pk3.qx, pk3.qy, registrationAssertion(pk3, reco3));

    await stack.factory.createAccount(reco1, 0);
    const operator = await walletAt(stack, await stack.factory.walletSalt(reco1, 0));
    await stack.ethers.provider.send("hardhat_impersonateAccount", [operator.walletAddress]);
    await stack.ethers.provider.send("hardhat_setBalance", [operator.walletAddress, "0x1000000000000000000"]);
    const self = await stack.ethers.getSigner(operator.walletAddress);
    await operator.wallet.connect(self).enableSuper([reco2, reco3], 2);
    await stack.store.setRecoveryOperator(operator.walletAddress);
    await expectRevert(
      stack.store.initiateRestore.staticCall(alice, METHOD_WEBAUTHN, injected.qx, injected.qy, ZeroAddress),
      "NotRecoveryOperator"
    );

    await stack.factory.createAccount(alice, 0);
    const aliceWallet = await walletAt(stack, await stack.factory.walletSalt(alice, 0));

    const oneBlob = identityPasskeyBlob({
      identityId: reco1,
      key: pk1,
      message: keccak256(toUtf8Bytes("lone")),
    });
    expect(await operator.wallet.exposedValidate(keccak256(toUtf8Bytes("lone")), oneBlob)).to.equal(false);

    const callData = encodeExecuteCallData([
      {
        target: stack.storeAddress,
        value: 0n,
        data: stack.store.interface.encodeFunctionData("initiateRestore", [
          alice,
          METHOD_WEBAUTHN,
          injected.qx,
          injected.qy,
          ZeroAddress,
        ]),
      },
    ]);
    const nonce = await stack.entryPoint.getNonce(operator.walletAddress, 0);
    const unsigned = buildPackedUserOperation({ sender: operator.walletAddress, nonce, callData });
    const userOpHash = await stack.entryPoint.getUserOpHash(userOpToTuple(unsigned));
    const lone = buildPackedUserOperation({
      sender: operator.walletAddress,
      nonce,
      callData,
      signature: identityPasskeyBlob({ identityId: reco1, key: pk1, message: userOpHash }),
    });
    await expectRevert(stack.entryPoint.handleOps([userOpToTuple(lone)], stack.owner.address), "AA24");

    const signature = encodeSuperIdentityBlobs([
      identityPasskeyBlob({ identityId: reco1, key: pk1, message: userOpHash }),
      identityPasskeyBlob({ identityId: reco2, key: pk2, message: userOpHash }),
    ]);
    const swappedKey = simulatePasskey();
    const swappedCallData = encodeExecuteCallData([
      {
        target: stack.storeAddress,
        value: 0n,
        data: stack.store.interface.encodeFunctionData("initiateRestore", [
          alice,
          METHOD_WEBAUTHN,
          swappedKey.qx,
          swappedKey.qy,
          ZeroAddress,
        ]),
      },
    ]);
    await expectRevert(
      stack.entryPoint.handleOps([
        userOpToTuple(
          buildPackedUserOperation({
            sender: operator.walletAddress,
            nonce,
            callData: swappedCallData,
            signature,
          })
        ),
      ], stack.owner.address),
      "AA24"
    );

    const signed = buildPackedUserOperation({
      sender: operator.walletAddress,
      nonce,
      callData,
      signature,
    });
    await stack.entryPoint.handleOps([userOpToTuple(signed)], stack.owner.address);
    expect((await stack.store.pendingRestores(alice)).active).to.equal(true);
    await expectRevert(stack.store.executeRestore.staticCall(alice), "RestoreNotReady");

    const cancelDigest = await stack.store.hashCancelRestore(alice);
    await stack.store.cancelRestore(alice, identityPasskeyBlob({ identityId: alice, key: pkAlice, message: cancelDigest }));
    expect((await stack.store.pendingRestores(alice)).active).to.equal(false);

    const again = buildPackedUserOperation({
      sender: operator.walletAddress,
      nonce: await stack.entryPoint.getNonce(operator.walletAddress, 0),
      callData,
    });
    const againHash = await stack.entryPoint.getUserOpHash(userOpToTuple(again));
    await stack.entryPoint.handleOps(
      [
        userOpToTuple(
          buildPackedUserOperation({
            sender: operator.walletAddress,
            nonce: again.nonce,
            callData,
            signature: encodeSuperIdentityBlobs([
              identityPasskeyBlob({ identityId: reco1, key: pk1, message: againHash }),
              identityPasskeyBlob({ identityId: reco3, key: pk3, message: againHash }),
            ]),
          })
        ),
      ],
      stack.owner.address
    );
    await stack.ethers.provider.send("evm_increaseTime", [2]);
    await stack.ethers.provider.send("evm_mine", []);
    await stack.store.executeRestore(alice);
    const marked = await sendPing(stack, aliceWallet.walletAddress, alice, injected, "operator-installed");
    expect(await stack.ping.lastPing()).to.equal(marked);
  });
});
