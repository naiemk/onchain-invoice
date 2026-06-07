import { expect } from "chai";
import { AbiCoder } from "ethers";
import { encodeFastSwapIntent, getFastSwapInvoiceId, quoteToIntent } from "../shared/encoding.js";
import {
  evmHexToTronBase58,
  isTronBase58Address,
  tronAddressToEvmHex,
} from "../shared/tron-address.js";
import type { FastSwapChainConfig, FastSwapQuote } from "../shared/types.js";

const TRON_USDT = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";
const TRON_RECIPIENT = "TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE";
const EVM_TOKEN = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
const EVM_RECIPIENT = "0x52908400098527886E0F7030069857D2E4169EE7";

const chains: FastSwapChainConfig[] = [
  {
    id: "11155111",
    type: "evm",
    name: "Sepolia",
    nativeSymbol: "ETH",
    sweeperAddress: EVM_TOKEN,
    fastSwapAddress: EVM_TOKEN,
    explorerUrl: "",
    tokens: [],
  },
  {
    id: "3448148188",
    type: "tron",
    name: "TRON Nile",
    nativeSymbol: "TRX",
    sweeperAddress: TRON_USDT,
    fastSwapAddress: TRON_USDT,
    explorerUrl: "",
    tokens: [],
  },
];

const INTENT_TUPLE = [
  "tuple(uint8 version,bytes32 quoteId,uint256 sourceChainId,address sourceToken,uint256 sourceAmount,uint256 targetChainId,address targetToken,uint256 targetAmount,address recipient,uint64 expiresAt,address refundAddress)",
];

describe("TRON address helpers", function () {
  it("detects base58 TRON addresses", function () {
    expect(isTronBase58Address(TRON_USDT)).to.equal(true);
    expect(isTronBase58Address(EVM_TOKEN)).to.equal(false);
    expect(isTronBase58Address("native")).to.equal(false);
  });

  it("round-trips base58 <-> 20-byte hex body", function () {
    const hex = tronAddressToEvmHex(TRON_USDT);
    expect(hex).to.match(/^0x[0-9a-fA-F]{40}$/);
    expect(evmHexToTronBase58(hex)).to.equal(TRON_USDT);
  });
});

describe("FastSwap intent encoding (chain-type aware)", function () {
  it("encodes TRON address slots as their 20-byte hex body", function () {
    const quote = baseQuote({
      sourceChainId: "3448148188",
      sourceToken: TRON_USDT,
      targetChainId: "11155111",
      targetToken: EVM_TOKEN,
      recipient: EVM_RECIPIENT,
    });
    const intent = quoteToIntent(quote, chains);
    expect(intent.sourceToken).to.equal(tronAddressToEvmHex(TRON_USDT));
    expect(intent.targetToken.toLowerCase()).to.equal(EVM_TOKEN.toLowerCase());

    const data = encodeFastSwapIntent(intent);
    const [decoded] = AbiCoder.defaultAbiCoder().decode(INTENT_TUPLE, data);
    expect(decoded.sourceToken).to.equal(tronAddressToEvmHex(TRON_USDT));
    // invoiceId must be a stable keccak256 of the encoded data.
    expect(getFastSwapInvoiceId(data)).to.match(/^0x[0-9a-fA-F]{64}$/);
  });

  it("encodes a TRON target recipient back to the same base58 address", function () {
    const quote = baseQuote({
      sourceChainId: "11155111",
      sourceToken: "native",
      targetChainId: "3448148188",
      targetToken: TRON_USDT,
      recipient: TRON_RECIPIENT,
    });
    const intent = quoteToIntent(quote, chains);
    expect(evmHexToTronBase58(intent.recipient)).to.equal(TRON_RECIPIENT);
    expect(evmHexToTronBase58(intent.targetToken)).to.equal(TRON_USDT);
  });

  it("maps native tokens to the zero address on both chains", function () {
    const quote = baseQuote({
      sourceChainId: "11155111",
      sourceToken: "native",
      targetChainId: "3448148188",
      targetToken: "native",
      recipient: TRON_RECIPIENT,
    });
    const intent = quoteToIntent(quote, chains);
    expect(intent.sourceToken).to.equal("0x0000000000000000000000000000000000000000");
    expect(intent.targetToken).to.equal("0x0000000000000000000000000000000000000000");
  });
});

function baseQuote(overrides: Partial<FastSwapQuote>): FastSwapQuote {
  return {
    quoteId: "0x" + "11".repeat(32),
    expiresAt: Date.now() + 60_000,
    sourceChainId: "11155111",
    sourceToken: "native",
    sourceAmount: "1000000",
    targetChainId: "3448148188",
    targetToken: "native",
    targetAmount: "950000",
    recipient: TRON_RECIPIENT,
    feeAmount: "0",
    rate: "1",
    sources: [],
    ...overrides,
  };
}
