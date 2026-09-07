import { expect } from "chai";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../commerce/server/app.js";
import { loadConfig } from "../commerce/server/config.js";
import { CommerceDb } from "../commerce/server/db.js";
import { resetRateLimitBuckets } from "../commerce/server/rate-limit.js";
import {
  enqueueWalletTransferSync,
  recordIncludedUserOpTransfers,
  resetExplorerSyncForTests,
  setExplorerHttpForTests,
  setExplorerIntervalForTests,
  syncWalletTransfersFromExplorer,
  waitForExplorerSyncForTests,
} from "../commerce/server/wallet-transfer-sync.js";
import {
  buildPackedUserOperation,
  buildSendBatchCalls,
  encodeExecuteCallData,
} from "../commerce/shared/userop.js";
import { outgoingTransfersFromUserOp } from "../commerce/shared/wallet-transfers.js";

const FEE_TOKEN = "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238";
const BENEFICIARY = "0x1111111111111111111111111111111111111111";
const WALLET = "0x2222222222222222222222222222222222222222";
const RECIPIENT = "0x3333333333333333333333333333333333333333";
const SENDER = "0x4444444444444444444444444444444444444444";
const TX = "0x" + "ab".repeat(32);
const USER_OP_HASH = "0x" + "cd".repeat(32);

const BASE_ENV = {
  PORT: "0",
  ADMIN_API_KEY: "admin-transfer-test",
  SWEEPER_API_KEY: "sweeper-transfer-test",
  WALLET_FACTORY_ADDRESS: "0x06964dE197ed29A4DC2D34F68aD4510Afa25f537",
  WALLET_IMPLEMENTATION_ADDRESS: "0xe024cE8ed1878dBdd3ca8E73B1e586c4E46dC85C",
  WALLET_RECOVERY_ADDRESS: "0x72739889bcce2B08a23212bae6C7B9F1C29e7873",
  WALLET_BUNDLER_BENEFICIARY: BENEFICIARY,
  WALLET_BUNDLER_FEE_TOKEN: FEE_TOKEN,
  WALLET_BUNDLER_FEE_USDC: "100000",
  WALLET_FEE_TOKEN_SYMBOL: "USDC",
  WALLET_RPC_URL: "",
  EVM_RPC_URL: "",
  ETHERSCAN_API_KEY: "",
  WALLET_TRANSFER_SYNC_MIN_MS: "45000",
} as const;

const STABLES = [{ symbol: "USDC", address: FEE_TOKEN, decimals: 6 }];

function sendUserOp() {
  const calls = buildSendBatchCalls({
    feeToken: FEE_TOKEN,
    beneficiary: BENEFICIARY,
    feeAmount: 100_000n,
    recipient: RECIPIENT,
    sendAmount: 500_000n,
  });
  return buildPackedUserOperation({
    sender: WALLET,
    nonce: 0n,
    callData: encodeExecuteCallData(calls),
  });
}

describe("wallet in/out transfer ledger", function () {
  afterEach(function () {
    resetExplorerSyncForTests();
    setExplorerHttpForTests(null);
  });

  it("omits bundler fee from decoded money-out", function () {
    const drafts = outgoingTransfersFromUserOp({
      walletAddress: WALLET,
      chainId: "11155111",
      txHash: TX,
      userOpHash: USER_OP_HASH,
      userOp: sendUserOp(),
      stables: STABLES,
      feeTokenAddress: FEE_TOKEN,
      bundlerBeneficiary: BENEFICIARY,
    });
    expect(drafts).to.have.length(1);
    expect(drafts[0].direction).to.equal("out");
    expect(drafts[0].counterparty).to.equal(RECIPIENT.toLowerCase());
    expect(drafts[0].amount).to.equal("500000");
    expect(drafts[0].source).to.equal("userop");
  });

  it("merges explorer and userop rows for the same log", async function () {
    const dir = await mkdtemp(join(tmpdir(), "wallet-transfers-"));
    const db = new CommerceDb(join(dir, "test.db"));
    try {
      const drafts = outgoingTransfersFromUserOp({
        walletAddress: WALLET,
        chainId: "11155111",
        txHash: TX,
        userOpHash: USER_OP_HASH,
        userOp: sendUserOp(),
        stables: STABLES,
        feeTokenAddress: FEE_TOKEN,
        bundlerBeneficiary: BENEFICIARY,
      });
      db.upsertWalletTransfer(drafts[0]);
      db.upsertWalletTransfer({
        walletAddress: WALLET.toLowerCase(),
        chainId: "11155111",
        direction: "out",
        tokenAddress: FEE_TOKEN.toLowerCase(),
        tokenSymbol: "USDC",
        tokenDecimals: 6,
        amount: "500000",
        counterparty: RECIPIENT.toLowerCase(),
        txHash: TX,
        logIndex: 12,
        blockNumber: 99,
        source: "explorer",
        userOpHash: null,
        proposalId: null,
      });
      const rows = db.listWalletTransfers(WALLET, "11155111");
      expect(rows).to.have.length(1);
      expect(rows[0].source).to.equal("userop");
      expect(rows[0].logIndex).to.equal(12);
      expect(rows[0].blockNumber).to.equal(99);
    } finally {
      db.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("records money-out when a userOp is included", async function () {
    const dir = await mkdtemp(join(tmpdir(), "wallet-transfers-"));
    const db = new CommerceDb(join(dir, "test.db"));
    const config = loadConfig({ ...process.env, ...BASE_ENV, DB_PATH: join(dir, "test.db") } as NodeJS.ProcessEnv);
    try {
      db.createWalletUserOp({
        walletAddress: WALLET,
        chainId: "11155111",
        userOpHash: USER_OP_HASH,
        userOp: sendUserOp(),
      });
      const included = db.trackWalletUserOp({
        userOpHash: USER_OP_HASH,
        status: "included",
        txHash: TX,
      });
      recordIncludedUserOpTransfers(db, config, included);
      const rows = db.listWalletTransfers(WALLET);
      expect(rows).to.have.length(1);
      expect(rows[0].direction).to.equal("out");
      expect(rows[0].counterparty).to.equal(RECIPIENT.toLowerCase());
    } finally {
      db.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("does not advance cursor on explorer 429", async function () {
    const dir = await mkdtemp(join(tmpdir(), "wallet-transfers-"));
    const db = new CommerceDb(join(dir, "test.db"));
    const config = loadConfig({
      ...process.env,
      ...BASE_ENV,
      DB_PATH: join(dir, "test.db"),
      ETHERSCAN_API_KEY: "test-key",
    } as NodeJS.ProcessEnv);
    setExplorerIntervalForTests(0);
    setExplorerHttpForTests(async () => ({ status: 429, json: async () => ({}) }));
    try {
      await syncWalletTransfersFromExplorer(db, config, WALLET, "11155111");
      const cursor = db.getWalletTransferSync(WALLET, "11155111");
      expect(cursor?.lastBlock).to.equal(0);
      expect(cursor?.lastFetchedAt).to.be.a("string");
    } finally {
      db.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("paginates explorer tokentx and inserts inbound", async function () {
    const dir = await mkdtemp(join(tmpdir(), "wallet-transfers-"));
    const db = new CommerceDb(join(dir, "test.db"));
    const config = loadConfig({
      ...process.env,
      ...BASE_ENV,
      DB_PATH: join(dir, "test.db"),
      ETHERSCAN_API_KEY: "test-key",
    } as NodeJS.ProcessEnv);
    setExplorerIntervalForTests(0);
    const pages: string[] = [];
    setExplorerHttpForTests(async (url) => {
      const parsed = new URL(url);
      pages.push(parsed.searchParams.get("page") ?? "");
      const page = Number(parsed.searchParams.get("page") ?? "1");
      const row = (n: number) => ({
        blockNumber: String(1000 + n),
        timeStamp: "1700000000",
        hash: "0x" + n.toString(16).padStart(64, "0"),
        from: SENDER,
        to: WALLET,
        contractAddress: FEE_TOKEN,
        value: "1000000",
        tokenSymbol: "USDC",
        tokenDecimal: "6",
        logIndex: "1",
      });
      const result = page === 1 ? Array.from({ length: 100 }, (_, i) => row(i + 1)) : [row(101)];
      return { status: 200, json: async () => ({ status: "1", message: "OK", result }) };
    });
    try {
      await syncWalletTransfersFromExplorer(db, config, WALLET, "11155111");
      expect(pages).to.deep.equal(["1", "2"]);
      const rows = db.listWalletTransfers(WALLET, "11155111", 200);
      expect(rows.some((r) => r.direction === "in")).to.equal(true);
      expect(rows[0].blockNumber).to.equal(1101);
      const cursor = db.getWalletTransferSync(WALLET, "11155111");
      expect(cursor?.lastBlock).to.equal(1101);
    } finally {
      db.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("skips explorer enqueue during cooldown", async function () {
    const dir = await mkdtemp(join(tmpdir(), "wallet-transfers-"));
    const db = new CommerceDb(join(dir, "test.db"));
    const config = loadConfig({
      ...process.env,
      ...BASE_ENV,
      DB_PATH: join(dir, "test.db"),
      ETHERSCAN_API_KEY: "test-key",
    } as NodeJS.ProcessEnv);
    setExplorerIntervalForTests(0);
    let calls = 0;
    setExplorerHttpForTests(async () => {
      calls += 1;
      return { status: 200, json: async () => ({ status: "1", message: "OK", result: [] }) };
    });
    try {
      enqueueWalletTransferSync(db, config, WALLET, "11155111");
      await waitForExplorerSyncForTests();
      expect(calls).to.equal(1);
      enqueueWalletTransferSync(db, config, WALLET, "11155111");
      await waitForExplorerSyncForTests();
      expect(calls).to.equal(1);
    } finally {
      db.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("lists mixed in/out over the HTTP API", async function () {
    resetRateLimitBuckets();
    const dir = await mkdtemp(join(tmpdir(), "wallet-transfers-http-"));
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
    try {
      app.db.upsertWalletTransfer({
        walletAddress: WALLET.toLowerCase(),
        chainId: "11155111",
        direction: "in",
        tokenAddress: FEE_TOKEN.toLowerCase(),
        tokenSymbol: "USDC",
        tokenDecimals: 6,
        amount: "2000000",
        counterparty: SENDER.toLowerCase(),
        txHash: "0x" + "11".repeat(32),
        logIndex: 1,
        blockNumber: 50,
        source: "explorer",
        userOpHash: null,
        proposalId: null,
      });
      app.db.upsertWalletTransfer({
        walletAddress: WALLET.toLowerCase(),
        chainId: "11155111",
        direction: "out",
        tokenAddress: FEE_TOKEN.toLowerCase(),
        tokenSymbol: "USDC",
        tokenDecimals: 6,
        amount: "500000",
        counterparty: RECIPIENT.toLowerCase(),
        txHash: TX,
        logIndex: 2,
        blockNumber: 40,
        source: "userop",
        userOpHash: USER_OP_HASH,
        proposalId: null,
      });
      const res = await fetch(`${baseUrl}/api/wallet/transfers?wallet=${WALLET}`);
      expect(res.status).to.equal(200);
      const body = (await res.json()) as { transfers: Array<{ direction: string; blockNumber: number }> };
      expect(body.transfers).to.have.length(2);
      expect(body.transfers[0].direction).to.equal("in");
      expect(body.transfers[0].blockNumber).to.equal(50);
      expect(body.transfers[1].direction).to.equal("out");
    } finally {
      await app.close();
      await rm(dir, { recursive: true, force: true });
    }
  });
});
