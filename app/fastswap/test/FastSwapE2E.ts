import { expect } from "chai";
import { network } from "hardhat";
import { ethers as ethersLib } from "ethers";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { FastSwapServer } from "../server/server.js";
import { OnchainInvoiceSdk } from "../../../src/sdk.js";

describe("FastSwap end-to-end", function () {
  it("creates a quote, creates an invoice, sweeps payment, relays, and pays recipient", async function () {
    const { ethers } = (await network.create()) as Awaited<ReturnType<typeof network.create>> & {
      ethers: any;
    };
    const [owner, payer, recipient] = await ethers.getSigners();

    const FastSwap = await ethers.getContractFactory("FastSwapReceiver");
    const implementation = await FastSwap.deploy();
    const Proxy = await ethers.getContractFactory("ReceiverProxy");
    const proxy = await Proxy.deploy(
      await implementation.getAddress(),
      FastSwap.interface.encodeFunctionData("initialize", [owner.address])
    );
    const fastSwap = await ethers.getContractAt("FastSwapReceiver", await proxy.getAddress());

    const Sweeper = await ethers.getContractFactory("InvoiceSweeper");
    const sweeper = await Sweeper.deploy(await fastSwap.getAddress());

    const directory = await mkdtemp(join(tmpdir(), "fastswap-e2e-"));
    const invoiceSdk = new OnchainInvoiceSdk({
      provider: ethers.provider,
      sweeperAddress: await sweeper.getAddress(),
    });

    const server = new FastSwapServer({
      sqlitePath: join(directory, "fastswap.sqlite"),
      invoiceSdk,
      chains: [
        {
          id: "1",
          type: "evm",
          name: "Source",
          nativeSymbol: "ETH",
          sweeperAddress: await sweeper.getAddress(),
          fastSwapAddress: await fastSwap.getAddress(),
          explorerUrl: "",
          tokens: [{ symbol: "ETH", chainId: "1", decimals: 18, isNative: true }],
        },
        {
          id: "2",
          type: "evm",
          name: "Target",
          nativeSymbol: "ETH",
          sweeperAddress: await sweeper.getAddress(),
          fastSwapAddress: await fastSwap.getAddress(),
          explorerUrl: "",
          tokens: [{ symbol: "ETH", chainId: "2", decimals: 18, isNative: true }],
        },
      ],
    });
    const address = await server.run("127.0.0.1", 0);
    const baseUrl = `http://127.0.0.1:${address.port}`;

    try {
      const quote = await postJson(`${baseUrl}/quotes`, {
        sourceChainId: "1",
        sourceToken: ethersLib.ZeroAddress,
        targetChainId: "2",
        targetToken: ethersLib.ZeroAddress,
        recipient: recipient.address,
        usdPack: 10,
      });
      const invoice = await postJson(`${baseUrl}/invoices`, { quoteId: quote.quoteId });

      await payer.sendTransaction({ to: invoice.invoiceAddress, value: BigInt(invoice.amount) });
      await sweeper.sweepEth(invoice.invoiceId, invoice.data);

      const sourceState = await fastSwap.swapState(invoice.invoiceId);
      expect(sourceState.requested).to.equal(true);

      const targetAmount = sourceState.intent.targetAmount;
      await fastSwap.addLiquidity(ethersLib.ZeroAddress, targetAmount, { value: targetAmount });

      const before = await ethers.provider.getBalance(recipient.address);
      await fastSwap.relaySwap(invoice.data);
      const after = await ethers.provider.getBalance(recipient.address);

      expect(after - before).to.equal(targetAmount);
      const targetState = await fastSwap.swapState(invoice.invoiceId);
      expect(targetState.processed).to.equal(true);
    } finally {
      await server.close();
      await rm(directory, { recursive: true, force: true });
    }
  });
});

async function postJson(url: string, body: unknown): Promise<any> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(await response.text());
  return response.json();
}
