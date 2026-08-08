/**
 * Live Devnet smoke (not the local validator suite).
 * Requires SOLANA_PROGRAM_ID + funded authority (SOLANA_AUTHORITY_KEYPAIR or solana/data/devnet-authority.json).
 */
import { expect } from "chai";
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
  getMinimumBalanceForRentExemptMint,
  MINT_SIZE,
} from "@solana/spl-token";
import { id as keccakId } from "ethers";
import {
  CommerceSolanaSdk,
  fundSolanaInvoiceAta,
  predictCommerceSolanaInvoiceAta,
} from "../../src/solana-sdk.js";

const RPC = process.env.SOLANA_RPC_URL ?? "https://api.devnet.solana.com";
const FEE_BPS = 50;

function loadKeypair(path: string): Keypair {
  const raw = JSON.parse(readFileSync(path, "utf8")) as number[];
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

async function airdropUntil(connection: Connection, pubkey: PublicKey, minSol: number): Promise<void> {
  for (let i = 0; i < 8; i++) {
    const bal = await connection.getBalance(pubkey);
    if (bal >= minSol * LAMPORTS_PER_SOL) return;
    try {
      const sig = await connection.requestAirdrop(pubkey, 2 * LAMPORTS_PER_SOL);
      await connection.confirmTransaction(sig, "confirmed");
    } catch {
      await sleep(2000);
    }
  }
  const bal = await connection.getBalance(pubkey);
  if (bal < minSol * LAMPORTS_PER_SOL) {
    throw new Error(`Devnet faucet did not fund ${pubkey.toBase58()} (bal=${bal})`);
  }
}

async function createMint(connection: Connection, payer: Keypair): Promise<Keypair> {
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
  await sendAndConfirmTransaction(connection, tx, [payer, mint], { commitment: "confirmed" });
  return mint;
}

describe("Solana Devnet smoke", function () {
  this.timeout(300_000);

  it("pay → settle on Devnet with a throwaway mint", async function () {
    const programIdStr = process.env.SOLANA_PROGRAM_ID;
    if (!programIdStr) {
      throw new Error("SOLANA_PROGRAM_ID required (run npm run solana:deploy:devnet first)");
    }
    const authPath =
      process.env.SOLANA_AUTHORITY_KEYPAIR ?? resolve("solana/data/devnet-authority.json");
    if (!existsSync(authPath)) {
      throw new Error(`Missing authority keypair at ${authPath}`);
    }

    const connection = new Connection(RPC, "confirmed");
    const programId = new PublicKey(programIdStr);
    const authority = loadKeypair(authPath);
    const feeRecipient = authority;
    const merchant = Keypair.generate();

    const programInfo = await connection.getAccountInfo(programId);
    expect(programInfo, `program ${programIdStr} not on ${RPC}`).to.not.equal(null);

    await airdropUntil(connection, authority.publicKey, 1.5);

    const sdk = new CommerceSolanaSdk({
      connection,
      programId,
      authority,
      feeRecipient: feeRecipient.publicKey,
      feeBps: FEE_BPS,
    });

    const mint = await createMint(connection, authority);
    const invoiceId = keccakId("devnet-smoke-" + Date.now());
    const ata = predictCommerceSolanaInvoiceAta(programId, merchant.publicKey, invoiceId, mint.publicKey);
    const amount = 1_250_000n;

    await fundSolanaInvoiceAta({
      connection,
      payer: authority,
      mintAuthority: authority,
      mint: mint.publicKey,
      invoiceAta: new PublicKey(ata),
      amount,
    });

    const before = await getAccount(connection, new PublicKey(ata));
    expect(before.amount).to.equal(amount);

    const sig = await sdk.settle({
      merchant: merchant.publicKey,
      invoiceId,
      mint: mint.publicKey,
    });
    expect(sig).to.be.a("string").with.length.greaterThan(40);

    // ATA should be closed after settle (plain Chai — no chai-as-promised).
    let ataGone = false;
    try {
      await getAccount(connection, new PublicKey(ata));
    } catch {
      ataGone = true;
    }
    expect(ataGone).to.equal(true);
    console.log(
      JSON.stringify({
        network: "devnet",
        rpc: RPC,
        programId: programIdStr,
        settleTx: sig,
        invoiceAta: ata,
        amount: amount.toString(),
      })
    );
  });
});
