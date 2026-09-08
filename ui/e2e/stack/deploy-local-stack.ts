import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { network } from "hardhat";
import { ENTRYPOINT_V09 } from "../../../commerce/shared/userop.js";
import {
  deployPersistRecoveryStack,
  HH_DEPLOYER_KEY,
  PAY_UNITS,
} from "../../../test/helpers/persist-recovery-harness.js";

const HH_PAYER_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
const HH_COLLECTOR_KEY = "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a";

const STACK_PATH = process.env.E2E_STACK_PATH ?? "/tmp/tc-e2e-stack.json";

async function main(): Promise<void> {
  const { ethers } = await network.connect();
  const chainId = Number((await ethers.provider.getNetwork()).chainId);
  if (chainId !== 11155111) {
    throw new Error(`expected chainId 11155111 for local-stack e2e, got ${chainId}`);
  }

  const stack = await deployPersistRecoveryStack(ethers);
  const ownerAddress = await stack.owner.getAddress();
  const payerAddress = await stack.payer.getAddress();
  const collectorAddress = await stack.collector.getAddress();

  const EntryPoint = await ethers.getContractFactory("E2eEntryPoint");
  const entryPoint = await EntryPoint.deploy();
  await entryPoint.waitForDeployment();
  const epCode = await ethers.provider.getCode(await entryPoint.getAddress());
  if (!epCode || epCode === "0x") throw new Error("E2eEntryPoint deploy produced empty bytecode");
  await ethers.provider.send("hardhat_setCode", [ENTRYPOINT_V09, epCode]);
  const placed = await ethers.provider.getCode(ENTRYPOINT_V09);
  if (placed.length < 10) throw new Error("hardhat_setCode failed for EntryPoint");

  const Ping = await ethers.getContractFactory("E2ePing");
  const ping = await Ping.deploy();
  await ping.waitForDeployment();

  const token = await ethers.getContractAt("MockERC20", stack.usdcAddress);
  await (token as { mint: (to: string, amount: bigint) => Promise<{ wait: () => Promise<unknown> }> }).mint(
    ownerAddress,
    50_000n * PAY_UNITS
  );

  const out = {
    chainId: "11155111",
    rpcUrl: process.env.HARDHAT_RPC_URL?.trim() || "http://127.0.0.1:8545",
    sweeperAddress: stack.sweeperAddress,
    forwarderImplementation: stack.forwarderImplementation,
    factoryAddress: stack.factoryAddress,
    implementationAddress: stack.implementationAddress,
    recoveryAddress: stack.recoveryAddress,
    usdcAddress: stack.usdcAddress,
    pingAddress: await ping.getAddress(),
    entryPointAddress: ENTRYPOINT_V09,
    ownerAddress,
    payerAddress,
    collectorAddress,
    ownerKey: HH_DEPLOYER_KEY,
    payerKey: HH_PAYER_KEY,
    collectorKey: HH_COLLECTOR_KEY,
  };

  mkdirSync(dirname(STACK_PATH), { recursive: true });
  writeFileSync(STACK_PATH, JSON.stringify(out, null, 2));
  console.log(`wrote ${STACK_PATH}`);
  console.log(JSON.stringify(out, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
