/**
 * Live Sepolia persist-log recovery: local API + real chain.
 *
 *   LIVE_PERSIST_RECOVERY=1 npx hardhat test test/live/LivePersistRecovery.ts
 *
 * Requires SEPOLIA_RPC_URL, EVM_PRIVATE_KEY (USDC + gas), SWEEPER_ADDRESS,
 * FORWARDER_IMPLEMENTATION, WALLET_FACTORY_ADDRESS (defaults to published Sepolia wallet).
 */
import { expect } from "chai";
import { Contract, JsonRpcProvider, Wallet, formatUnits, getAddress } from "ethers";
import { unlink } from "node:fs/promises";
import { join } from "node:path";
import { createApp } from "../../commerce/server/app.js";
import { loadConfig } from "../../commerce/server/config.js";
import { CommerceDb } from "../../commerce/server/db.js";
import { replayPersistLogsToDb } from "../../commerce/server/persist-replay.js";
import {
  PRODUCT_CHAIN_ID,
  codeAt,
  createInvoiceForWallet,
  createPasskeyWallet,
  expectedMerchantAmount,
  listenApp,
  makeSweeperWorker,
  makeWalletDeployer,
  mkPersistWorkDir,
  persistRecoveryApiEnv,
  registerSweeper,
  rmWorkDir,
  tickUntil,
  tokenBalance,
  type PersistRecoveryStack,
} from "../helpers/persist-recovery-harness.js";

const SEPOLIA_USDC = "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238";
const SEPOLIA_FACTORY = "0x805131afe47723819B7b81dA25256429d77aa12E";
const SEPOLIA_IMPL = "0x4D19ce70D3D4a63cBa685665B39C133141B5dDC2";
const SEPOLIA_RECOVERY = "0xC68914FF4EE1d9A7f263ea550DAf6d89EB801D91";
/** 3× the original 2×2 matrix. */
const WALLET_COUNT = 6;
const INVOICES_PER_WALLET = 6;
const AMOUNT = 50_000n; // 0.05 USDC
const ADMIN_KEY = "admin-persist-recovery";
const FEE_ABI = ["function feeBps() view returns (uint16)", "function forwarderImplementation() view returns (address)"];
const SETTLE_MS = 480_000;

type WalletSpec = {
  address: string;
  salt: string;
  ownerQx: string;
  ownerQy: string;
  credentialId: string;
  invoices: { id: string; invoiceAddress: string }[];
};

type WorkerFlags = { sweeper: boolean; deployer: boolean };

function liveEnabled(): boolean {
  return process.env.LIVE_PERSIST_RECOVERY === "1" || process.env.LIVE_PERSIST_RECOVERY === "true";
}

describe("Live persist-log recovery (Sepolia)", function () {
  this.timeout(900_000);

  before(function () {
    if (!liveEnabled()) this.skip();
  });

  async function runScenario(label: string, keyOffset: number, during: WorkerFlags): Promise<void> {
    const pk = process.env.EVM_PRIVATE_KEY?.trim() || process.env.SWEEPER_PRIVATE_KEY?.trim();
    const rpcUrl = process.env.SEPOLIA_RPC_URL?.trim() || process.env.EVM_RPC_URL?.trim();
    const sweeperAddress = process.env.SWEEPER_ADDRESS?.trim();
    const forwarderImplementation = process.env.FORWARDER_IMPLEMENTATION?.trim();
    if (!pk || !rpcUrl || !sweeperAddress) {
      throw new Error("LIVE_PERSIST_RECOVERY requires EVM_PRIVATE_KEY, SEPOLIA_RPC_URL, SWEEPER_ADDRESS");
    }

    const provider = new JsonRpcProvider(rpcUrl!);
    const signer = new Wallet(pk!, provider);
    const usdc = new Contract(
      SEPOLIA_USDC,
      ["function balanceOf(address) view returns (uint256)", "function transfer(address to, uint256 amount) returns (bool)"],
      signer
    );
    const sweeper = new Contract(sweeperAddress!, FEE_ABI, provider);
    const feeBps = Number(await sweeper.feeBps());
    const forwarder = forwarderImplementation || getAddress(await sweeper.forwarderImplementation());
    const stack: PersistRecoveryStack = {
      sweeperAddress: getAddress(sweeperAddress!),
      forwarderImplementation: getAddress(forwarder),
      factoryAddress: process.env.WALLET_FACTORY_ADDRESS?.trim() || SEPOLIA_FACTORY,
      implementationAddress: process.env.WALLET_IMPLEMENTATION_ADDRESS?.trim() || SEPOLIA_IMPL,
      recoveryAddress: process.env.WALLET_RECOVERY_ADDRESS?.trim() || SEPOLIA_RECOVERY,
      usdcAddress: SEPOLIA_USDC,
      feeRecipient: await signer.getAddress(),
      owner: signer,
      payer: signer,
      collector: signer,
    };

    const need = AMOUNT * BigInt(WALLET_COUNT * INVOICES_PER_WALLET + WALLET_COUNT);
    const bal = BigInt(await usdc.balanceOf(await signer.getAddress()));
    if (bal < need) {
      throw new Error(
        `${label}: need ≥ ${formatUnits(need, 6)} Sepolia USDC on ${await signer.getAddress()}; have ${formatUnits(bal, 6)}`
      );
    }

    const work = await mkPersistWorkDir();
    const env = persistRecoveryApiEnv({
      dbPath: work.dbPath,
      persistLogDir: work.persistLogDir,
      rpcUrl: rpcUrl!,
      stack,
    });
    let app = createApp(loadConfig(env));
    let baseUrl = await listenApp(app);
    try {
      await registerSweeper(baseUrl, await signer.getAddress(), ADMIN_KEY);
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
          const tx = await usdc.transfer(invoice.invoiceAddress, AMOUNT);
          await tx.wait();
          invoices.push(invoice);
        }
        wallets.push({ ...created, invoices });
      }

      const workerSweeper = makeSweeperWorker({
        baseUrl,
        rpcUrl: rpcUrl!,
        stack,
        privateKey: pk!,
      });
      const workerDeployer = makeWalletDeployer({
        baseUrl,
        rpcUrl: rpcUrl!,
        stack,
        privateKey: pk!,
      });
      const expectedEach = expectedMerchantAmount(AMOUNT, feeBps) * BigInt(INVOICES_PER_WALLET);

      if (during.sweeper) {
        await tickUntil(
          () => workerSweeper.tick(),
          async () => {
            for (const wallet of wallets) {
              for (const invoice of wallet.invoices) {
                if ((await tokenBalance(rpcUrl!, stack.usdcAddress, invoice.invoiceAddress)) !== 0n) return false;
              }
              if ((await tokenBalance(rpcUrl!, stack.usdcAddress, wallet.address)) !== expectedEach) return false;
            }
            return true;
          },
          SETTLE_MS,
          4_000
        );
      }

      if (during.deployer && during.sweeper) {
        await tickUntil(
          async () => {
            for (const wallet of wallets) {
              await fetch(`${baseUrl}/api/wallet/balance?wallet=${wallet.address}`);
            }
            await workerDeployer.tick();
          },
          async () => {
            for (const wallet of wallets) {
              if ((await codeAt(rpcUrl!, wallet.address)) === "0x") return false;
            }
            return true;
          },
          SETTLE_MS,
          4_000
        );
      } else if (during.deployer) {
        for (const wallet of wallets) {
          await fetch(`${baseUrl}/api/wallet/balance?wallet=${wallet.address}`);
        }
        await workerDeployer.tick();
      }

      await app.close();
      const restoredPath = join(work.dir, "restored.db");
      await unlink(work.dbPath).catch(() => undefined);
      const replayDb = new CommerceDb(restoredPath);
      const state = await replayPersistLogsToDb(replayDb, work.persistLogDir);
      expect(state.wallets.accounts.size).to.be.at.least(WALLET_COUNT);
      expect(state.invoices.invoices.size).to.be.at.least(WALLET_COUNT * INVOICES_PER_WALLET);
      replayDb.close();

      const restoredEnv = persistRecoveryApiEnv({
        dbPath: restoredPath,
        persistLogDir: work.persistLogDir,
        rpcUrl: rpcUrl!,
        stack,
      });
      app = createApp(loadConfig(restoredEnv));
      baseUrl = await listenApp(app);
      await registerSweeper(baseUrl, await signer.getAddress(), ADMIN_KEY);

      for (const wallet of wallets) {
        const res = await fetch(`${baseUrl}/api/wallet/accounts/${wallet.address}`);
        expect(res.status, `${label} account ${wallet.address}`).to.equal(200);
        const body = (await res.json()) as { account?: { ownerQx?: string; ownerQy?: string; salt?: string } };
        expect(body.account?.ownerQx).to.equal(wallet.ownerQx);
        expect(body.account?.ownerQy).to.equal(wallet.ownerQy);
        expect(body.account?.salt).to.equal(wallet.salt);
        const byCred = await fetch(
          `${baseUrl}/api/wallet/accounts?credentialId=${encodeURIComponent(wallet.credentialId)}`
        );
        expect(byCred.status).to.equal(200);
      }

      const recoverySweeper = makeSweeperWorker({ baseUrl, rpcUrl: rpcUrl!, stack, privateKey: pk! });
      const recoveryDeployer = makeWalletDeployer({
        baseUrl,
        rpcUrl: rpcUrl!,
        stack,
        privateKey: pk!,
      });
      await tickUntil(
        () => recoverySweeper.tick(),
        async () => {
          for (const wallet of wallets) {
            for (const invoice of wallet.invoices) {
              if ((await tokenBalance(rpcUrl!, stack.usdcAddress, invoice.invoiceAddress)) !== 0n) return false;
            }
          }
          return true;
        },
        SETTLE_MS,
        4_000
      );
      await tickUntil(
        async () => {
          for (const wallet of wallets) {
            await fetch(`${baseUrl}/api/wallet/balance?wallet=${wallet.address}`);
          }
          await recoveryDeployer.tick();
        },
        async () => {
          for (const wallet of wallets) {
            if ((await tokenBalance(rpcUrl!, stack.usdcAddress, wallet.address)) !== expectedEach) return false;
            if ((await codeAt(rpcUrl!, wallet.address)) === "0x") return false;
          }
          return true;
        },
        SETTLE_MS,
        4_000
      );

      const extraInvoices: { id: string; invoiceAddress: string }[] = [];
      for (const wallet of wallets) {
        const invoice = await createInvoiceForWallet(baseUrl, wallet.address);
        const tx = await usdc.transfer(invoice.invoiceAddress, AMOUNT);
        await tx.wait();
        extraInvoices.push(invoice);
      }
      await tickUntil(
        () => recoverySweeper.tick(),
        async () => {
          for (const invoice of extraInvoices) {
            if ((await tokenBalance(rpcUrl!, stack.usdcAddress, invoice.invoiceAddress)) !== 0n) return false;
          }
          return true;
        },
        SETTLE_MS,
        4_000
      );
      const expectedAfter = expectedEach + expectedMerchantAmount(AMOUNT, feeBps);
      for (const wallet of wallets) {
        expect(await tokenBalance(rpcUrl!, stack.usdcAddress, wallet.address)).to.equal(expectedAfter);
        expect(await codeAt(rpcUrl!, wallet.address)).to.not.equal("0x");
        const res = await fetch(`${baseUrl}/api/wallet/accounts/${wallet.address}`);
        expect(res.status).to.equal(200);
        const recover = await fetch(
          `${baseUrl}/api/wallet/accounts/${wallet.address}/recover-info?chainId=${PRODUCT_CHAIN_ID}`
        );
        expect(recover.status).to.equal(200);
      }
    } finally {
      await app.close().catch(() => undefined);
      await rmWorkDir(work.dir);
    }
  }

  it("A: sweeper off, deployer off — unswept invoices recovered from persist-log", async function () {
    await runScenario.call(this, "A", 100, { sweeper: false, deployer: false });
  });

  it("B: sweeper on, deployer off — funds at undeployed wallet recovered", async function () {
    await runScenario.call(this, "B", 200, { sweeper: true, deployer: false });
  });

  it("C: sweeper off, deployer on — unswept invoices, deployer backoff", async function () {
    await runScenario.call(this, "C", 300, { sweeper: false, deployer: true });
  });

  it("D: fully settled — wipe/replay keeps balances and keys", async function () {
    await runScenario.call(this, "D", 400, { sweeper: true, deployer: true });
  });
});
