import { expect } from "chai";
import { EVM_LEGACY_CHAIN_ID, loadConfig, resolveEvmChain } from "../commerce/server/config.js";

describe("commerce server EVM multi-chain config", function () {
  it("synthesizes Sepolia from legacy flat env", function () {
    const config = loadConfig({
      SWEEPER_ADDRESS: "0x5bcbEF31E3DcE37235CF8B2900ca7a1439e46cB9",
      FORWARDER_IMPLEMENTATION: "0x0bA4bb324eB41d9c0f1c4Ac7a3876dEfcc4d72b9",
      EVM_RPC_URL: "https://sepolia.example",
    } as NodeJS.ProcessEnv);
    expect(config.evmChains[EVM_LEGACY_CHAIN_ID]?.sweeperAddress).to.equal(
      "0x5bcbEF31E3DcE37235CF8B2900ca7a1439e46cB9"
    );
    expect(config.sweeperAddress).to.equal("0x5bcbEF31E3DcE37235CF8B2900ca7a1439e46cB9");
    expect(resolveEvmChain(config.evmChains, "11155111")?.rpcUrl).to.equal("https://sepolia.example");
    expect(resolveEvmChain(config.evmChains, "8453")).to.equal(undefined);
  });

  it("applies per-chainId EVM_* env overrides", function () {
    const config = loadConfig({
      EVM_8453_RPC_URL: "https://mainnet.base.org",
      EVM_8453_SWEEPER_ADDRESS: "0x1111111111111111111111111111111111111111",
      EVM_8453_FORWARDER_IMPLEMENTATION: "0x2222222222222222222222222222222222222222",
      EVM_56_SWEEPER_ADDRESS: "0x3333333333333333333333333333333333333333",
      EVM_56_FORWARDER_IMPLEMENTATION: "0x4444444444444444444444444444444444444444",
    } as NodeJS.ProcessEnv);
    const base = resolveEvmChain(config.evmChains, "8453");
    expect(base?.rpcUrl).to.equal("https://mainnet.base.org");
    expect(base?.sweeperAddress).to.equal("0x1111111111111111111111111111111111111111");
    expect(base?.forwarderImplementation).to.equal("0x2222222222222222222222222222222222222222");
    expect(resolveEvmChain(config.evmChains, "56")?.sweeperAddress).to.equal(
      "0x3333333333333333333333333333333333333333"
    );
  });

  it("treats empty / zero sweeper as unresolved (503 path)", function () {
    const config = loadConfig({
      EVM_8453_RPC_URL: "https://mainnet.base.org",
      EVM_8453_SWEEPER_ADDRESS: "",
    } as NodeJS.ProcessEnv);
    expect(resolveEvmChain(config.evmChains, "8453")).to.equal(undefined);
  });
});
