import { readFile } from "node:fs/promises";
import { API_PORT, DEMO_HOST, DEMO_PRIVATE_KEY, DEMO_SWEEP_NODE, NODE_API_KEY, deploymentChains, type DemoDeployment } from "./config.js";
import { DEMO_DEPLOYMENT_PATH } from "./deploy.js";
import { SweepNode } from "../node/sweep-node.js";

export function createDemoSweepNode(deployment: DemoDeployment) {
  return new SweepNode({
    webServer: {
      baseUrl: `http://${DEMO_HOST}:${API_PORT}`,
      nodeApiKey: NODE_API_KEY,
      pageLimit: DEMO_SWEEP_NODE.pageLimit,
    },
    cache: {
      sqlitePath: "./fastSwapDemo/state/sweep-node.sqlite",
    },
    pollIntervalMs: DEMO_SWEEP_NODE.pollIntervalMs,
    chains: deploymentChains(deployment).map((chain) => ({
        type: "evm",
        id: chain.id,
        rpcUrl: chain.rpcUrl,
        privateKey: DEMO_PRIVATE_KEY,
        sweeperAddress: chain.sweeper,
        receiverAddress: chain.receiver,
        startBlock: chain.startBlock,
        confirmations: DEMO_SWEEP_NODE.confirmations,
        logScanOverlap: DEMO_SWEEP_NODE.logScanOverlap,
      })),
  });
}

if (process.argv[1]?.endsWith("sweep.js")) {
  const deployment = JSON.parse(await readFile(DEMO_DEPLOYMENT_PATH, "utf8")) as DemoDeployment;
  const sweepNode = createDemoSweepNode(deployment);
  sweepNode.start();
}
