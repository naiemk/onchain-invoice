import { Buffer } from "node:buffer";
import {
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  type Connection,
  type Keypair,
  type Signer,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  createMintToInstruction,
  getAccount,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { BorshInstructionCoder } from "./solana-coder.js";

export const SOLANA_CONFIG_SEED = Buffer.from("config");
export const SOLANA_INVOICE_SEED = Buffer.from("invoice");

export function solanaConfigPda(programId: PublicKey | string): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([SOLANA_CONFIG_SEED], toPubkey(programId));
}

export function solanaInvoicePda(
  programId: PublicKey | string,
  invoiceId: Uint8Array | string,
  merchant: PublicKey | string,
  mint: PublicKey | string
): [PublicKey, number] {
  const id = normalizeInvoiceId32(invoiceId);
  return PublicKey.findProgramAddressSync(
    [SOLANA_INVOICE_SEED, id, toPubkey(merchant).toBuffer(), toPubkey(mint).toBuffer()],
    toPubkey(programId)
  );
}

/** Deterministic token ATA for an invoice (payment destination shown to payers). */
export function predictCommerceSolanaInvoiceAta(
  programId: PublicKey | string,
  merchant: PublicKey | string,
  invoiceId: Uint8Array | string,
  mint: PublicKey | string
): string {
  const [invoice] = solanaInvoicePda(programId, invoiceId, merchant, mint);
  return getAssociatedTokenAddressSync(toPubkey(mint), invoice, true).toBase58();
}

export function predictCommerceSolanaInvoicePda(
  programId: PublicKey | string,
  merchant: PublicKey | string,
  invoiceId: Uint8Array | string,
  mint: PublicKey | string
): string {
  return solanaInvoicePda(programId, invoiceId, merchant, mint)[0].toBase58();
}

export type CommerceSolanaSdkConfig = {
  connection: Connection;
  programId: PublicKey | string;
  /** Settle authority (sweeper). */
  authority: Signer;
  feeRecipient: PublicKey | string;
  feeBps?: number;
};

export class CommerceSolanaSdk {
  readonly connection: Connection;
  readonly programId: PublicKey;
  readonly authority: Signer;
  readonly feeRecipient: PublicKey;
  readonly feeBps: number;

  constructor(config: CommerceSolanaSdkConfig) {
    this.connection = config.connection;
    this.programId = toPubkey(config.programId);
    this.authority = config.authority;
    this.feeRecipient = toPubkey(config.feeRecipient);
    this.feeBps = config.feeBps ?? 50;
  }

  invoiceAta(
    merchant: PublicKey | string,
    invoiceId: Uint8Array | string,
    mint: PublicKey | string
  ): PublicKey {
    return new PublicKey(predictCommerceSolanaInvoiceAta(this.programId, merchant, invoiceId, mint));
  }

  async initialize(payer: Signer = this.authority): Promise<string> {
    const [configPda] = solanaConfigPda(this.programId);
    const data = BorshInstructionCoder.encodeInitialize({
      feeBps: this.feeBps,
      authority: this.authority.publicKey,
      feeRecipient: this.feeRecipient,
    });
    const ix = new TransactionInstruction({
      programId: this.programId,
      keys: [
        { pubkey: payer.publicKey, isSigner: true, isWritable: true },
        { pubkey: configPda, isSigner: false, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data,
    });
    return sendTx(this.connection, [payer], [ix]);
  }

  async readInvoiceBalance(
    merchant: PublicKey | string,
    invoiceId: Uint8Array | string,
    mint: PublicKey | string
  ): Promise<bigint> {
    const ata = this.invoiceAta(merchant, invoiceId, mint);
    try {
      const account = await getAccount(this.connection, ata, undefined, TOKEN_PROGRAM_ID);
      return account.amount;
    } catch {
      return 0n;
    }
  }

  /**
   * Settle invoice ATA to bound merchant (+ fee), then close ATA.
   * Destination and mint are enforced on-chain via PDA seeds — sweeper cannot redirect.
   */
  async settle(params: {
    merchant: PublicKey | string;
    invoiceId: Uint8Array | string;
    mint: PublicKey | string;
    rentDestination?: PublicKey | string;
  }): Promise<string> {
    const merchant = toPubkey(params.merchant);
    const mint = toPubkey(params.mint);
    const invoiceId = normalizeInvoiceId32(params.invoiceId);
    const [invoicePda] = solanaInvoicePda(this.programId, invoiceId, merchant, mint);
    const [configPda] = solanaConfigPda(this.programId);
    const invoiceAta = getAssociatedTokenAddressSync(mint, invoicePda, true);
    const merchantAta = getAssociatedTokenAddressSync(mint, merchant, false);
    const feeAta = getAssociatedTokenAddressSync(mint, this.feeRecipient, false);
    const rentDestination = toPubkey(params.rentDestination ?? this.authority.publicKey);

    const ensureMerchant = createAssociatedTokenAccountIdempotentInstruction(
      this.authority.publicKey,
      merchantAta,
      merchant,
      mint
    );
    const ensureFee = createAssociatedTokenAccountIdempotentInstruction(
      this.authority.publicKey,
      feeAta,
      this.feeRecipient,
      mint
    );

    const data = BorshInstructionCoder.encodeSettle({ invoiceId });
    const settleIx = new TransactionInstruction({
      programId: this.programId,
      keys: [
        { pubkey: this.authority.publicKey, isSigner: true, isWritable: false },
        { pubkey: configPda, isSigner: false, isWritable: false },
        { pubkey: merchant, isSigner: false, isWritable: false },
        { pubkey: invoicePda, isSigner: false, isWritable: false },
        { pubkey: invoiceAta, isSigner: false, isWritable: true },
        { pubkey: merchantAta, isSigner: false, isWritable: true },
        { pubkey: feeAta, isSigner: false, isWritable: true },
        { pubkey: mint, isSigner: false, isWritable: false },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: rentDestination, isSigner: false, isWritable: true },
      ],
      data,
    });

    return sendTx(this.connection, [this.authority], [ensureMerchant, ensureFee, settleIx]);
  }
}

/** Fund invoice ATA (test / payer helper). Creates ATA if needed. */
export async function fundSolanaInvoiceAta(params: {
  connection: Connection;
  payer: Signer;
  programId: PublicKey | string;
  mint: PublicKey | string;
  mintAuthority: Signer;
  merchant: PublicKey | string;
  invoiceId: Uint8Array | string;
  amount: bigint;
}): Promise<string> {
  const mint = toPubkey(params.mint);
  const invoiceAta = new PublicKey(
    predictCommerceSolanaInvoiceAta(params.programId, params.merchant, params.invoiceId, mint)
  );
  const [invoicePda] = solanaInvoicePda(params.programId, params.invoiceId, params.merchant, mint);
  const createIx = createAssociatedTokenAccountIdempotentInstruction(
    params.payer.publicKey,
    invoiceAta,
    invoicePda,
    mint
  );
  const mintIx = createMintToInstruction(mint, invoiceAta, params.mintAuthority.publicKey, params.amount);
  return sendTx(params.connection, [params.payer, params.mintAuthority], [createIx, mintIx]);
}

export function normalizeInvoiceId32(invoiceId: Uint8Array | string): Buffer {
  if (typeof invoiceId === "string") {
    const hex = invoiceId.startsWith("0x") ? invoiceId.slice(2) : invoiceId;
    if (hex.length === 64 && /^[0-9a-fA-F]+$/.test(hex)) {
      return Buffer.from(hex, "hex");
    }
    throw new Error(`invoiceId must be 32-byte hex, got: ${invoiceId}`);
  }
  if (invoiceId.length !== 32) throw new Error("invoiceId must be 32 bytes");
  return Buffer.from(invoiceId);
}

function toPubkey(value: PublicKey | string): PublicKey {
  return typeof value === "string" ? new PublicKey(value) : value;
}

async function sendTx(
  connection: Connection,
  signers: Signer[],
  ixs: TransactionInstruction[]
): Promise<string> {
  const tx = new Transaction().add(...ixs);
  tx.feePayer = signers[0]!.publicKey;
  tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
  tx.sign(...(signers as Keypair[]));
  const sig = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: false });
  await connection.confirmTransaction(sig, "confirmed");
  return sig;
}
