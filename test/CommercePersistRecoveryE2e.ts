import { expect } from "chai";
import { network } from "hardhat";
import { Contract } from "ethers";
import { unlink } from "node:fs/promises";
import { join } from "node:path";
import { createApp } from "../commerce/server/app.js";
import { loadConfig } from "../commerce/server/config.js";
import { replayPersistLogsToDb } from "../commerce/server/persist-replay.js";
import { CommerceDb } from "../commerce/server/db.js";
import {
  PAY_UNITS,
  PRODUCT_CHAIN_ID,
  HH_DEPLOYER_KEY,
  codeAt,
  createInvoiceForWallet,
  createPasskeyWallet,
  deployPersistRecoveryStack,
  expectedMerchantAmount,
  listenApp,
  makeSweeperWorker,
  makeWalletDeployer,
  mkPersistWorkDir,
  payInvoice,
  persistRecoveryApiEnv,
  registerSweeper,
  rmWorkDir,
  startJsonRpcServer,
  tickUntil,
  tokenBalance,
  drainWalletsToCollector,
  type PersistRecoveryStack,
} from "./helpers/persist-recovery-harness.js";

/** 3–4× the original 5×3 matrix. */
const WALLET_COUNT = 16;
const INVOICES_PER_WALLET = 10;
const ADMIN_KEY = "admin-persist-recovery";
const SETTLE_MS = 180_000;

type WalletSpec = {
  address: string;
  salt: string;
  ownerQx: string;
  ownerQy: string;
  credentialId: string;
  invoices: { id: string; invoiceAddress: string }[];
};

type WorkerFlags = { sweeper: boolean; deployer: boolean };

const PERMUTATIONS: { name: string; keyOffset: number; during: WorkerFlags }[] = [
  { name: "sweeper off, deployer off (unswept forwarders)", keyOffset: 0, during: { sweeper: false, deployer: false } },
  { name: "sweeper on, deployer off (swept, undeployed)", keyOffset: 20, during: { sweeper: true, deployer: false } },
  { name: "sweeper off, deployer on (unswept, deployer backoff)", keyOffset: 40, during: { sweeper: false, deployer: true } },
  { name: "sweeper on, deployer on (fully settled)", keyOffset: 60, during: { sweeper: true, deployer: true } },
];

describe("commerce persist-log recovery e2e", function () {
  this.timeout(600_000);

  let ethers: any;
  let rpcUrl: string;
  let closeRpc: () => Promise<void>;
  let stack: PersistRecoveryStack;
  let usdc: Contract;

  before(async function () {
    const created = (await network.create()) as Awaited<ReturnType<typeof network.create>> & { ethers: any };
    ethers = created.ethers;
    const rpc = await startJsonRpcServer(ethers.provider);
    rpcUrl = rpc.url;
    closeRpc = rpc.close;
    stack = await deployPersistRecoveryStack(ethers);
    usdc = await ethers.getContractAt("MockERC20", stack.usdcAddress);
  });

  after(async function () {
    await closeRpc?.();
  });

  async function seedWalletsAndPay(baseUrl: string, keyOffset: number): Promise<WalletSpec[]> {
    const wallets: WalletSpec[] = [];
    for (let i = 0; i < WALLET_COUNT; i++) {
      const created = await createPasskeyWallet(
        baseUrl,
        stack.factoryAddress,
        stack.implementationAddress,
        keyOffset + i
      );
      const invoices = [];
      for (let j = 0; j < INVOICES_PER_WALLET; j++) {
        const invoice = await createInvoiceForWallet(baseUrl, created.address);
        await payInvoice(usdc, stack.payer as unknown as import("ethers").Wallet, invoice.invoiceAddress);
        invoices.push({ id: invoice.id, invoiceAddress: invoice.invoiceAddress });
      }
      wallets.push({ ...created, invoices });
    }
    return wallets;
  }

  async function assertKeys(baseUrl: string, wallets: WalletSpec[]): Promise<void> {
    for (const wallet of wallets) {
      const res = await fetch(`${baseUrl}/api/wallet/accounts/${wallet.address}`);
      expect(res.status, `account ${wallet.address}`).to.equal(200);
      const body = (await res.json()) as {
        account?: { ownerQx?: string; ownerQy?: string; salt?: string; credentialId?: string };
      };
      expect(body.account?.ownerQx).to.equal(wallet.ownerQx);
      expect(body.account?.ownerQy).to.equal(wallet.ownerQy);
      expect(body.account?.salt).to.equal(wallet.salt);
      expect(body.account?.credentialId).to.equal(wallet.credentialId);

      const byCred = await fetch(
        `${baseUrl}/api/wallet/accounts?credentialId=${encodeURIComponent(wallet.credentialId)}`
      );
      expect(byCred.status, `credential ${wallet.credentialId}`).to.equal(200);
      const credBody = (await byCred.json()) as { account?: { address?: string } };
      expect(credBody.account?.address?.toLowerCase()).to.equal(wallet.address.toLowerCase());
    }
  }

  async function invoicesDrained(wallets: WalletSpec[]): Promise<boolean> {
    for (const wallet of wallets) {
      for (const invoice of wallet.invoices) {
        if ((await tokenBalance(rpcUrl, stack.usdcAddress, invoice.invoiceAddress)) !== 0n) return false;
      }
    }
    return true;
  }

  async function walletsFunded(wallets: WalletSpec[], expected: bigint): Promise<boolean> {
    for (const wallet of wallets) {
      if ((await tokenBalance(rpcUrl, stack.usdcAddress, wallet.address)) !== expected) return false;
    }
    return true;
  }

  async function walletsDeployed(wallets: WalletSpec[]): Promise<boolean> {
    for (const wallet of wallets) {
      if ((await codeAt(rpcUrl, wallet.address)) === "0x") return false;
    }
    return true;
  }

  async function pokeActivation(baseUrl: string, wallets: WalletSpec[]): Promise<void> {
    for (const wallet of wallets) {
      await fetch(`${baseUrl}/api/wallet/balance?wallet=${wallet.address}`);
    }
  }

  async function restartFromLogs(work: { dir: string; persistLogDir: string }, oldDbPath: string) {
    const restoredPath = join(work.dir, "restored.db");
    await unlink(oldDbPath).catch(() => undefined);
    await unlink(`${oldDbPath}-wal`).catch(() => undefined);
    await unlink(`${oldDbPath}-shm`).catch(() => undefined);
    const replayDb = new CommerceDb(restoredPath);
    const state = await replayPersistLogsToDb(replayDb, work.persistLogDir);
    expect(state.wallets.accounts.size).to.be.at.least(WALLET_COUNT);
    expect(state.invoices.invoices.size).to.be.at.least(WALLET_COUNT * INVOICES_PER_WALLET);
    replayDb.close();
    const env = persistRecoveryApiEnv({ dbPath: restoredPath, persistLogDir: work.persistLogDir, rpcUrl, stack });
    const app = createApp(loadConfig(env));
    const baseUrl = await listenApp(app);
    await registerSweeper(baseUrl, await stack.owner.getAddress(), ADMIN_KEY);
    return { app, baseUrl };
  }

  async function settleAll(baseUrl: string, wallets: WalletSpec[], expected: bigint): Promise<void> {
    const sweeper = makeSweeperWorker({ baseUrl, rpcUrl, stack, privateKey: HH_DEPLOYER_KEY });
    const deployer = makeWalletDeployer({ baseUrl, rpcUrl, stack, privateKey: HH_DEPLOYER_KEY });
    await tickUntil(() => sweeper.tick(), () => invoicesDrained(wallets), SETTLE_MS);
    expect(await walletsFunded(wallets, expected), "wallet USDC after sweep").to.equal(true);
    await tickUntil(
      async () => {
        await pokeActivation(baseUrl, wallets);
        await deployer.tick();
      },
      () => walletsDeployed(wallets),
      SETTLE_MS
    );
  }

  async function assertFullyRecovered(baseUrl: string, wallets: WalletSpec[], expected: bigint): Promise<void> {
    await assertKeys(baseUrl, wallets);
    expect(await invoicesDrained(wallets), "all forwarders empty").to.equal(true);
    expect(await walletsFunded(wallets, expected), "all wallets hold net paid").to.equal(true);
    expect(await walletsDeployed(wallets), "all wallets have code").to.equal(true);
    for (const wallet of wallets) {
      for (const invoice of wallet.invoices) {
        const inv = await fetch(`${baseUrl}/api/invoices/${invoice.id}`);
        expect(inv.status, `invoice ${invoice.id}`).to.equal(200);
        const body = (await inv.json()) as { status?: string; invoiceAddress?: string; invoiceSeed?: string };
        expect(body.status).to.equal("swept");
        expect(body.invoiceAddress?.toLowerCase()).to.equal(invoice.invoiceAddress.toLowerCase());
        expect(body.invoiceSeed).to.match(/^0x[0-9a-fA-F]{64}$/);
      }
      const recover = await fetch(
        `${baseUrl}/api/wallet/accounts/${wallet.address}/recover-info?chainId=${PRODUCT_CHAIN_ID}`
      );
      expect(recover.status, `recover-info ${wallet.address}`).to.equal(200);
    }
  }

  /** New invoice + pay + sweep against restored keys proves the merchant address is usable again. */
  async function assertCanUseWalletsAgain(baseUrl: string, wallets: WalletSpec[], expectedBefore: bigint): Promise<void> {
    const extraInvoices: WalletSpec["invoices"] = [];
    for (const wallet of wallets) {
      const invoice = await createInvoiceForWallet(baseUrl, wallet.address);
      await payInvoice(usdc, stack.payer as unknown as import("ethers").Wallet, invoice.invoiceAddress);
      extraInvoices.push({ id: invoice.id, invoiceAddress: invoice.invoiceAddress });
    }
    const withExtra = wallets.map((wallet, i) => ({
      ...wallet,
      invoices: [extraInvoices[i]!],
    }));
    const sweeper = makeSweeperWorker({ baseUrl, rpcUrl, stack, privateKey: HH_DEPLOYER_KEY });
    await tickUntil(() => sweeper.tick(), () => invoicesDrained(withExtra), SETTLE_MS);
    const expectedAfter = expectedBefore + expectedMerchantAmount(PAY_UNITS);
    expect(await walletsFunded(wallets, expectedAfter), "reuse payment reached wallets").to.equal(true);
    expect(await walletsDeployed(wallets)).to.equal(true);
    await assertKeys(baseUrl, wallets);
    for (const extra of extraInvoices) {
      const inv = await fetch(`${baseUrl}/api/invoices/${extra.id}`);
      expect(inv.status).to.equal(200);
      const body = (await inv.json()) as { status?: string };
      expect(body.status).to.equal("swept");
    }
  }

  async function runPermutation(label: string, keyOffset: number, during: WorkerFlags): Promise<void> {
    const work = await mkPersistWorkDir();
    const env = persistRecoveryApiEnv({ dbPath: work.dbPath, persistLogDir: work.persistLogDir, rpcUrl, stack });
    let app = createApp(loadConfig(env));
    let baseUrl = await listenApp(app);
    try {
      await registerSweeper(baseUrl, await stack.owner.getAddress(), ADMIN_KEY);
      const wallets = await seedWalletsAndPay(baseUrl, keyOffset);
      const expected = expectedMerchantAmount(PAY_UNITS) * BigInt(INVOICES_PER_WALLET);
      const sweeper = makeSweeperWorker({ baseUrl, rpcUrl, stack, privateKey: HH_DEPLOYER_KEY });
      const deployer = makeWalletDeployer({ baseUrl, rpcUrl, stack, privateKey: HH_DEPLOYER_KEY });

      if (during.sweeper) {
        await tickUntil(() => sweeper.tick(), () => invoicesDrained(wallets), SETTLE_MS);
        expect(await walletsFunded(wallets, expected)).to.equal(true);
      } else {
        for (const wallet of wallets) {
          for (const invoice of wallet.invoices) {
            expect(await tokenBalance(rpcUrl, stack.usdcAddress, invoice.invoiceAddress)).to.equal(PAY_UNITS);
          }
          expect(await tokenBalance(rpcUrl, stack.usdcAddress, wallet.address)).to.equal(0n);
        }
      }

      if (during.deployer && during.sweeper) {
        await tickUntil(
          async () => {
            await pokeActivation(baseUrl, wallets);
            await deployer.tick();
          },
          () => walletsDeployed(wallets),
          SETTLE_MS
        );
        expect(await walletsDeployed(wallets)).to.equal(true);
      } else {
        if (during.deployer) {
          await pokeActivation(baseUrl, wallets);
          await deployer.tick();
        }
        for (const wallet of wallets) {
          expect(await codeAt(rpcUrl, wallet.address), `${label} ${wallet.address} still counterfactual`).to.equal(
            "0x"
          );
        }
      }

      await app.close();
      const restored = await restartFromLogs(work, work.dbPath);
      app = restored.app;
      baseUrl = restored.baseUrl;
      await assertKeys(baseUrl, wallets);

      await settleAll(baseUrl, wallets, expected);
      await assertFullyRecovered(baseUrl, wallets, expected);
      await assertCanUseWalletsAgain(baseUrl, wallets, expected);

      const expectedAfterReuse = expected + expectedMerchantAmount(PAY_UNITS);
      expect(await walletsFunded(wallets, expectedAfterReuse)).to.equal(true);
      const collected = await drainWalletsToCollector({
        ethers,
        rpcUrl,
        usdcAddress: stack.usdcAddress,
        walletAddresses: wallets.map((w) => w.address),
        collector: await stack.collector.getAddress(),
      });
      expect(collected).to.equal(expectedAfterReuse * BigInt(wallets.length));
      for (const wallet of wallets) {
        expect(await tokenBalance(rpcUrl, stack.usdcAddress, wallet.address)).to.equal(0n);
        expect(await codeAt(rpcUrl, wallet.address)).to.not.equal("0x");
      }
      await assertKeys(baseUrl, wallets);
    } finally {
      await app.close().catch(() => undefined);
      await rmWorkDir(work.dir);
    }
  }

  for (const perm of PERMUTATIONS) {
    it(perm.name, async function () {
      await runPermutation(perm.name, perm.keyOffset, perm.during);
    });
  }
});
