import { expect } from "chai";
import {
  filterEvmObserveChains,
  filterEvmSweepChains,
  isUnsetSecret,
  type EvmChainConfig,
} from "../commerce/sweeper/worker.js";

describe("Commerce sweeper observe vs sweep chains", () => {
  const base: EvmChainConfig = {
    chainId: "8453",
    rpcUrl: "https://mainnet.base.org",
    sweeperAddress: "0x32D81953F60094A484eaFFB4583933b074921f4A",
    privateKey: "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
  };

  it("isUnsetSecret treats placeholders as unset", () => {
    expect(isUnsetSecret("")).to.equal(true);
    expect(isUnsetSecret("_PRIVATE_KEY_")).to.equal(true);
    expect(isUnsetSecret("change-me")).to.equal(true);
    expect(isUnsetSecret(base.privateKey)).to.equal(false);
  });

  it("observes chains with RPC even when private key is missing", () => {
    const rows: EvmChainConfig[] = [
      { ...base, chainId: "11155111", rpcUrl: "", privateKey: "_PRIVATE_KEY_" },
      { ...base, privateKey: "_PRIVATE_KEY_" },
      { ...base, chainId: "56", privateKey: base.privateKey },
    ];
    const observe = filterEvmObserveChains(rows);
    expect(observe.map((c) => String(c.chainId))).to.deep.equal(["8453", "56"]);

    const sweep = filterEvmSweepChains(observe);
    expect(sweep.map((c) => String(c.chainId))).to.deep.equal(["56"]);
  });

  it("does not sweep when sweeper address is empty", () => {
    const rows: EvmChainConfig[] = [{ ...base, sweeperAddress: "" }];
    expect(filterEvmObserveChains(rows)).to.have.length(1);
    expect(filterEvmSweepChains(rows)).to.have.length(0);
  });
});
