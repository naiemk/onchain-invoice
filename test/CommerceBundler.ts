import { expect } from "chai";
import { Wallet, getAddress } from "ethers";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../commerce/server/app.js";
import { loadConfig } from "../commerce/server/config.js";
import { signBundlerRequest } from "../commerce/server/bundler-auth.js";
import {
  buildPackedUserOperation,
  buildSendBatchCalls,
  encodeExecuteCallData,
  estimateUserOpPrefund,
  type PackedUserOperationJson,
} from "../commerce/shared/userop.js";
import { validateSendUserOp, validateUserOpFee } from "../commerce/shared/userop-fee.js";

const ADMIN = "admin-bundler-test";
const BENEFICIARY = "0x1111111111111111111111111111111111111111";
const FEE_TOKEN = "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238";
const WALLET = "0x2222222222222222222222222222222222222222";
const RECIPIENT = "0x3333333333333333333333333333333333333333";

const BASE_ENV = {
  PORT: "0",
  ADMIN_API_KEY: ADMIN,
  SWEEPER_API_KEY: "sweeper-test",
  WALLET_BUNDLER_BENEFICIARY: BENEFICIARY,
  WALLET_BUNDLER_FEE_TOKEN: FEE_TOKEN,
  WALLET_BUNDLER_FEE_USDC: "100000",
  WALLET_FACTORY_ADDRESS: "0x06964dE197ed29A4DC2D34F68aD4510Afa25f537",
  WALLET_RPC_URL: "",
  EVM_RPC_URL: "",
} as const;

function feeConfig() {
  return {
    feeTokenAddress: FEE_TOKEN,
    feeTokenSymbol: "USDC",
    feeTokenDecimals: 6,
    bundlerBeneficiary: BENEFICIARY,
    minFeeUsdc: 100_000n,
  };
}

function sampleSendUserOp(feeAmount = 100_000n, sendAmount = 500_000n): PackedUserOperationJson {
  const callData = encodeExecuteCallData(
    buildSendBatchCalls({
      feeToken: FEE_TOKEN,
      beneficiary: BENEFICIARY,
      feeAmount,
      recipient: RECIPIENT,
      sendAmount,
    })
  );
  return buildPackedUserOperation({
    sender: WALLET,
    nonce: 0n,
    callData,
    signature: "0x1234",
  });
}

describe("commerce bundler + userOp fee", function () {
  it("estimates EntryPoint prefund from packed gas fields", function () {
    const userOp = buildPackedUserOperation({
      sender: WALLET,
      nonce: 0n,
      callData: "0x",
      gas: {
        verificationGasLimit: 500_000n,
        callGasLimit: 350_000n,
        preVerificationGas: 50_000n,
        maxFeePerGas: 1_000_000_000n,
        maxPriorityFeePerGas: 1_000_000_000n,
      },
    });
    // (500k + 350k + 50k) * 1 gwei
    expect(estimateUserOpPrefund(userOp)).to.equal(900_000n * 1_000_000_000n);
  });

  it("validates fee-first batch on send userOp", function () {
    const userOp = sampleSendUserOp();
    const result = validateSendUserOp(userOp, feeConfig());
    expect(result.ok).to.equal(true);
    expect(result.sendAmount).to.equal(500_000n);
    expect(result.recipient).to.equal(getAddress(RECIPIENT));
  });

  it("rejects underpaid bundler fee", function () {
    const userOp = sampleSendUserOp(50_000n);
    const result = validateUserOpFee(userOp, feeConfig());
    expect(result.ok).to.equal(false);
    expect(result.reason).to.equal("fee_too_low");
  });

  async function withApp(fn: (baseUrl: string, bundler: Wallet) => Promise<void>): Promise<void> {
    const dir = await mkdtemp(join(tmpdir(), "commerce-bundler-"));
    const config = loadConfig({
      ...process.env,
      ...BASE_ENV,
      DB_PATH: join(dir, "test.db"),
    } as NodeJS.ProcessEnv);
    const app = createApp(config);
    await new Promise<void>((resolve) => {
      app.server.listen(0, "127.0.0.1", () => resolve());
    });
    const address = app.server.address();
    if (!address || typeof address === "string") throw new Error("expected TCP address");
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const bundler = Wallet.createRandom();
    try {
      const reg = await fetch(`${baseUrl}/api/admin/bundlers`, {
        method: "POST",
        headers: { "x-api-key": ADMIN, "content-type": "application/json" },
        body: JSON.stringify({ address: bundler.address, label: "test", chains: ["11155111"] }),
      });
      expect(reg.status).to.equal(201);
      await fn(baseUrl, bundler);
    } finally {
      await app.close();
      await rm(dir, { recursive: true, force: true });
    }
  }

  it("accepts userOp submit and bundler claim/track", async function () {
    await withApp(async (baseUrl, bundler) => {
      const userOp = sampleSendUserOp();
      const userOpHash = "0x" + "ab".repeat(32);
      const submit = await fetch(`${baseUrl}/api/wallet/userops`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chainId: "11155111", userOpHash, userOp }),
      });
      expect(submit.status).to.equal(201);
      const created = (await submit.json()) as { userOp: { version: number; status: string } };
      expect(created.userOp.status).to.equal("pending");

      const dup = await fetch(`${baseUrl}/api/wallet/userops`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chainId: "11155111", userOpHash, userOp }),
      });
      expect(dup.status).to.equal(409);

      const listHeaders = await signBundlerRequest(bundler, { method: "GET", path: "/api/bundler/userops" });
      const list = await fetch(`${baseUrl}/api/bundler/userops`, { headers: listHeaders });
      expect(list.status).to.equal(200);
      const listed = (await list.json()) as { userOps: Array<{ userOpHash: string }> };
      expect(listed.userOps.some((u) => u.userOpHash === userOpHash.toLowerCase())).to.equal(true);

      const claimHeaders = await signBundlerRequest(bundler, {
        method: "POST",
        path: "/api/bundler/claim",
        body: JSON.stringify({ userOpHash, expectedVersion: created.userOp.version }),
      });
      const claim = await fetch(`${baseUrl}/api/bundler/claim`, {
        method: "POST",
        headers: { ...claimHeaders, "content-type": "application/json" },
        body: JSON.stringify({ userOpHash, expectedVersion: created.userOp.version }),
      });
      expect(claim.status).to.equal(200);

      const trackHeaders = await signBundlerRequest(bundler, {
        method: "POST",
        path: "/api/bundler/track",
        body: JSON.stringify({
          userOpHash,
          status: "included",
          txHash: "0xdead",
          expectedVersion: created.userOp.version + 1,
        }),
      });
      const track = await fetch(`${baseUrl}/api/bundler/track`, {
        method: "POST",
        headers: { ...trackHeaders, "content-type": "application/json" },
        body: JSON.stringify({
          userOpHash,
          status: "included",
          txHash: "0xdead",
          expectedVersion: created.userOp.version + 1,
        }),
      });
      expect(track.status).to.equal(200);
      const done = (await track.json()) as { userOp: { status: string; txHash: string | null } };
      expect(done.userOp.status).to.equal("included");
      expect(done.userOp.txHash).to.equal("0xdead");
    });
  });

  it("requeues rejected userOp with the same hash", async function () {
    await withApp(async (baseUrl, bundler) => {
      const userOp = sampleSendUserOp();
      const userOpHash = "0x" + "cd".repeat(32);
      const submit = await fetch(`${baseUrl}/api/wallet/userops`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chainId: "11155111", userOpHash, userOp }),
      });
      expect(submit.status).to.equal(201);
      const created = (await submit.json()) as { userOp: { version: number } };

      const claimHeaders = await signBundlerRequest(bundler, {
        method: "POST",
        path: "/api/bundler/claim",
        body: JSON.stringify({ userOpHash, expectedVersion: created.userOp.version }),
      });
      const claim = await fetch(`${baseUrl}/api/bundler/claim`, {
        method: "POST",
        headers: { ...claimHeaders, "content-type": "application/json" },
        body: JSON.stringify({ userOpHash, expectedVersion: created.userOp.version }),
      });
      expect(claim.status).to.equal(200);

      const trackHeaders = await signBundlerRequest(bundler, {
        method: "POST",
        path: "/api/bundler/track",
        body: JSON.stringify({
          userOpHash,
          status: "rejected",
          rejectReason: "simulation_revert",
          expectedVersion: created.userOp.version + 1,
        }),
      });
      const track = await fetch(`${baseUrl}/api/bundler/track`, {
        method: "POST",
        headers: { ...trackHeaders, "content-type": "application/json" },
        body: JSON.stringify({
          userOpHash,
          status: "rejected",
          rejectReason: "simulation_revert",
          expectedVersion: created.userOp.version + 1,
        }),
      });
      expect(track.status).to.equal(200);

      const retry = await fetch(`${baseUrl}/api/wallet/userops`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chainId: "11155111", userOpHash, userOp }),
      });
      expect(retry.status).to.equal(200);
      const body = (await retry.json()) as { userOp: { status: string; rejectReason: string | null } };
      expect(body.userOp.status).to.equal("pending");
      expect(body.userOp.rejectReason).to.equal(null);
    });
  });
});
