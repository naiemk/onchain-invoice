import { expect } from "chai";
import { id as keccakId, Wallet } from "ethers";
import { Keypair } from "@solana/web3.js";
import {
  chainKind,
  looksLikeSolanaAddress,
  normalizeMerchantAddress,
  predictCommerceSolanaInvoiceAta,
  tokenAllowedOnChain,
} from "../src/index.js";

describe("Solana commerce addresses (offline)", function () {
  const programId = "DTpy1o32ap655U2FPUX4ZgLAwDtxrLLu4d8TGhzap3FF";
  const mint = Keypair.generate().publicKey.toBase58();
  const merchant = Keypair.generate().publicKey.toBase58();

  it("classifies devnet as solana and allows USDC", function () {
    expect(chainKind("devnet")).to.equal("solana");
    expect(tokenAllowedOnChain("devnet", "USDC")).to.equal(true);
    expect(tokenAllowedOnChain("devnet", "USDT")).to.equal(false);
  });

  it("normalizes Solana merchant addresses", function () {
    expect(looksLikeSolanaAddress(merchant)).to.equal(true);
    expect(normalizeMerchantAddress(merchant)).to.equal(merchant);
    expect(() => normalizeMerchantAddress(Wallet.createRandom().address)).to.not.throw();
  });

  it("predicts distinct ATAs per merchant (anti-redirect bind)", function () {
    const invoiceId = keccakId("offline-1");
    const a = predictCommerceSolanaInvoiceAta(programId, merchant, invoiceId, mint);
    const b = predictCommerceSolanaInvoiceAta(programId, merchant, invoiceId, mint);
    expect(a).to.equal(b);
    const other = predictCommerceSolanaInvoiceAta(programId, Keypair.generate().publicKey, invoiceId, mint);
    expect(other).to.not.equal(a);
  });
});
