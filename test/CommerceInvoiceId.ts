import { expect } from "chai";
import { getAddress, Wallet } from "ethers";
import {
  defaultTronFullHost,
  getCommerceInvoiceId,
  looksLikeTronAddress,
  normalizeMerchantAddress,
  randomInvoiceSeed,
  tokenAllowedOnChain,
  tronNumericChainId,
} from "../src/index.js";

describe("Commerce invoice id (seed + toAddresses)", function () {
  it("hashes invoiceSeed + toAddresses[]", function () {
    const evm = getAddress(Wallet.createRandom().address);
    const tron = "TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf";
    expect(looksLikeTronAddress(tron)).to.equal(true);
    const seed = randomInvoiceSeed();

    const id = getCommerceInvoiceId({
      invoiceSeed: seed,
      toAddresses: [evm, tron],
    });
    expect(id).to.match(/^0x[0-9a-f]{64}$/);

    const again = getCommerceInvoiceId({
      invoiceSeed: seed,
      toAddresses: [evm, tron],
    });
    expect(again).to.equal(id);

    const otherSeed = getCommerceInvoiceId({
      invoiceSeed: randomInvoiceSeed(),
      toAddresses: [evm, tron],
    });
    expect(otherSeed).to.not.equal(id);
  });

  it("changes when merchant destinations change", function () {
    const seed = randomInvoiceSeed();
    const a = getAddress(Wallet.createRandom().address);
    const b = getAddress(Wallet.createRandom().address);
    const idA = getCommerceInvoiceId({ invoiceSeed: seed, toAddresses: [a] });
    const idB = getCommerceInvoiceId({ invoiceSeed: seed, toAddresses: [b] });
    expect(idA).to.not.equal(idB);
  });

  it("ignores clientInvoiceId / price for the invoice id", function () {
    const seed = randomInvoiceSeed();
    const to = [getAddress(Wallet.createRandom().address)];
    const base = getCommerceInvoiceId({ invoiceSeed: seed, toAddresses: to });
    const withMeta = getCommerceInvoiceId({
      invoiceSeed: seed,
      toAddresses: to,
      clientInvoiceId: "order-1",
      priceUsd: "999",
    });
    expect(withMeta).to.equal(base);
  });

  it("normalizes merchant addresses by kind", function () {
    const evm = Wallet.createRandom().address.toLowerCase();
    expect(normalizeMerchantAddress(evm)).to.equal(getAddress(evm));
    expect(normalizeMerchantAddress("TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf")).to.equal(
      "TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf"
    );
  });

  it("maps nile / tron product ids to numeric derivation ids", function () {
    expect(String(tronNumericChainId("nile"))).to.equal("3448148188");
    expect(String(tronNumericChainId("tron"))).to.equal("728126428");
  });

  it("defaults Tron fullHost by product chain id", function () {
    expect(defaultTronFullHost("nile")).to.equal("https://nile.trongrid.io");
    expect(defaultTronFullHost("tron")).to.equal("https://api.trongrid.io");
  });

  it("enforces token–chain pairs", function () {
    expect(tokenAllowedOnChain("11155111", "USDC")).to.equal(true);
    expect(tokenAllowedOnChain("11155111", "USDT")).to.equal(true);
    expect(tokenAllowedOnChain("8453", "USDC")).to.equal(true);
    expect(tokenAllowedOnChain("8453", "USDT")).to.equal(false);
    expect(tokenAllowedOnChain("56", "USDC")).to.equal(true);
    expect(tokenAllowedOnChain("56", "USDT")).to.equal(true);
    expect(tokenAllowedOnChain("nile", "USDT")).to.equal(true);
    expect(tokenAllowedOnChain("nile", "USDC")).to.equal(false);
    expect(tokenAllowedOnChain("tron", "USDT")).to.equal(true);
  });
});
