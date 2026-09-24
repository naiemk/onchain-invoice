import { expect } from "chai";
import { Interface, ZeroAddress, keccak256, toUtf8Bytes, zeroPadValue } from "ethers";
import { network } from "hardhat";
import {
  ENTRYPOINT_V09,
  encodeExecuteCallData,
  buildPackedUserOperation,
  userOpToTuple,
} from "../commerce/shared/userop.js";
import {
  METHOD_EOA,
  METHOD_WEBAUTHN,
  METHOD_YUBIKEY,
  computeIdentityMethodId,
  encodeSuperIdentityBlobs,
  randomIdentityId,
} from "../commerce/shared/identity-store.js";
import {
  identityEoaBlob,
  identityPasskeyBlob,
  simulatePasskey,
  yubikeyBlob,
} from "./helpers/identity-signing.js";

async function expectRevert(promise: Promise<unknown>, name: string): Promise<void> {
  try {
    await promise;
    expect.fail(`Expected revert ${name}`);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    expect(msg).to.include(name);
  }
}

const HARDHAT_KEY1 = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
const PING_IFACE = new Interface(["function ping(bytes32 value)"]);

async function deployIdentityStack() {
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
  const chainId = (await ethers.provider.getNetwork()).chainId as bigint;
  return {
    ethers,
    store,
    factory,
    ping,
    entryPoint,
    owner,
    eoa,
    chainId,
    storeAddress: await store.getAddress(),
    pingAddress: await ping.getAddress(),
  };
}

async function createWallet(stack: Awaited<ReturnType<typeof deployIdentityStack>>, identityId: string, salt: string) {
  await stack.factory.createAccount(identityId, salt);
  const walletAddress = await stack.factory.predictAddress(salt);
  const wallet = await stack.ethers.getContractAt("IdentityWalletHarness", walletAddress);
  return { wallet, walletAddress };
}

describe("IdentityWallet e2e (Hardhat simulated signing)", function () {
  it("new identity: passkey register → wallet → EntryPoint ping", async function () {
    const stack = await deployIdentityStack();
    const identityId = randomIdentityId();
    const pk = simulatePasskey();
    await stack.store.register(identityId, pk.qx, pk.qy);
    const { wallet, walletAddress } = await createWallet(stack, identityId, keccak256(toUtf8Bytes("w1")));
    expect(await wallet.identityId()).to.equal(identityId);

    const callData = encodeExecuteCallData([
      { target: stack.pingAddress, value: 0n, data: PING_IFACE.encodeFunctionData("ping", [keccak256(toUtf8Bytes("hi"))]) },
    ]);
    const nonce = await stack.entryPoint.getNonce(walletAddress, 0);
    const unsigned = buildPackedUserOperation({ sender: walletAddress, nonce, callData });
    const userOpHash = await stack.entryPoint.getUserOpHash(userOpToTuple(unsigned));
    const signature = identityPasskeyBlob({ identityId, key: pk, message: userOpHash });
    const userOp = buildPackedUserOperation({ sender: walletAddress, nonce, callData, signature });
    await stack.entryPoint.handleOps([userOpToTuple(userOp)], stack.owner.address);
    expect(await stack.ping.lastPing()).to.equal(keccak256(toUtf8Bytes("hi")));
  });

  it("pair a second device passkey and open the same wallet with it", async function () {
    const stack = await deployIdentityStack();
    const identityId = randomIdentityId();
    const windows = simulatePasskey();
    const iphone = simulatePasskey();
    await stack.store.register(identityId, windows.qx, windows.qy);
    const { walletAddress } = await createWallet(stack, identityId, keccak256(toUtf8Bytes("w-pair")));
    const addDigest = await stack.store.hashAddMethod(identityId, METHOD_WEBAUTHN, iphone.qx, iphone.qy, ZeroAddress);
    await stack.store.addMethod(
      identityId,
      METHOD_WEBAUTHN,
      iphone.qx,
      iphone.qy,
      ZeroAddress,
      identityPasskeyBlob({ identityId, key: windows, message: addDigest })
    );

    const callData = encodeExecuteCallData([
      {
        target: stack.pingAddress,
        value: 0n,
        data: PING_IFACE.encodeFunctionData("ping", [keccak256(toUtf8Bytes("paired"))]),
      },
    ]);
    const nonce = await stack.entryPoint.getNonce(walletAddress, 0);
    const unsigned = buildPackedUserOperation({ sender: walletAddress, nonce, callData });
    const userOpHash = await stack.entryPoint.getUserOpHash(userOpToTuple(unsigned));
    const userOp = buildPackedUserOperation({
      sender: walletAddress,
      nonce,
      callData,
      signature: identityPasskeyBlob({ identityId, key: iphone, message: userOpHash }),
    });
    await stack.entryPoint.handleOps([userOpToTuple(userOp)], stack.owner.address);
    expect(await stack.ping.lastPing()).to.equal(keccak256(toUtf8Bytes("paired")));
  });

  it("open with YubiKey and with crypto wallet after they are on the identity", async function () {
    const stack = await deployIdentityStack();
    const identityId = randomIdentityId();
    const passkey = simulatePasskey();
    const yubi = simulatePasskey();
    await stack.store.register(identityId, passkey.qx, passkey.qy);
    const { walletAddress } = await createWallet(stack, identityId, keccak256(toUtf8Bytes("w-methods")));
    const yDigest = await stack.store.hashAddMethod(identityId, METHOD_YUBIKEY, yubi.qx, yubi.qy, ZeroAddress);
    await stack.store.addMethod(
      identityId,
      METHOD_YUBIKEY,
      yubi.qx,
      yubi.qy,
      ZeroAddress,
      identityPasskeyBlob({ identityId, key: passkey, message: yDigest })
    );
    const eDigest = await stack.store.hashAddMethod(
      identityId,
      METHOD_EOA,
      zeroPadValue("0x00", 32),
      zeroPadValue("0x00", 32),
      stack.eoa.address
    );
    await stack.store.addMethod(
      identityId,
      METHOD_EOA,
      zeroPadValue("0x00", 32),
      zeroPadValue("0x00", 32),
      stack.eoa.address,
      identityPasskeyBlob({ identityId, key: passkey, message: eDigest })
    );

    const send = async (tag: "yubi" | "crypto") => {
      const callData = encodeExecuteCallData([
        { target: stack.pingAddress, value: 0n, data: PING_IFACE.encodeFunctionData("ping", [keccak256(toUtf8Bytes(tag))]) },
      ]);
      const nonce = await stack.entryPoint.getNonce(walletAddress, 0);
      const unsigned = buildPackedUserOperation({ sender: walletAddress, nonce, callData });
      const userOpHash = await stack.entryPoint.getUserOpHash(userOpToTuple(unsigned));
      const sig =
        tag === "crypto"
          ? await identityEoaBlob({
              identityId,
              eoa: stack.eoa.address,
              privateKey: HARDHAT_KEY1,
              store: stack.storeAddress,
              chainId: stack.chainId,
              message: userOpHash,
            })
          : yubikeyBlob(identityId, yubi, userOpHash);
      const userOp = buildPackedUserOperation({ sender: walletAddress, nonce, callData, signature: sig });
      await stack.entryPoint.handleOps([userOpToTuple(userOp)], stack.owner.address);
      expect(await stack.ping.lastPing()).to.equal(keccak256(toUtf8Bytes(tag)));
    };
    await send("yubi");
    await send("crypto");
  });

  it("rejects a UserOp signed by an unknown passkey (AA24)", async function () {
    const stack = await deployIdentityStack();
    const identityId = randomIdentityId();
    const pk = simulatePasskey();
    const stranger = simulatePasskey();
    await stack.store.register(identityId, pk.qx, pk.qy);
    const { walletAddress } = await createWallet(stack, identityId, keccak256(toUtf8Bytes("w-aa24")));
    const callData = encodeExecuteCallData([
      { target: stack.pingAddress, value: 0n, data: PING_IFACE.encodeFunctionData("ping", [keccak256(toUtf8Bytes("no"))]) },
    ]);
    const nonce = await stack.entryPoint.getNonce(walletAddress, 0);
    const unsigned = buildPackedUserOperation({ sender: walletAddress, nonce, callData });
    const userOpHash = await stack.entryPoint.getUserOpHash(userOpToTuple(unsigned));
    const userOp = buildPackedUserOperation({
      sender: walletAddress,
      nonce,
      callData,
      signature: identityPasskeyBlob({ identityId, key: stranger, message: userOpHash }),
    });
    await expectRevert(stack.entryPoint.handleOps.staticCall([userOpToTuple(userOp)], stack.owner.address), "AA24");
  });

  it("super wallet 2-of-2 identities execute via EntryPoint", async function () {
    const stack = await deployIdentityStack();
    const idA = randomIdentityId();
    const idB = randomIdentityId();
    const pkA = simulatePasskey();
    const pkB = simulatePasskey();
    await stack.store.register(idA, pkA.qx, pkA.qy);
    await stack.store.register(idB, pkB.qx, pkB.qy);
    const { wallet, walletAddress } = await createWallet(stack, idA, keccak256(toUtf8Bytes("super")));

    await stack.ethers.provider.send("hardhat_impersonateAccount", [walletAddress]);
    await stack.ethers.provider.send("hardhat_setBalance", [walletAddress, "0x1000000000000000000"]);
    const self = await stack.ethers.getSigner(walletAddress);
    await wallet.connect(self).enableSuper([idB], 2);

    const callData = encodeExecuteCallData([
      { target: stack.pingAddress, value: 0n, data: PING_IFACE.encodeFunctionData("ping", [keccak256(toUtf8Bytes("m-of-n"))]) },
    ]);
    const nonce = await stack.entryPoint.getNonce(walletAddress, 0);
    const unsigned = buildPackedUserOperation({ sender: walletAddress, nonce, callData });
    const userOpHash = await stack.entryPoint.getUserOpHash(userOpToTuple(unsigned));
    const blobA = identityPasskeyBlob({ identityId: idA, key: pkA, message: userOpHash });
    const blobB = identityPasskeyBlob({ identityId: idB, key: pkB, message: userOpHash });
    const userOp = buildPackedUserOperation({
      sender: walletAddress,
      nonce,
      callData,
      signature: encodeSuperIdentityBlobs([blobA, blobB]),
    });
    await stack.entryPoint.handleOps([userOpToTuple(userOp)], stack.owner.address);
    expect(await stack.ping.lastPing()).to.equal(keccak256(toUtf8Bytes("m-of-n")));

    const onlyA = buildPackedUserOperation({
      sender: walletAddress,
      nonce: await stack.entryPoint.getNonce(walletAddress, 0),
      callData,
      signature: blobA,
    });
    await expectRevert(stack.entryPoint.handleOps.staticCall([userOpToTuple(onlyA)], stack.owner.address), "AA24");
  });

  it("factory and wallet reject missing identity / double initialize / zero store", async function () {
    const stack = await deployIdentityStack();
    await expectRevert(
      stack.factory.createAccount.staticCall(randomIdentityId(), keccak256(toUtf8Bytes("nope"))),
      "IdentityNotFound"
    );
    const Factory = await stack.ethers.getContractFactory("IdentityWalletFactory");
    await expectRevert(
      (async () => {
        const tx = await Factory.deploy(ZeroAddress, stack.storeAddress, stack.owner.address, { gasLimit: 8_000_000n });
        await tx.wait();
      })(),
      "ZeroAddress"
    );
    const identityId = randomIdentityId();
    const pk = simulatePasskey();
    await stack.store.register(identityId, pk.qx, pk.qy);
    const salt = keccak256(toUtf8Bytes("once"));
    await stack.factory.createAccount(identityId, salt);
    await stack.factory.createAccount(identityId, salt);
    const wallet = await stack.ethers.getContractAt(
      "IdentityWalletHarness",
      await stack.factory.predictAddress(salt)
    );
    await expectRevert(wallet.initialize.staticCall(stack.storeAddress, identityId), "InvalidInitialization");
  });

  it("super signer add/remove/threshold via the wallet itself", async function () {
    const stack = await deployIdentityStack();
    const idA = randomIdentityId();
    const idB = randomIdentityId();
    const idC = randomIdentityId();
    await stack.store.register(idA, simulatePasskey().qx, simulatePasskey().qy);
    await stack.store.register(idB, simulatePasskey().qx, simulatePasskey().qy);
    await stack.store.register(idC, simulatePasskey().qx, simulatePasskey().qy);
    const { wallet, walletAddress } = await createWallet(stack, idA, keccak256(toUtf8Bytes("th")));
    await stack.ethers.provider.send("hardhat_impersonateAccount", [walletAddress]);
    await stack.ethers.provider.send("hardhat_setBalance", [walletAddress, "0x1000000000000000000"]);
    const self = await stack.ethers.getSigner(walletAddress);
    await expectRevert(wallet.connect(self).addSigner.staticCall(idB), "NotSuperWallet");
    await wallet.connect(self).enableSuper([idB], 1);
    await expectRevert(wallet.connect(self).enableSuper.staticCall([idC], 1), "SuperAlreadyEnabled");
    await wallet.connect(self).addSigner(idC);
    await wallet.connect(self).setThreshold(2);
    await wallet.connect(self).removeSigner(idC);
    expect(await wallet.signerCount()).to.equal(2n);
    await expectRevert(wallet.connect(self).setThreshold.staticCall(0), "InvalidThreshold");
    await expectRevert(wallet.connect(self).removeSigner.staticCall(idB), "InvalidThreshold");
    await expectRevert(wallet.connect(self).removeSigner.staticCall(randomIdentityId()), "SignerNotFound");
  });

  it("adds a passkey via wallet execute (bundler path)", async function () {
    const stack = await deployIdentityStack();
    const identityId = randomIdentityId();
    const first = simulatePasskey();
    const second = simulatePasskey();
    await stack.store.register(identityId, first.qx, first.qy);
    const { walletAddress } = await createWallet(stack, identityId, keccak256(toUtf8Bytes("bundler-add")));
    const digest = await stack.store.hashAddMethod(identityId, METHOD_WEBAUTHN, second.qx, second.qy, ZeroAddress);
    const auth = identityPasskeyBlob({ identityId, key: first, message: digest });
    const storeIface = stack.store.interface;
    const callData = encodeExecuteCallData([
      {
        target: stack.storeAddress,
        value: 0n,
        data: storeIface.encodeFunctionData("addMethod", [
          identityId,
          METHOD_WEBAUTHN,
          second.qx,
          second.qy,
          ZeroAddress,
          auth,
        ]),
      },
    ]);
    const nonce = await stack.entryPoint.getNonce(walletAddress, 0);
    const unsigned = buildPackedUserOperation({ sender: walletAddress, nonce, callData });
    const userOpHash = await stack.entryPoint.getUserOpHash(userOpToTuple(unsigned));
    const userOp = buildPackedUserOperation({
      sender: walletAddress,
      nonce,
      callData,
      signature: identityPasskeyBlob({ identityId, key: first, message: userOpHash }),
    });
    await stack.entryPoint.handleOps([userOpToTuple(userOp)], stack.owner.address);
    expect((await stack.store.getIdentity(identityId)).webauthnCount).to.equal(2n);
  });

  it("removes a passkey via wallet execute (bundler path)", async function () {
    const stack = await deployIdentityStack();
    const identityId = randomIdentityId();
    const first = simulatePasskey();
    const second = simulatePasskey();
    await stack.store.register(identityId, first.qx, first.qy);
    const addDigest = await stack.store.hashAddMethod(identityId, METHOD_WEBAUTHN, second.qx, second.qy, ZeroAddress);
    await stack.store.addMethod(
      identityId,
      METHOD_WEBAUTHN,
      second.qx,
      second.qy,
      ZeroAddress,
      identityPasskeyBlob({ identityId, key: first, message: addDigest })
    );
    const { walletAddress } = await createWallet(stack, identityId, keccak256(toUtf8Bytes("bundler-remove")));
    const secondId = computeIdentityMethodId(identityId, METHOD_WEBAUTHN, second.qx, second.qy, ZeroAddress);
    const removeDigest = await stack.store.hashRemoveMethod(identityId, secondId);
    const auth = identityPasskeyBlob({ identityId, key: first, message: removeDigest });
    const storeIface = stack.store.interface;
    const callData = encodeExecuteCallData([
      {
        target: stack.storeAddress,
        value: 0n,
        data: storeIface.encodeFunctionData("removeMethod", [identityId, secondId, auth]),
      },
    ]);
    const nonce = await stack.entryPoint.getNonce(walletAddress, 0);
    const unsigned = buildPackedUserOperation({ sender: walletAddress, nonce, callData });
    const userOpHash = await stack.entryPoint.getUserOpHash(userOpToTuple(unsigned));
    const userOp = buildPackedUserOperation({
      sender: walletAddress,
      nonce,
      callData,
      signature: identityPasskeyBlob({ identityId, key: first, message: userOpHash }),
    });
    await stack.entryPoint.handleOps([userOpToTuple(userOp)], stack.owner.address);
    expect((await stack.store.getIdentity(identityId)).webauthnCount).to.equal(1n);
  });

  it("exposedValidate covers single-blob super when threshold is 1", async function () {
    const stack = await deployIdentityStack();
    const idA = randomIdentityId();
    const pk = simulatePasskey();
    await stack.store.register(idA, pk.qx, pk.qy);
    const { wallet, walletAddress } = await createWallet(stack, idA, keccak256(toUtf8Bytes("t1")));
    await stack.ethers.provider.send("hardhat_impersonateAccount", [walletAddress]);
    await stack.ethers.provider.send("hardhat_setBalance", [walletAddress, "0x1000000000000000000"]);
    const self = await stack.ethers.getSigner(walletAddress);
    await wallet.connect(self).enableSuper([], 1);
    const digest = keccak256(toUtf8Bytes("one"));
    const blob = identityPasskeyBlob({ identityId: idA, key: pk, message: digest });
    expect(await wallet.exposedValidate(digest, blob)).to.equal(true);
    expect(await wallet.exposedValidate(digest, "0x")).to.equal(false);
    expect(await wallet.exposedValidate(digest, encodeSuperIdentityBlobs([blob, blob]))).to.equal(false);
  });

  it("super wallet 2-of-3 initiates a delayed identity restore", async function () {
    const stack = await deployIdentityStack();
    await stack.store.setRestoreDelay(1);
    const alice = randomIdentityId();
    const reco1 = randomIdentityId();
    const reco2 = randomIdentityId();
    const reco3 = randomIdentityId();
    const pkAlice = simulatePasskey();
    const pk1 = simulatePasskey();
    const pk2 = simulatePasskey();
    const pk3 = simulatePasskey();
    const recovered = simulatePasskey();
    await stack.store.register(alice, pkAlice.qx, pkAlice.qy);
    await stack.store.register(reco1, pk1.qx, pk1.qy);
    await stack.store.register(reco2, pk2.qx, pk2.qy);
    await stack.store.register(reco3, pk3.qx, pk3.qy);
    const { wallet, walletAddress } = await createWallet(stack, reco1, keccak256(toUtf8Bytes("reco-super")));
    await stack.ethers.provider.send("hardhat_impersonateAccount", [walletAddress]);
    await stack.ethers.provider.send("hardhat_setBalance", [walletAddress, "0x1000000000000000000"]);
    const self = await stack.ethers.getSigner(walletAddress);
    await wallet.connect(self).enableSuper([reco2, reco3], 2);
    await stack.store.setRecoveryOperator(walletAddress);

    const callData = encodeExecuteCallData([
      {
        target: stack.storeAddress,
        value: 0n,
        data: stack.store.interface.encodeFunctionData("initiateRestore", [
          alice,
          METHOD_WEBAUTHN,
          recovered.qx,
          recovered.qy,
          ZeroAddress,
        ]),
      },
    ]);
    const nonce = await stack.entryPoint.getNonce(walletAddress, 0);
    const unsigned = buildPackedUserOperation({ sender: walletAddress, nonce, callData });
    const userOpHash = await stack.entryPoint.getUserOpHash(userOpToTuple(unsigned));
    const userOp = buildPackedUserOperation({
      sender: walletAddress,
      nonce,
      callData,
      signature: encodeSuperIdentityBlobs([
        identityPasskeyBlob({ identityId: reco1, key: pk1, message: userOpHash }),
        identityPasskeyBlob({ identityId: reco2, key: pk2, message: userOpHash }),
      ]),
    });
    await stack.entryPoint.handleOps([userOpToTuple(userOp)], stack.owner.address);
    expect((await stack.store.pendingRestores(alice)).active).to.equal(true);
    await expectRevert(stack.store.executeRestore.staticCall(alice), "RestoreNotReady");
    await stack.ethers.provider.send("evm_increaseTime", [2]);
    await stack.ethers.provider.send("evm_mine", []);
    await stack.store.executeRestore(alice);
    const login = keccak256(toUtf8Bytes("alice-restored"));
    expect(
      await stack.store.verify(login, identityPasskeyBlob({ identityId: alice, key: recovered, message: login }))
    ).to.equal(alice);
  });
});
