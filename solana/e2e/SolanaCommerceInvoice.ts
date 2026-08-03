import { expect } from "chai";
import { spawn, type ChildProcess } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  createInitializeMint2Instruction,
  getAccount,
  getAssociatedTokenAddressSync,
  getMinimumBalanceForRentExemptMint,
  MINT_SIZE,
} from "@solana/spl-token";
import { id as keccakId } from "ethers";
import {
  CommerceSolanaSdk,
  fundSolanaInvoiceAta,
  predictCommerceSolanaInvoiceAta,
  predictCommerceSolanaInvoicePda,
} from "../../src/solana-sdk.js";

const RPC = process.env.SOLANA_RPC_URL ?? "http://127.0.0.1:8899";
const PROGRAM_SO = resolve("solana/target/deploy/commerce_invoice.so");
const PROGRAM_KEYPAIR = resolve("solana/target/deploy/commerce_invoice-keypair.json");
const FEE_BPS = 50;

function loadKeypair(path: string): Keypair {
  const raw = JSON.parse(readFileSync(path, "utf8")) as number[];
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

async function waitForRpc(connection: Connection, timeoutMs = 60_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      await connection.getVersion();
      return;
    } catch {
      await sleep(400);
    }
  }
  throw new Error("solana-test-validator did not become ready");
}

async function airdrop(connection: Connection, pubkey: PublicKey, sol = 10): Promise<void> {
  const sig = await connection.requestAirdrop(pubkey, sol * LAMPORTS_PER_SOL);
  await connection.confirmTransaction(sig, "confirmed");
}

async function createUsdcMint(connection: Connection, payer: Keypair): Promise<Keypair> {
  const mint = Keypair.generate();
  const lamports = await getMinimumBalanceForRentExemptMint(connection);
  const tx = new Transaction().add(
    SystemProgram.createAccount({
      fromPubkey: payer.publicKey,
      newAccountPubkey: mint.publicKey,
      space: MINT_SIZE,
      lamports,
      programId: TOKEN_PROGRAM_ID,
    }),
    createInitializeMint2Instruction(mint.publicKey, 6, payer.publicKey, null)
  );
  await sendAndConfirmTransaction(connection, tx, [payer, mint]);
  return mint;
}

describe("Solana commerce invoice (success e2e)", function () {
  this.timeout(180_000);

  let validator: ChildProcess | null = null;
  let connection: Connection;
  let programId: PublicKey;
  let authority: Keypair;
  let feeRecipient: Keypair;
  let merchant: Keypair;
  let attacker: Keypair;
  let mint: Keypair;
  let sdk: CommerceSolanaSdk;
  let ownedValidator = false;

  before(async function () {
    if (!existsSync(PROGRAM_SO) || !existsSync(PROGRAM_KEYPAIR)) {
      throw new Error(`Build the program first: cd solana/programs/commerce-invoice && cargo-build-sbf`);
    }
    programId = loadKeypair(PROGRAM_KEYPAIR).publicKey;
    connection = new Connection(RPC, "confirmed");

    try {
      await connection.getVersion();
    } catch {
      ownedValidator = true;
      validator = spawn(
        "solana-test-validator",
        ["--bpf-program", programId.toBase58(), PROGRAM_SO, "--reset"],
        { stdio: "ignore", env: process.env }
      );
      await waitForRpc(connection);
    }

    // Ensure program is deployed when attaching to an existing validator
    const info = await connection.getAccountInfo(programId);
    if (!info) {
      if (!ownedValidator) {
        throw new Error(
          `Program ${programId.toBase58()} not deployed on ${RPC}. Restart validator with --bpf-program or leave RPC down so the suite starts one.`
        );
      }
    }

    authority = Keypair.generate();
    feeRecipient = Keypair.generate();
    merchant = Keypair.generate();
    attacker = Keypair.generate();
    await airdrop(connection, authority.publicKey, 20);
    await airdrop(connection, feeRecipient.publicKey, 2);
    await airdrop(connection, merchant.publicKey, 2);

    mint = await createUsdcMint(connection, authority);
    sdk = new CommerceSolanaSdk({
      connection,
      programId,
      usdcMint: mint.publicKey,
      authority,
      feeRecipient: feeRecipient.publicKey,
      feeBps: FEE_BPS,
    });
    await sdk.initialize(authority);
  });

  after(async function () {
    try {
      const ws = (connection as unknown as { _rpcWebSocket?: { close: () => void } })._rpcWebSocket;
      ws?.close();
    } catch {
      /* ignore */
    }
    if (validator && ownedValidator) {
      validator.kill("SIGKILL");
      validator = null;
    }
    // web3.js keeps the event loop alive via websocket reconnect; force clean exit for this suite.
    setTimeout(() => process.exit(0), 50);
  });

  it("predicts stable PDA and ATA from merchant + invoiceId", function () {
    const invoiceId = keccakId("sol-inv-1");
    const a = predictCommerceSolanaInvoiceAta(programId, merchant.publicKey, invoiceId, mint.publicKey);
    const b = predictCommerceSolanaInvoiceAta(programId, merchant.publicKey, invoiceId, mint.publicKey);
    expect(a).to.equal(b);
    const other = predictCommerceSolanaInvoiceAta(programId, attacker.publicKey, invoiceId, mint.publicKey);
    expect(other).to.not.equal(a);
    const pda = predictCommerceSolanaInvoicePda(programId, merchant.publicKey, invoiceId);
    expect(pda).to.match(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
  });

  it("pay → settle success: merchant gets amount minus fee, ATA closed", async function () {
    const invoiceId = keccakId("sol-pay-settle");
    const amount = 1_000_000n; // 1 USDC
    const fee = (amount * BigInt(FEE_BPS)) / 10_000n;

    await fundSolanaInvoiceAta({
      connection,
      payer: authority,
      programId,
      usdcMint: mint.publicKey,
      mintAuthority: authority,
      merchant: merchant.publicKey,
      invoiceId,
      amount,
    });

    expect(await sdk.readInvoiceBalance(merchant.publicKey, invoiceId)).to.equal(amount);

    const merchantAta = getAssociatedTokenAddressSync(mint.publicKey, merchant.publicKey);
    const feeAta = getAssociatedTokenAddressSync(mint.publicKey, feeRecipient.publicKey);

    const sig = await sdk.settle({ merchant: merchant.publicKey, invoiceId });
    expect(sig).to.be.a("string").with.length.greaterThan(40);

    const merchantBal = (await getAccount(connection, merchantAta)).amount;
    const feeBal = (await getAccount(connection, feeAta)).amount;
    expect(merchantBal).to.equal(amount - fee);
    expect(feeBal).to.equal(fee);
    expect(await sdk.readInvoiceBalance(merchant.publicKey, invoiceId)).to.equal(0n);

    const invoiceAta = new PublicKey(
      predictCommerceSolanaInvoiceAta(programId, merchant.publicKey, invoiceId, mint.publicKey)
    );
    const closed = await connection.getAccountInfo(invoiceAta);
    expect(closed).to.equal(null);
  });

  it("rejects redirect: wrong merchant cannot drain a funded invoice", async function () {
    const invoiceId = keccakId("sol-secure");
    const amount = 500_000n;
    await fundSolanaInvoiceAta({
      connection,
      payer: authority,
      programId,
      usdcMint: mint.publicKey,
      mintAuthority: authority,
      merchant: merchant.publicKey,
      invoiceId,
      amount,
    });

    let failed = false;
    try {
      await sdk.settle({ merchant: attacker.publicKey, invoiceId });
    } catch {
      failed = true;
    }
    expect(failed).to.equal(true);
    expect(await sdk.readInvoiceBalance(merchant.publicKey, invoiceId)).to.equal(amount);
  });

  it("rejects unauthorized sweeper", async function () {
    const invoiceId = keccakId("sol-auth");
    const amount = 100_000n;
    await fundSolanaInvoiceAta({
      connection,
      payer: authority,
      programId,
      usdcMint: mint.publicKey,
      mintAuthority: authority,
      merchant: merchant.publicKey,
      invoiceId,
      amount,
    });

    const rogue = Keypair.generate();
    await airdrop(connection, rogue.publicKey, 2);
    const rogueSdk = new CommerceSolanaSdk({
      connection,
      programId,
      usdcMint: mint.publicKey,
      authority: rogue,
      feeRecipient: feeRecipient.publicKey,
      feeBps: FEE_BPS,
    });

    let failed = false;
    try {
      await rogueSdk.settle({ merchant: merchant.publicKey, invoiceId });
    } catch {
      failed = true;
    }
    expect(failed).to.equal(true);
    expect(await sdk.readInvoiceBalance(merchant.publicKey, invoiceId)).to.equal(amount);
  });
});
