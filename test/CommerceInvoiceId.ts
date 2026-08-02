import { expect } from "chai";
import { getAddress, Wallet } from "ethers";
import {
  getCommerceInvoiceId,
  looksLikeTronAddress,
  normalizeMerchantAddress,
  tokenAllowedOnChain,
  tronNumericChainId,
} from "../src/index.js";

describe("Commerce invoice id (string[] merchants)", function () {
  it("encodes EVM + Tron merchant addresses as string[]", function () {
    const evm = getAddress(Wallet.createRandom().address);
    const tron = "TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf";
    expect(looksLikeTronAddress(tron)).to.equal(true);

    const id = getCommerceInvoiceId({
      priceUsd: "10.00",
      toAddresses: [evm, tron],
      clientInvoiceId: "order-tron-1",
    });
    expect(id).to.match(/^0x[0-9a-f]{64}$/);

    const again = getCommerceInvoiceId({
      priceUsd: "10.00",
      toAddresses: [evm, tron],
      clientInvoiceId: "order-tron-1",
    });
    expect(again).to.equal(id);
  });

  it("normalizes merchant addresses by kind", function () {
    const evm = Wallet.createRandom().address.toLowerCase();
    expect(normalizeMerchantAddress(evm)).to.equal(getAddress(evm));
    expect(normalizeMerchantAddress("TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf")).to.equal(
      "TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf"
    );
  });

  it("maps nile product id to numeric derivation id", function () {
    expect(String(tronNumericChainId("nile"))).to.equal("3448148188");
  });

  it("enforces token–chain pairs", function () {
    expect(tokenAllowedOnChain("11155111", "USDC")).to.equal(true);
    expect(tokenAllowedOnChain("11155111", "USDT")).to.equal(false);
    expect(tokenAllowedOnChain("nile", "USDT")).to.equal(true);
    expect(tokenAllowedOnChain("nile", "USDC")).to.equal(false);
  });
});
