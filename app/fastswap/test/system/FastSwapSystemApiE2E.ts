import { expect } from "chai";
import { Contract, ethers as ethersLib } from "ethers";
import { network } from "hardhat";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FastSwapServer } from "../../server/server.js";
import type { FastSwapInvoice, FastSwapStatus } from "../../shared/types.js";
import { OnchainInvoiceSdk } from "../../../../src/sdk.js";

const NODE_KEY = "system-test-node";

/**
 * End-to-end exercise of the public HTTP API against a local Hardhat network:
 * quote → invoice → pay forwarder → sweep into receiver → relay with liquidity → recipient paid.
 * Invoice status is observed via GET (server uses on-chain `resolveInvoiceStatus`).
 */
describe("FastSwap system API (end-to-end)", function () {
  this.timeout(120_000);

  it("creates invoice via API, pays, sweeps, relays, and GET invoice shows completion", async function () {
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

    const directory = await mkdtemp(join(tmpdir(), "fastswap-system-api-"));
    const invoiceSdk = new OnchainInvoiceSdk({
      provider: ethers.provider,
      sweeperAddress: await sweeper.getAddress(),
    });

    const server = new FastSwapServer({
      sqlitePath: join(directory, "fastswap.sqlite"),
      nodeApiKey: NODE_KEY,
      invoiceSdk,
      invoiceSdksByChainId: {
        "1": invoiceSdk,
        "2": invoiceSdk,
      },
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
      resolveInvoiceStatus: async (inv: FastSwapInvoice): Promise<FastSwapStatus> => {
        const payment = await fastSwap.invoicePayment(inv.invoiceId);
        const amount = payment.amount as bigint;
        if (amount === 0n) return "waiting_payment";
        const st = await fastSwap.swapState(inv.invoiceId);
        if (st.processed) return "complete";
        if (st.queued) return "queued";
        if (st.relayed) return "relaying";
        return "paid";
      },
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
      expect(quote.quoteId).to.be.a("string");

      const invoice = (await postJson(`${baseUrl}/invoices`, { quoteId: quote.quoteId })) as {
        invoiceId: string;
        invoiceAddress: string;
        data: string;
        amount: string;
        targetAmount: string;
      };
      expect(invoice.invoiceId).to.match(/^0x[0-9a-f]{64}$/i);

      let fetched = await getInvoice(baseUrl, invoice.invoiceId);
      expect(fetched.status).to.equal("waiting_payment");

      await (await payer.sendTransaction({ to: invoice.invoiceAddress, value: BigInt(invoice.amount) })).wait();
      fetched = await getInvoice(baseUrl, invoice.invoiceId);
      expect(fetched.status).to.equal("waiting_payment");

      await (await sweeper.sweepEth(invoice.invoiceId, invoice.data)).wait();
      fetched = await getInvoice(baseUrl, invoice.invoiceId);
      expect(fetched.status).to.equal("paid");

      const sourceState = await fastSwap.swapState(invoice.invoiceId);
      expect(sourceState.requested).to.equal(true);
      const intentOnChain = sourceState.intent;
      const targetAmount = intentOnChain.targetAmount as bigint;

      const expectedBeforeRelay = await getInvoice(baseUrl, invoice.invoiceId);
      expect(addrEq(expectedBeforeRelay.targetToken, ethersLib.ZeroAddress)).to.equal(true);
      expect(BigInt(expectedBeforeRelay.targetAmount)).to.equal(targetAmount);
      expect(addrEq(intentOnChain.targetToken, expectedBeforeRelay.targetToken)).to.equal(true);
      expect(intentOnChain.targetAmount).to.equal(BigInt(expectedBeforeRelay.targetAmount));

      await (await fastSwap.addLiquidity(ethersLib.ZeroAddress, targetAmount, { value: targetAmount })).wait();
      const beforeBal = await tokenBalance(ethers.provider, recipient.address, expectedBeforeRelay.targetToken);
      await (await fastSwap.relaySwap(invoice.data)).wait();
      const afterBal = await tokenBalance(ethers.provider, recipient.address, expectedBeforeRelay.targetToken);
      expect(afterBal - beforeBal).to.equal(targetAmount);

      fetched = await getInvoice(baseUrl, invoice.invoiceId);
      expect(fetched.status).to.equal("complete");

      const list = await getJson(`${baseUrl}/invoices?limit=20`, {
        "x-api-key": NODE_KEY,
      });
      const row = list.invoices?.find((r: { invoice?: { invoiceId?: string } }) => r.invoice?.invoiceId === invoice.invoiceId);
      expect(row, "invoice in node list").to.exist;
      expect(row.invoice.status).to.equal("complete");

      const finalState = await fastSwap.swapState(invoice.invoiceId);
      expect(finalState.processed).to.equal(true);
      expect(addrEq(finalState.intent.targetToken, fetched.targetToken)).to.equal(true);
      expect(finalState.intent.targetAmount).to.equal(BigInt(fetched.targetAmount));
    } finally {
      await server.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("pays out the quoted ERC20 target token to the recipient", async function () {
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

    const Token = await ethers.getContractFactory("MockERC20");
    const targetErc20 = await Token.deploy("Target Coin", "TGT", 18);
    const targetTokenAddr = await targetErc20.getAddress();

    const directory = await mkdtemp(join(tmpdir(), "fastswap-system-api-erc20-"));
    const invoiceSdk = new OnchainInvoiceSdk({
      provider: ethers.provider,
      sweeperAddress: await sweeper.getAddress(),
    });

    const server = new FastSwapServer({
      sqlitePath: join(directory, "fastswap.sqlite"),
      nodeApiKey: NODE_KEY,
      invoiceSdk,
      invoiceSdksByChainId: { "1": invoiceSdk, "2": invoiceSdk },
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
          tokens: [
            { symbol: "ETH", chainId: "2", decimals: 18, isNative: true },
            { symbol: "TGT", chainId: "2", decimals: 18, address: targetTokenAddr },
          ],
        },
      ],
      resolveInvoiceStatus: async (inv: FastSwapInvoice): Promise<FastSwapStatus> => {
        const payment = await fastSwap.invoicePayment(inv.invoiceId);
        if ((payment.amount as bigint) === 0n) return "waiting_payment";
        const st = await fastSwap.swapState(inv.invoiceId);
        if (st.processed) return "complete";
        if (st.queued) return "queued";
        if (st.relayed) return "relaying";
        return "paid";
      },
    });

    const address = await server.run("127.0.0.1", 0);
    const baseUrl = `http://127.0.0.1:${address.port}`;

    try {
      const minted = ethersLib.parseEther("1000");
      await (await targetErc20.mint(owner.address, minted)).wait();

      const quote = await postJson(`${baseUrl}/quotes`, {
        sourceChainId: "1",
        sourceToken: ethersLib.ZeroAddress,
        targetChainId: "2",
        targetToken: targetTokenAddr,
        recipient: recipient.address,
        usdPack: 10,
      });

      const invoice = (await postJson(`${baseUrl}/invoices`, { quoteId: quote.quoteId })) as {
        invoiceId: string;
        invoiceAddress: string;
        data: string;
        amount: string;
        targetToken: string;
        targetAmount: string;
      };

      await (await payer.sendTransaction({ to: invoice.invoiceAddress, value: BigInt(invoice.amount) })).wait();
      await (await sweeper.sweepEth(invoice.invoiceId, invoice.data)).wait();

      const st = await fastSwap.swapState(invoice.invoiceId);
      const payAmount = st.intent.targetAmount as bigint;
      expect(addrEq(st.intent.targetToken, targetTokenAddr)).to.equal(true);

      await (await targetErc20.connect(owner).approve(await fastSwap.getAddress(), payAmount)).wait();
      await (await fastSwap.addLiquidity(targetTokenAddr, payAmount)).wait();

      const beforeTok = await tokenBalance(ethers.provider, recipient.address, invoice.targetToken);
      await (await fastSwap.relaySwap(invoice.data)).wait();
      const afterTok = await tokenBalance(ethers.provider, recipient.address, invoice.targetToken);

      expect(afterTok - beforeTok).to.equal(payAmount);

      const fetched = await getInvoice(baseUrl, invoice.invoiceId);
      expect(fetched.status).to.equal("complete");
      expect(addrEq(fetched.targetToken, targetTokenAddr)).to.equal(true);
      expect(BigInt(fetched.targetAmount)).to.equal(payAmount);
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
  if (!response.ok) throw new Error(`${response.status} ${await response.text()}`);
  return response.json();
}

async function getJson(url: string, headers: Record<string, string> = {}): Promise<any> {
  const response = await fetch(url, { headers });
  if (!response.ok) throw new Error(`${response.status} ${await response.text()}`);
  return response.json();
}

async function getInvoice(baseUrl: string, invoiceId: string): Promise<FastSwapInvoice> {
  return getJson(`${baseUrl}/invoices/${encodeURIComponent(invoiceId)}`) as Promise<FastSwapInvoice>;
}

function addrEq(a: string, b: string) {
  return ethersLib.getAddress(a) === ethersLib.getAddress(b);
}

async function tokenBalance(provider: ethersLib.Provider, holder: string, token: string): Promise<bigint> {
  if (addrEq(token, ethersLib.ZeroAddress)) return provider.getBalance(holder);
  const erc20 = new Contract(token, ["function balanceOf(address) view returns (uint256)"], provider);
  return erc20.balanceOf(holder) as Promise<bigint>;
}
