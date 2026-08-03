import { Buffer } from "node:buffer";
import type { PublicKey } from "@solana/web3.js";

/** Manual borsh encoder matching `CommerceInstruction` in the Rust program. */
export const BorshInstructionCoder = {
  encodeInitialize(params: {
    feeBps: number;
    authority: PublicKey;
    feeRecipient: PublicKey;
    usdcMint: PublicKey;
  }): Buffer {
    const buf = Buffer.alloc(1 + 2 + 32 + 32 + 32);
    let o = 0;
    buf.writeUInt8(0, o); // Initialize
    o += 1;
    buf.writeUInt16LE(params.feeBps, o);
    o += 2;
    params.authority.toBuffer().copy(buf, o);
    o += 32;
    params.feeRecipient.toBuffer().copy(buf, o);
    o += 32;
    params.usdcMint.toBuffer().copy(buf, o);
    return buf;
  },

  encodeSettle(params: { invoiceId: Buffer }): Buffer {
    if (params.invoiceId.length !== 32) throw new Error("invoiceId must be 32 bytes");
    const buf = Buffer.alloc(1 + 32);
    buf.writeUInt8(1, 0); // Settle
    params.invoiceId.copy(buf, 1);
    return buf;
  },
};
