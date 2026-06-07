import { Contract, JsonRpcProvider, Wallet, ZeroAddress } from "ethers";
import { readFile } from "node:fs/promises";
import { ERC20_ABI } from "../src/abis.js";
import { API_PORT, DEMO_HOST, DEMO_PRIVATE_KEY, deploymentChains, type DemoChainDeployment, type DemoDeployment } from "./config.js";
import { DEMO_DEPLOYMENT_PATH } from "./deploy.js";

const ERC20_TRANSFER_ABI = [...ERC20_ABI, "function transfer(address to,uint256 amount) returns (bool)"] as const;

export async function payInvoice(invoiceId: string) {
  const deployment = JSON.parse(await readFile(DEMO_DEPLOYMENT_PATH, "utf8")) as DemoDeployment;
  const invoice = await fetch(`http://${DEMO_HOST}:${API_PORT}/invoices/${encodeURIComponent(invoiceId)}`).then((r) => r.json());
  const chain = deploymentChains(deployment).find((candidate) => candidate.id === invoice.sourceChainId);
  if (!chain) throw new Error(`Unknown source chain ${invoice.sourceChainId}`);

  const provider = new JsonRpcProvider(chain.rpcUrl);
  const wallet = new Wallet(DEMO_PRIVATE_KEY, provider);
  if (invoice.token === ZeroAddress) {
    await (await wallet.sendTransaction({ to: invoice.invoiceAddress, value: BigInt(invoice.amount) })).wait();
  } else {
    await (await new Contract(invoice.token, ERC20_TRANSFER_ABI, wallet).transfer(invoice.invoiceAddress, invoice.amount)).wait();
  }
  console.log(`[fastswap-demo] paid ${invoice.invoiceId} on ${chain.name}`);
}

if (process.argv[1]?.endsWith("pay-invoice.js")) {
  const invoiceId = process.argv[2];
  if (!invoiceId) throw new Error("Usage: npm run fastswap:demo:pay -- <invoiceId>");
  await payInvoice(invoiceId);
}
