#!/usr/bin/env node
import { Wallet } from "ethers";
import {
  getActiveChainDefinitions,
  getChainDefinition,
  getEvmActiveChains,
  loadFastSwapConfig,
  resolveChainContracts,
  resolveConfigPath,
  resolveCreateXAddress,
  tryResolveChainContracts,
} from "../config/load.js";
import {
  deployEvmStackToActiveChains,
  deployEvmStackToChain,
  predictEvmAddresses,
  readEvmOnChainState,
} from "./deploy-evm.js";
import { deployTronStack, readTronOnChainState } from "./deploy-tron.js";
import {
  addNativeLiquidity,
  allowLiquidityManagerRouter,
  configureFastSwapRole,
  listRoleNames,
  setLiquidityFloor,
} from "./configure-chain.js";
import { createPrompt, printJson, requireEnv } from "./prompt.js";
import { resolveEvmOwnerAddress } from "./owner.js";

const MENU = [
  "Show config summary",
  "Predict EVM CreateX addresses",
  "Deploy EVM stack to one chain",
  "Deploy EVM stack to all active EVM chains",
  "Deploy Tron stack",
  "Read on-chain contract state",
  "Configure contracts",
  "Validate config",
  "Exit",
] as const;

async function main() {
  const args = process.argv.slice(2);
  const configPath = resolveConfigPath(readFlag(args, "--config"));
  let config = loadFastSwapConfig(configPath);

  if (args.includes("--predict")) {
    const wallet = new Wallet(requireEnv("EVM_PRIVATE_KEY"));
    const owner = resolveEvmOwnerAddress(process.env.FASTSWAP_OWNER_ADDRESS, wallet.address);
    printJson(await predictEvmAddresses(config, owner));
    return;
  }

  const prompt = createPrompt();
  try {
    console.log(`FastSwap CLI — config: ${configPath}`);
    while (true) {
      const choice = await prompt.choose("Main menu", MENU, "Show config summary");
      config = loadFastSwapConfig(configPath);
      switch (choice) {
        case "Show config summary":
          await showSummary(config);
          break;
        case "Predict EVM CreateX addresses":
          await actionPredict(config);
          break;
        case "Deploy EVM stack to one chain":
          await actionDeployEvmOne(config, configPath, prompt);
          break;
        case "Deploy EVM stack to all active EVM chains":
          await actionDeployEvmAll(config, configPath, prompt);
          break;
        case "Deploy Tron stack":
          await actionDeployTron(config, configPath, prompt);
          break;
        case "Read on-chain contract state":
          await actionRead(config, prompt);
          break;
        case "Configure contracts":
          await actionConfigure(config, prompt);
          break;
        case "Validate config":
          printJson(validateConfig(config));
          break;
        case "Exit":
          return;
      }
    }
  } finally {
    prompt.close();
  }
}

async function showSummary(config: ReturnType<typeof loadFastSwapConfig>) {
  console.log("\nActive chains:");
  for (const chain of getActiveChainDefinitions(config)) {
    const contracts = tryResolveChainContracts(config, chain);
    console.log(`  - ${chain.key} (${chain.name}, ${chain.type}, id=${chain.id})`);
    if (contracts) {
      console.log(`      fastSwap=${contracts.fastSwapAddress}`);
      console.log(`      sweeper=${contracts.sweeperAddress}`);
      if (contracts.liquidityManagerAddress) {
        console.log(`      liquidityManager=${contracts.liquidityManagerAddress}`);
      }
    } else {
      console.log("      contracts: not configured");
    }
  }
  console.log(`\nCreateX factory: ${resolveCreateXAddress(config)}`);
  console.log(`Quote fee: ${config.quote.feeBps} bps`);
}

async function actionPredict(config: ReturnType<typeof loadFastSwapConfig>) {
  const wallet = new Wallet(requireEnv("EVM_PRIVATE_KEY"));
  const owner = resolveEvmOwnerAddress(process.env.FASTSWAP_OWNER_ADDRESS, wallet.address);
  printJson(await predictEvmAddresses(config, owner));
}

async function actionDeployEvmOne(
  config: ReturnType<typeof loadFastSwapConfig>,
  configPath: string,
  prompt: ReturnType<typeof createPrompt>
) {
  const evmChains = config.chains.filter((chain) => chain.type === "evm").map((chain) => chain.key);
  const chainKey = await prompt.choose("Select EVM chain", evmChains);
  const privateKey = requireEnv("EVM_PRIVATE_KEY");
  const includeLm = await prompt.confirm("Deploy LiquidityManager too?", true);
  const save = await prompt.confirm("Write addresses back to FastSwapConfig.yaml?", true);
  const result = await deployEvmStackToChain({
    config,
    chainKey,
    privateKey,
    includeLiquidityManager: includeLm,
    save,
    configPath,
  });
  printJson(result);
}

async function actionDeployEvmAll(
  config: ReturnType<typeof loadFastSwapConfig>,
  configPath: string,
  prompt: ReturnType<typeof createPrompt>
) {
  const active = getEvmActiveChains(config).map((chain) => chain.key);
  console.log(`Active EVM chains: ${active.join(", ")}`);
  const proceed = await prompt.confirm("Deploy CreateX stack to all of them?", false);
  if (!proceed) return;
  const privateKey = requireEnv("EVM_PRIVATE_KEY");
  const includeLm = await prompt.confirm("Deploy LiquidityManager too?", true);
  const save = await prompt.confirm("Write addresses back to FastSwapConfig.yaml?", true);
  const results = await deployEvmStackToActiveChains({
    config,
    privateKey,
    includeLiquidityManager: includeLm,
    save,
    configPath,
  });
  printJson(results);
}

async function actionDeployTron(
  config: ReturnType<typeof loadFastSwapConfig>,
  configPath: string,
  prompt: ReturnType<typeof createPrompt>
) {
  const privateKey = requireEnv("TRON_PRIVATE_KEY");
  const includeLm = await prompt.confirm("Deploy LiquidityManager too?", true);
  const save = await prompt.confirm("Write addresses back to FastSwapConfig.yaml?", true);
  const result = await deployTronStack({
    config,
    privateKey,
    includeLiquidityManager: includeLm,
    save,
    configPath,
  });
  printJson(result);
}

async function actionRead(config: ReturnType<typeof loadFastSwapConfig>, prompt: ReturnType<typeof createPrompt>) {
  const active = getActiveChainDefinitions(config).map((chain) => chain.key);
  const chainKey = await prompt.choose("Select chain", active);
  const chain = getChainDefinition(config, chainKey);
  const contracts = resolveChainContracts(config, chain);
  if (chain.type === "evm") {
    printJson(
      await readEvmOnChainState({
        config,
        chainKey,
        addresses: {
          fastSwapAddress: contracts.fastSwapAddress,
          sweeperAddress: contracts.sweeperAddress,
          liquidityManagerAddress: contracts.liquidityManagerAddress,
        },
      })
    );
    return;
  }
  printJson(
    await readTronOnChainState({
      config,
      chainKey,
      addresses: {
        fastSwapAddress: contracts.fastSwapAddress,
        sweeperAddress: contracts.sweeperAddress,
        liquidityManagerAddress: contracts.liquidityManagerAddress,
      },
    })
  );
}

async function actionConfigure(config: ReturnType<typeof loadFastSwapConfig>, prompt: ReturnType<typeof createPrompt>) {
  const actions = [
    "Grant/revoke FastSwap role (EVM)",
    "Set liquidity floor (EVM)",
    "Add native liquidity (EVM)",
    "Allow router on LiquidityManager (EVM)",
  ] as const;
  const action = await prompt.choose("Configure action", actions);
  const evmActive = getEvmActiveChains(config).map((chain) => chain.key);
  const chainKey = await prompt.choose("Select EVM chain", evmActive);
  const privateKey = requireEnv("EVM_PRIVATE_KEY");

  switch (action) {
    case "Grant/revoke FastSwap role (EVM)": {
      const role = await prompt.choose("Role", listRoleNames() as unknown as readonly string[]);
      const account = await prompt.ask("Account address");
      const grant = await prompt.confirm("Grant role?", true);
      printJson(await configureFastSwapRole({ config, chainKey, privateKey, role: role as never, account, grant }));
      break;
    }
    case "Set liquidity floor (EVM)": {
      const token = await prompt.ask("Token address (or NATIVE)");
      const amount = await prompt.ask("Floor amount (base units)");
      printJson(await setLiquidityFloor({ config, chainKey, privateKey, token, amount }));
      break;
    }
    case "Add native liquidity (EVM)": {
      const amount = await prompt.ask("Native amount (base units)");
      printJson(await addNativeLiquidity({ config, chainKey, privateKey, amount }));
      break;
    }
    case "Allow router on LiquidityManager (EVM)": {
      const chain = getChainDefinition(config, chainKey);
      const router = await prompt.ask("Router address", chain.router ?? "");
      const allowed = await prompt.confirm("Allow router?", true);
      printJson(await allowLiquidityManagerRouter({ config, chainKey, privateKey, router, allowed }));
      break;
    }
  }
}

function validateConfig(config: ReturnType<typeof loadFastSwapConfig>) {
  const issues: string[] = [];
  for (const key of config["active-chains"]) {
    if (!config.chains.some((chain) => chain.key === key)) {
      issues.push(`active-chains references unknown key "${key}"`);
    }
  }
  for (const chain of getActiveChainDefinitions(config)) {
    if (chain.type === "evm" && !chain.rpcUrl) issues.push(`${chain.key}: missing rpcUrl env expansion`);
    if (chain.type === "tron" && !(chain.fullHost || chain.rpcUrl)) {
      issues.push(`${chain.key}: missing fullHost env expansion`);
    }
    const contracts = tryResolveChainContracts(config, chain);
    if (!contracts) {
      issues.push(`${chain.key}: contract addresses not set`);
      continue;
    }
    if (!contracts.fastSwapAddress || !contracts.sweeperAddress) {
      issues.push(`${chain.key}: missing fastSwap or sweeper address`);
    }
  }
  return { ok: issues.length === 0, issues };
}

function readFlag(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index === -1) return undefined;
  return args[index + 1];
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
