import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { extname, join } from "node:path";
import { Contract, JsonRpcProvider, Wallet } from "ethers";
import { TronWeb } from "tronweb";
import { FastSwapServer, type InvoiceAddressSdk } from "../app/fastswap/server/server.js";
import { collectLiquidity } from "../app/fastswap/nodes/liquidity-monitor/index.js";
import { OnchainInvoiceSdk } from "../src/sdk.js";
import { TronInvoiceSdk } from "../src/tron.js";
import { FASTSWAP_RECEIVER_ABI } from "../app/fastswap/shared/fastswap-abi.js";
import type { FastSwapInvoice, FastSwapStatus } from "../app/fastswap/shared/types.js";
import {
  ADMIN_PORT,
  API_PORT,
  DEMO_CAPTCHA_TOKEN,
  DEMO_HOST,
  DEMO_PRIVATE_KEY,
  DEMO_RUNTIME_CHAINS,
  FASTSWAP_DEMO_FEE_BPS,
  FASTSWAP_DEMO_MAX_DEVIATION_BPS,
  FASTSWAP_DEMO_PACKS,
  NODE_API_KEY,
  UI_PORT,
  deploymentChains,
  toFastSwapChains,
  type DemoDeployment,
} from "./config.js";
import { DEMO_DEPLOYMENT_PATH } from "./deploy.js";

export async function runDemoServers(deployment: DemoDeployment) {
  const deployedChains = deploymentChains(deployment);
  const configuredRuntimeChains = DEMO_RUNTIME_CHAINS.filter(
    (chain) => chain.demoDeploy === false && chain.rpcUrl && chain.sweeperAddress
  );
  const invoiceSdkInputs: Array<{
    id: string;
    type: "evm" | "tron";
    rpcUrl: string;
    fullHost?: string;
    feeLimit?: number;
    sweeperAddress: string;
  }> = [
    ...deployedChains.map((chain) => ({
      id: chain.id,
      type: "evm" as const,
      rpcUrl: chain.rpcUrl,
      sweeperAddress: chain.sweeper,
    })),
    ...configuredRuntimeChains.map((chain) => ({
      id: chain.id,
      type: chain.type ?? ("evm" as const),
      rpcUrl: chain.rpcUrl,
      fullHost: chain.fullHost ?? chain.rpcUrl,
      feeLimit: chain.feeLimit,
      sweeperAddress: chain.sweeperAddress!,
    })),
  ];
  const invoiceSdksByChainId: Record<string, InvoiceAddressSdk> = Object.fromEntries(
    invoiceSdkInputs.map((chain) => {
      if (chain.type === "tron") {
        const tronWeb = new TronWeb({ fullHost: chain.fullHost ?? chain.rpcUrl, privateKey: DEMO_PRIVATE_KEY.replace(/^0x/, "") });
        return [chain.id, new TronInvoiceSdk({ tronWeb, sweeperAddress: chain.sweeperAddress, feeLimit: chain.feeLimit })];
      }
      const provider = new JsonRpcProvider(chain.rpcUrl);
      const signer = new Wallet(DEMO_PRIVATE_KEY, provider);
      return [chain.id, new OnchainInvoiceSdk({ provider, signer, sweeperAddress: chain.sweeperAddress })];
    })
  );
  const defaultChain = deployedChains[0];
  if (!defaultChain) throw new Error("No deployed chains configured");

  const api = new FastSwapServer({
    sqlitePath: join(process.cwd(), "fastSwapDemo", "state", "fastswap.sqlite"),
    invoiceSdk: invoiceSdksByChainId[defaultChain.id],
    invoiceSdksByChainId,
    chains: toFastSwapChains(deployment),
    packs: FASTSWAP_DEMO_PACKS,
    nodeApiKey: NODE_API_KEY,
    requireCaptchaForQuotes: true,
    requireCaptchaForInvoices: true,
    verifyCaptcha: (token) => token === DEMO_CAPTCHA_TOKEN,
    resolveInvoiceStatus: createStatusResolver(deployment),
    resolveLiquidity: () => collectDemoLiquidity(deployment),
    feeBps: FASTSWAP_DEMO_FEE_BPS,
    maxDeviationBps: FASTSWAP_DEMO_MAX_DEVIATION_BPS,
  });
  await api.run(DEMO_HOST, API_PORT);

  const ui = createStaticServer(join(process.cwd(), "app", "fastswap", "ui"), `http://${DEMO_HOST}:${API_PORT}`);
  const admin = createStaticServer(join(process.cwd(), "fastSwapDemo", "admin"), `http://${DEMO_HOST}:${API_PORT}`);
  await Promise.all([
    listen(ui, UI_PORT),
    listen(admin, ADMIN_PORT),
  ]);

  console.log(`[fastswap-demo] API     http://${DEMO_HOST}:${API_PORT}`);
  console.log(`[fastswap-demo] UI      http://${DEMO_HOST}:${UI_PORT}`);
  console.log(`[fastswap-demo] Admin   http://${DEMO_HOST}:${ADMIN_PORT}`);
  return { api, ui, admin };
}

async function collectDemoLiquidity(deployment: DemoDeployment) {
  const chains = toFastSwapChains(deployment);
  const runtimeChains: Array<{ id: string; type: "evm" | "tron"; rpcUrl?: string; fullHost?: string; fastSwapAddress: string }> = [
    ...deploymentChains(deployment).map((chain) => ({
      id: chain.id,
      type: "evm" as const,
      rpcUrl: chain.rpcUrl,
      fastSwapAddress: chain.fastSwap,
    })),
    ...DEMO_RUNTIME_CHAINS.filter((chain) => chain.demoDeploy === false && chain.fastSwapAddress && (chain.rpcUrl || chain.fullHost)).map((chain) => ({
      id: chain.id,
      type: chain.type ?? ("evm" as const),
      rpcUrl: chain.rpcUrl,
      fullHost: chain.fullHost ?? chain.rpcUrl,
      fastSwapAddress: chain.fastSwapAddress!,
    })),
  ];
  const summaries = await Promise.all(
    runtimeChains.map((runtime) =>
      collectLiquidity({
        id: runtime.id,
        type: runtime.type,
        rpcUrl: runtime.rpcUrl,
        fullHost: runtime.fullHost,
        fastSwapAddress: runtime.fastSwapAddress,
        tokens: chains.find((chain) => chain.id === runtime.id)?.tokens.map((token) => ({
          symbol: token.symbol,
          address: token.isNative ? undefined : token.address,
          minLiquidity: token.minLiquidity ?? "0",
        })) ?? [],
      }).catch(() => [])
    )
  );
  return summaries.flat();
}

function createStatusResolver(deployment: DemoDeployment) {
  return async (invoice: FastSwapInvoice): Promise<FastSwapStatus> => {
    const chains = deploymentChains(deployment);
    const source = chains.find((chain) => chain.id === invoice.sourceChainId);
    const target = chains.find((chain) => chain.id === invoice.targetChainId);
    if (!source || !target) return invoice.status;

    const sourceContract = new Contract(
      source.fastSwap,
      [
        "function invoicePayment(bytes32 invoiceId) view returns (address token,uint256 amount,address forwarder)",
        ...FASTSWAP_RECEIVER_ABI,
      ],
      new JsonRpcProvider(source.rpcUrl)
    );
    const targetContract = new Contract(target.fastSwap, FASTSWAP_RECEIVER_ABI, new JsonRpcProvider(target.rpcUrl));

    const payment = await sourceContract.invoicePayment(invoice.invoiceId);
    if (payment.amount === 0n) return "waiting_payment";

    const targetState = await targetContract.swapState(invoice.invoiceId);
    if (targetState.processed) return "complete";
    if (targetState.queued) return "queued";
    if (targetState.relayed) return "relaying";
    return "paid";
  };
}

function createStaticServer(root: string, apiBase: string) {
  return createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", `http://${DEMO_HOST}`);
      if (url.pathname === "/demo-runtime.js") {
        return write(
          response,
          200,
          "application/javascript",
          [
            `globalThis.FASTSWAP_API_BASE = ${JSON.stringify(apiBase)};`,
            `globalThis.FASTSWAP_NODE_API_KEY = ${JSON.stringify(NODE_API_KEY)};`,
            `globalThis.FASTSWAP_DEMO_CAPTCHA_TOKEN = ${JSON.stringify(DEMO_CAPTCHA_TOKEN)};`,
            "",
          ].join("\n")
        );
      }

      const filePath = join(root, url.pathname === "/" ? "index.html" : url.pathname);
      if (filePath.endsWith("index.html")) {
        const html = await readFile(filePath, "utf8");
        return write(response, 200, "text/html", html.replace("</head>", '<script src="/demo-runtime.js"></script></head>'));
      }

      const file = await readFile(filePath);
      response.writeHead(200, { "content-type": contentType(filePath) });
      response.end(file);
    } catch {
      write(response, 404, "text/plain", "Not found");
    }
  });
}

function listen(server: ReturnType<typeof createServer>, port: number) {
  return new Promise<void>((resolve) => server.listen(port, DEMO_HOST, resolve));
}

function write(response: ServerResponse, status: number, contentType: string, body: string) {
  response.writeHead(status, { "content-type": contentType });
  response.end(body);
}

function contentType(filePath: string) {
  switch (extname(filePath)) {
    case ".css":
      return "text/css";
    case ".js":
      return "application/javascript";
    case ".html":
      return "text/html";
    default:
      return "text/plain";
  }
}

if (process.argv[1]?.endsWith("server.js")) {
  const deployment = JSON.parse(await readFile(DEMO_DEPLOYMENT_PATH, "utf8")) as DemoDeployment;
  await runDemoServers(deployment);
}
