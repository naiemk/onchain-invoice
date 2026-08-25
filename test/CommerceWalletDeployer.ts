import { expect } from "chai";
import { WalletDeployerWorker, type WalletDeployerConfig } from "../commerce/wallet-deployer/worker.js";

const FACTORY = "0x2b245a20589c745B11F8a69C677F891e8175a550";
const TOKEN = "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238";
const DEPLOYER_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

describe("WalletDeployerWorker", function () {
  it("does not poll when no chains configured", async function () {
    const calls: string[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input: RequestInfo | URL) => {
      calls.push(String(input));
      return new Response(JSON.stringify({ accounts: [] }), { status: 200 });
    };

    const config: WalletDeployerConfig = {
      serverUrl: "http://127.0.0.1:1",
      sweeperApiKey: "test-key",
      chains: [],
    };
    const worker = new WalletDeployerWorker(config);
    await (worker as unknown as { tick: () => Promise<void> }).tick();
    expect(calls.length).to.equal(0);
    globalThis.fetch = originalFetch;
  });

  it("polls undeployed list when chains configured", async function () {
    let polled = false;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/wallet/deployer/accounts")) {
        polled = true;
        return new Response(JSON.stringify({ accounts: [] }), { status: 200 });
      }
      return new Response("{}", { status: 200 });
    };

    const config: WalletDeployerConfig = {
      serverUrl: "http://127.0.0.1:1",
      sweeperApiKey: "test-key",
      chains: [
        {
          chainId: "11155111",
          rpcUrl: "http://127.0.0.1:9",
          factoryAddress: FACTORY,
          privateKey: DEPLOYER_KEY,
          feeTokenAddress: TOKEN,
        },
      ],
    };
    const worker = new WalletDeployerWorker(config);
    await (worker as unknown as { tick: () => Promise<void> }).tick();
    expect(polled).to.equal(true);
    globalThis.fetch = originalFetch;
  });
});
