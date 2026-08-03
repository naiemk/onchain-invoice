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
  const usdc = Keypair.generate().publicKey.toBase58();
  const usdt = Keypair.generate().publicKey.toBase58();
  const merchant = Keypair.generate().publicKey.toBase58();

  it("classifies solana chain ids and allows USDC + USDT", function () {
    expect(chainKind("devnet")).to.equal("solana");
    expect(chainKind("mainnet-beta")).to.equal("solana");
    expect(tokenAllowedOnChain("devnet", "USDC")).to.equal(true);
    expect(tokenAllowedOnChain("devnet", "USDT")).to.equal(true);
    expect(tokenAllowedOnChain("mainnet-beta", "USDT")).to.equal(true);
  });

  it("normalizes Solana merchant addresses", function () {
    expect(looksLikeSolanaAddress(merchant)).to.equal(true);
    expect(normalizeMerchantAddress(merchant)).to.equal(merchant);
    expect(() => normalizeMerchantAddress(Wallet.createRandom().address)).to.not.throw();
  });

  it("predicts distinct ATAs per merchant and per mint", function () {
    const invoiceId = keccakId("offline-1");
    const a = predictCommerceSolanaInvoiceAta(programId, merchant, invoiceId, usdc);
    const b = predictCommerceSolanaInvoiceAta(programId, merchant, invoiceId, usdc);
    expect(a).to.equal(b);
    const otherMerchant = predictCommerceSolanaInvoiceAta(
      programId,
      Keypair.generate().publicKey,
      invoiceId,
      usdc
    );
    expect(otherMerchant).to.not.equal(a);
    const otherMint = predictCommerceSolanaInvoiceAta(programId, merchant, invoiceId, usdt);
    expect(otherMint).to.not.equal(a);
  });
});
