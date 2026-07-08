/**
 * Step-by-step production bootstrap helpers.
 * Each function is idempotent where possible (skips grants that already exist).
 */
import { Contract, ContractFactory, JsonRpcProvider, Wallet, ZeroAddress } from "ethers";
import { TronWeb } from "tronweb";
import type { FastSwapConfigFile, FastSwapChainDefinition } from "../config/types.js";
import {
  getActiveChainDefinitions,
  getChainDefinition,
  loadFastSwapConfig,
  resolveChainContracts,
  saveFastSwapConfig,
  updateChainTokenAddress,
} from "../config/load.js";
import { parseDecimalToRaw } from "../config/normalize.js";
import { tronAddressToEvmHex } from "../shared/tron-address.js";
import {
  addNativeLiquidity,
  allowLiquidityManagerRouter,
  configureFastSwapRole,
} from "./configure-chain.js";
import { readArtifact } from "./artifacts.js";

export const BOOTSTRAP_STEPS = [
  "env",
  "deploy-evm",
  "deploy-tron",
  "deploy-tokens",
  "configure-all",
  "seed",
  "liqman-once",
  "validate",
  "smoke",
] as const;

export type BootstrapStep = (typeof BOOTSTRAP_STEPS)[number];

/** Copy operator keys to node env vars when unset (single-wallet testnet/prod setup). */
export function applyOperatorEnvDefaults(): void {
  const evm = process.env.EVM_PRIVATE_KEY;
  const tron = process.env.TRON_PRIVATE_KEY ?? evm;
  if (evm) {
    process.env.SWEEP_EVM_PRIVATE_KEY ??= evm;
    process.env.RELAY_EVM_PRIVATE_KEY ??= evm;
    process.env.LM_PRIVATE_KEY ??= evm;
  }
  if (tron) {
    process.env.SWEEP_TRON_PRIVATE_KEY ??= tron;
    process.env.RELAY_TRON_PRIVATE_KEY ??= tron;
  }
  if (evm && !process.env.FASTSWAP_OWNER_ADDRESS) {
    process.env.FASTSWAP_OWNER_ADDRESS = new Wallet(evm).address;
  }
}

export function stepEnvCheck(config: FastSwapConfigFile) {
  applyOperatorEnvDefaults();
  const evmKey = process.env.EVM_PRIVATE_KEY;
  const tronKey = process.env.TRON_PRIVATE_KEY ?? evmKey;
  const signing = process.env[config.server.signingSecretEnv ?? "API_SIGNING_SECRET"];
  const issues: string[] = [];
  if (!evmKey) issues.push("Missing EVM_PRIVATE_KEY");
  if (!tronKey) issues.push("Missing TRON_PRIVATE_KEY (or EVM_PRIVATE_KEY)");
  if (!signing) issues.push(`Missing ${config.server.signingSecretEnv ?? "API_SIGNING_SECRET"}`);
  for (const chain of getActiveChainDefinitions(config)) {
    if (chain.type === "evm" && !chain.rpcUrl) issues.push(`${chain.key}: RPC not set (${chain.rpcUrl === "" ? "empty env expansion" : "missing"})`);
    if (chain.type === "tron" && !(chain.fullHost || chain.rpcUrl)) issues.push(`${chain.key}: TRON host not set`);
  }
  const evmAddr = evmKey ? new Wallet(evmKey).address : undefined;
  let tronAddr: string | undefined;
  if (tronKey) {
    try {
      tronAddr = new TronWeb({ fullHost: "https://api.trongrid.io", privateKey: tronKey.replace(/^0x/, "") })
        .defaultAddress.base58 as string;
    } catch {
      issues.push("Invalid TRON_PRIVATE_KEY");
    }
  }
  return {
    ok: issues.length === 0,
    issues,
    evmAddress: evmAddr,
    tronAddress: tronAddr,
    owner: process.env.FASTSWAP_OWNER_ADDRESS ?? evmAddr,
  };
}

export async function stepDeployTokens(config: FastSwapConfigFile, configPath?: string): Promise<FastSwapConfigFile> {
  const evmKey = requireEnv("EVM_PRIVATE_KEY");
  const tronKey = requireEnv("TRON_PRIVATE_KEY", process.env.EVM_PRIVATE_KEY);
  const mock = await readArtifact("contracts/mocks/MockERC20.sol/MockERC20.json");
  let working = config;

  for (const chain of getActiveChainDefinitions(config)) {
    const usdt = chain.tokens.find((t) => t.symbol === "USDT" || t.symbol === "USDC");
    if (!usdt || usdt.isNative) continue;
    if (usdt.address && usdt.address.length > 4) {
      console.log(`[deploy-tokens] ${chain.key}: USDT already at ${usdt.address}`);
      continue;
    }

    if (chain.type === "evm") {
      if (!chain.rpcUrl) throw new Error(`${chain.key}: rpcUrl required`);
      const wallet = new Wallet(evmKey, new JsonRpcProvider(chain.rpcUrl));
      const factory = new ContractFactory(mock.abi, mock.bytecode, wallet);
      const token = await factory.deploy("Test USDT", "USDT", usdt.decimals);
      await token.waitForDeployment();
      const address = String(await token.getAddress());
      working = updateChainTokenAddress(working, chain.key, usdt.symbol, address);
      console.log(`[deploy-tokens] ${chain.key}: deployed USDT at ${address}`);
    } else {
      const fullHost = chain.fullHost ?? chain.rpcUrl!;
      const tronWeb = new TronWeb({ fullHost, privateKey: tronKey.replace(/^0x/, "") });
      const result = await tronWeb.contract().new({
        abi: mock.abi as never,
        bytecode: mock.bytecode.replace(/^0x/, ""),
        feeLimit: chain.feeLimit ?? 150_000_000,
        parameters: ["Test USDT", "USDT", usdt.decimals] as never,
      } as never);
      const address = (result as { address: string }).address.startsWith("T")
        ? (result as { address: string }).address
        : tronWeb.address.fromHex((result as { address: string }).address);
      working = updateChainTokenAddress(working, chain.key, usdt.symbol, address);
      console.log(`[deploy-tokens] ${chain.key}: deployed USDT at ${address}`);
    }
  }

  if (configPath) saveFastSwapConfig(working, configPath);
  return working;
}

export async function configureChainFromYaml(
  config: FastSwapConfigFile,
  chainKey: string,
  operatorPrivateKey: string
): Promise<Record<string, unknown>[]> {
  const chain = getChainDefinition(config, chainKey);
  const contracts = resolveChainContracts(config, chain);
  if (!contracts.liquidityManagerAddress) throw new Error(`${chainKey}: missing liquidityManagerAddress`);

  const lmAddress = contracts.liquidityManagerAddress;
  const operator =
    chain.type === "evm"
      ? new Wallet(operatorPrivateKey, new JsonRpcProvider(chain.rpcUrl!)).address
      : new TronWeb({
          fullHost: chain.fullHost ?? chain.rpcUrl ?? "",
          privateKey: operatorPrivateKey.replace(/^0x/, ""),
        }).defaultAddress.base58 as string;

  const results: Record<string, unknown>[] = [];

  for (const role of ["REBALANCER_ROLE", "LIQUIDITY_ROLE"] as const) {
    results.push(
      await grantFastSwapRoleIfNeeded(config, chainKey, operatorPrivateKey, role, lmAddress)
    );
  }
  results.push(await grantFastSwapRoleIfNeeded(config, chainKey, operatorPrivateKey, "LIQUIDITY_ROLE", operator));
  results.push(await grantFastSwapRoleIfNeeded(config, chainKey, operatorPrivateKey, "RELAYER_ROLE", operator));
  results.push(await grantLmRoleIfNeeded(config, chainKey, operatorPrivateKey, "REBALANCER_ROLE", operator));

  if (chain.router) {
    if (chain.type === "evm") {
      results.push(
        await allowLiquidityManagerRouter({
          config,
          chainKey,
          privateKey: operatorPrivateKey,
          router: chain.router,
          allowed: true,
        })
      );
    } else {
      results.push(await allowTronLiquidityManagerRouter(config, chainKey, operatorPrivateKey, chain.router, true));
    }
  }

  if (chain.liquidity) {
    for (const receiver of chain.liquidity.receivers) {
      for (const band of receiver.tokens) {
        const token = chain.tokens.find((t) => t.symbol === band.symbol);
        if (!token) continue;
        const rawFloor = parseDecimalToRaw(band.floor, token.decimals, `${chainKey}.${band.symbol}.floor`);
        if (chain.type === "evm") {
          const tokenArg = token.isNative ? "NATIVE" : token.address!;
          const { setLiquidityFloor } = await import("./configure-chain.js");
          results.push(
            await setLiquidityFloor({
              config,
              chainKey,
              privateKey: operatorPrivateKey,
              token: tokenArg,
              amount: rawFloor,
            })
          );
        } else {
          results.push(await setTronLiquidityFloor(chain, contracts.fastSwapAddress, operatorPrivateKey, token, rawFloor));
        }
      }
    }
  }

  return results;
}

export async function stepConfigureAll(config: FastSwapConfigFile): Promise<Record<string, unknown>[]> {
  applyOperatorEnvDefaults();
  const evmKey = requireEnv("EVM_PRIVATE_KEY");
  const tronKey = requireEnv("TRON_PRIVATE_KEY", process.env.EVM_PRIVATE_KEY);
  const results: Record<string, unknown>[] = [];
  for (const chain of getActiveChainDefinitions(config)) {
    const key = chain.type === "evm" ? evmKey : tronKey;
    console.log(`[configure-all] ${chain.key}…`);
    results.push(...(await configureChainFromYaml(config, chain.key, key)));
  }
  return results;
}

export async function stepSeedLiquidity(config: FastSwapConfigFile): Promise<Record<string, unknown>[]> {
  applyOperatorEnvDefaults();
  const evmKey = requireEnv("EVM_PRIVATE_KEY");
  const tronKey = requireEnv("TRON_PRIVATE_KEY", process.env.EVM_PRIVATE_KEY);
  const results: Record<string, unknown>[] = [];

  for (const chain of getActiveChainDefinitions(config)) {
    if (!chain.liquidity) continue;
    const privateKey = chain.type === "evm" ? evmKey : tronKey;
    const contracts = resolveChainContracts(config, chain);
    const stableSymbol =
      typeof chain.liquidity.reserveStable === "string"
        ? chain.liquidity.reserveStable
        : chain.liquidity.reserveStable.symbol;
    const stableToken = chain.tokens.find((t) => t.symbol === stableSymbol);
    if (!stableToken?.address) throw new Error(`${chain.key}: stable token ${stableSymbol} has no address — run deploy-tokens first`);

    let reserveTarget = 0n;
    for (const receiver of chain.liquidity.receivers) {
      for (const band of receiver.tokens) {
        const token = chain.tokens.find((t) => t.symbol === band.symbol);
        if (!token) continue;
        const target = BigInt(parseDecimalToRaw(band.target, token.decimals, `${band.symbol}.target`));
        if (token.isNative) {
          if (chain.type === "evm") {
            results.push(await addNativeLiquidity({ config, chainKey: chain.key, privateKey, amount: target.toString() }));
          } else {
            results.push(await addTronNativeLiquidity(chain, contracts.fastSwapAddress, privateKey, target));
          }
        } else if (token.symbol === stableSymbol) {
          reserveTarget += target;
          results.push(
            ...(await seedStableOnReceiver(chain, contracts.fastSwapAddress, privateKey, stableToken.address!, target))
          );
        }
      }
    }

    if (reserveTarget > 0n) {
      results.push(
        ...(await seedLmReserve(chain, contracts.liquidityManagerAddress!, privateKey, stableToken.address!, reserveTarget))
      );
    }
  }

  return results;
}

export async function stepLiqmanOnce(configPath: string): Promise<void> {
  applyOperatorEnvDefaults();
  const { spawn } = await import("node:child_process");
  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      "node",
      ["lm-dist/LiquidityManager/bot/index.js", "--fastswap-config", configPath, "--once"],
      { stdio: "inherit", env: process.env, cwd: process.cwd() }
    );
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`liqman exited ${code}`))));
  });
}

async function allowTronLiquidityManagerRouter(
  config: FastSwapConfigFile,
  chainKey: string,
  privateKey: string,
  router: string,
  allowed: boolean
) {
  const chain = getChainDefinition(config, chainKey);
  const contracts = resolveChainContracts(config, chain);
  const tronWeb = new TronWeb({ fullHost: chain.fullHost ?? chain.rpcUrl!, privateKey: privateKey.replace(/^0x/, "") });
  const lmArtifact = await readArtifact("contracts/tron/liquiditymanager/TronLiquidityManager.sol/TronLiquidityManager.json");
  const lm = await tronWeb.contract(lmArtifact.abi as never, contracts.liquidityManagerAddress!);
  const txId = await lm.setRouterAllowed(router, allowed).send({ feeLimit: chain.feeLimit ?? 150_000_000 });
  return { chainKey, router, allowed, txHash: txId };
}

async function grantFastSwapRoleIfNeeded(
  config: FastSwapConfigFile,
  chainKey: string,
  privateKey: string,
  role: "REBALANCER_ROLE" | "LIQUIDITY_ROLE" | "RELAYER_ROLE",
  account: string
) {
  const chain = getChainDefinition(config, chainKey);
  if (chain.type === "tron") {
    return grantTronFastSwapRole(chain, config, privateKey, role, account);
  }
  const contracts = resolveChainContracts(config, chain);
  const artifact = await readArtifact("contracts/fastswap/FastSwapReceiver.sol/FastSwapReceiver.json");
  const wallet = new Wallet(privateKey, new JsonRpcProvider(chain.rpcUrl!));
  const fastSwap = new Contract(contracts.fastSwapAddress, artifact.abi, wallet);
  const roleHash = await fastSwap.getFunction(role)();
  if (await fastSwap.hasRole(roleHash, account)) {
    return { chainKey, role, account, skipped: true };
  }
  return configureFastSwapRole({ config, chainKey, privateKey, role, account, grant: true });
}

async function grantLmRoleIfNeeded(
  config: FastSwapConfigFile,
  chainKey: string,
  privateKey: string,
  role: "REBALANCER_ROLE",
  account: string
) {
  const chain = getChainDefinition(config, chainKey);
  const contracts = resolveChainContracts(config, chain);
  if (chain.type === "evm") {
    const artifact = await readArtifact("contracts/liquiditymanager/LiquidityManager.sol/LiquidityManager.json");
    const wallet = new Wallet(privateKey, new JsonRpcProvider(chain.rpcUrl!));
    const lm = new Contract(contracts.liquidityManagerAddress!, artifact.abi, wallet);
    const roleHash = await lm.getFunction(role)();
    if (await lm.hasRole(roleHash, account)) return { chainKey, role, account, skipped: true };
    const tx = await lm.grantRole(roleHash, account);
    await tx.wait();
    return { chainKey, role, account, txHash: tx.hash };
  }
  const tronWeb = new TronWeb({ fullHost: chain.fullHost ?? chain.rpcUrl!, privateKey: privateKey.replace(/^0x/, "") });
  const lmArtifact = await readArtifact("contracts/tron/liquiditymanager/TronLiquidityManager.sol/TronLiquidityManager.json");
  const lm = await tronWeb.contract(lmArtifact.abi as never, contracts.liquidityManagerAddress!);
  const roleHash = await lm[role]().call();
  const has = await lm.hasRole(roleHash, account).call();
  if (has) return { chainKey, role, account, skipped: true };
  const txId = await lm.grantRole(roleHash, account).send({ feeLimit: chain.feeLimit ?? 150_000_000 });
  return { chainKey, role, account, txHash: txId };
}

async function grantTronFastSwapRole(
  chain: FastSwapChainDefinition,
  config: FastSwapConfigFile,
  privateKey: string,
  role: "REBALANCER_ROLE" | "LIQUIDITY_ROLE" | "RELAYER_ROLE",
  account: string
) {
  const contracts = resolveChainContracts(config, chain);
  const tronWeb = new TronWeb({ fullHost: chain.fullHost ?? chain.rpcUrl!, privateKey: privateKey.replace(/^0x/, "") });
  const artifact = await readArtifact("contracts/tron/fastswap/TronFastSwapReceiver.sol/TronFastSwapReceiver.json");
  const fastSwap = await tronWeb.contract(artifact.abi as never, contracts.fastSwapAddress);
  const roleHash = await fastSwap[role]().call();
  const accountArg = account.startsWith("T") ? tronAddressToEvmHex(account) : account;
  if (await fastSwap.hasRole(roleHash, accountArg).call()) {
    return { chainKey: chain.key, role, account, skipped: true };
  }
  const txId = await fastSwap.grantRole(roleHash, accountArg).send({ feeLimit: chain.feeLimit ?? 150_000_000 });
  return { chainKey: chain.key, role, account, txHash: txId };
}

async function setTronLiquidityFloor(
  chain: FastSwapChainDefinition,
  fastSwapAddress: string,
  privateKey: string,
  token: { isNative?: boolean; address?: string },
  rawFloor: string
) {
  const tronWeb = new TronWeb({ fullHost: chain.fullHost ?? chain.rpcUrl!, privateKey: privateKey.replace(/^0x/, "") });
  const artifact = await readArtifact("contracts/tron/fastswap/TronFastSwapReceiver.sol/TronFastSwapReceiver.json");
  const fastSwap = await tronWeb.contract(artifact.abi as never, fastSwapAddress);
  const tokenArg = token.isNative ? ZeroAddress : token.address!;
  const txId = await fastSwap.setLiquidityFloor(tokenArg, rawFloor).send({ feeLimit: chain.feeLimit ?? 150_000_000 });
  return { chainKey: chain.key, token: tokenArg, amount: rawFloor, txHash: txId };
}

async function addTronNativeLiquidity(
  chain: FastSwapChainDefinition,
  fastSwapAddress: string,
  privateKey: string,
  amount: bigint
) {
  const tronWeb = new TronWeb({ fullHost: chain.fullHost ?? chain.rpcUrl!, privateKey: privateKey.replace(/^0x/, "") });
  const artifact = await readArtifact("contracts/tron/fastswap/TronFastSwapReceiver.sol/TronFastSwapReceiver.json");
  const fastSwap = await tronWeb.contract(artifact.abi as never, fastSwapAddress);
  const txId = await fastSwap.addLiquidity(ZeroAddress, amount.toString()).send({
    feeLimit: chain.feeLimit ?? 150_000_000,
    callValue: Number(amount),
  });
  return { chainKey: chain.key, amount: amount.toString(), txHash: txId };
}

async function seedLmReserve(
  chain: FastSwapChainDefinition,
  lmAddress: string,
  privateKey: string,
  stableAddress: string,
  amount: bigint
): Promise<Record<string, unknown>[]> {
  const results: Record<string, unknown>[] = [];
  if (chain.type === "evm") {
    const wallet = new Wallet(privateKey, new JsonRpcProvider(chain.rpcUrl!));
    await mintIfMock(stableAddress, wallet.address, amount, wallet);
    const erc20 = new Contract(stableAddress, ["function transfer(address,uint256) returns (bool)"], wallet);
    const tx = await erc20.transfer(lmAddress, amount);
    await tx.wait();
    results.push({ chainKey: chain.key, action: "seed-lm-reserve", amount: amount.toString(), txHash: tx.hash });
  } else {
    const tronWeb = new TronWeb({ fullHost: chain.fullHost ?? chain.rpcUrl!, privateKey: privateKey.replace(/^0x/, "") });
    const operator = tronWeb.defaultAddress.base58 as string;
    await mintIfMockTron(tronWeb, stableAddress, operator, amount);
    const trc20 = await tronWeb.contract(
      [{ type: "function", name: "transfer", inputs: [{ type: "address" }, { type: "uint256" }], outputs: [{ type: "bool" }] }] as never,
      stableAddress
    );
    const txId = await trc20.transfer(lmAddress, amount.toString()).send({ feeLimit: chain.feeLimit ?? 150_000_000 });
    results.push({ chainKey: chain.key, action: "seed-lm-reserve", amount: amount.toString(), txHash: txId });
  }
  return results;
}

async function seedStableOnReceiver(
  chain: FastSwapChainDefinition,
  fastSwapAddress: string,
  privateKey: string,
  stableAddress: string,
  amount: bigint
): Promise<Record<string, unknown>[]> {
  const results: Record<string, unknown>[] = [];
  if (chain.type === "evm") {
    const wallet = new Wallet(privateKey, new JsonRpcProvider(chain.rpcUrl!));
    await mintIfMock(stableAddress, wallet.address, amount, wallet);
    const artifact = await readArtifact("contracts/fastswap/FastSwapReceiver.sol/FastSwapReceiver.json");
    const fastSwap = new Contract(fastSwapAddress, artifact.abi, wallet);
    const erc20 = new Contract(stableAddress, ["function approve(address,uint256) returns (bool)"], wallet);
    await (await erc20.approve(fastSwapAddress, amount)).wait();
    const tx = await fastSwap.addLiquidity(stableAddress, amount);
    await tx.wait();
    results.push({ chainKey: chain.key, action: "seed-receiver-stable", amount: amount.toString(), txHash: tx.hash });
  } else {
    const tronWeb = new TronWeb({ fullHost: chain.fullHost ?? chain.rpcUrl!, privateKey: privateKey.replace(/^0x/, "") });
    const operator = tronWeb.defaultAddress.base58 as string;
    await mintIfMockTron(tronWeb, stableAddress, operator, amount);
    const artifact = await readArtifact("contracts/tron/fastswap/TronFastSwapReceiver.sol/TronFastSwapReceiver.json");
    const fastSwap = await tronWeb.contract(artifact.abi as never, fastSwapAddress);
    const trc20 = await tronWeb.contract(
      [
        { type: "function", name: "approve", inputs: [{ type: "address" }, { type: "uint256" }], outputs: [{ type: "bool" }] },
      ] as never,
      stableAddress
    );
    await trc20.approve(fastSwapAddress, amount.toString()).send({ feeLimit: chain.feeLimit ?? 150_000_000 });
    const txId = await fastSwap.addLiquidity(stableAddress, amount.toString()).send({ feeLimit: chain.feeLimit ?? 150_000_000 });
    results.push({ chainKey: chain.key, action: "seed-receiver-stable", amount: amount.toString(), txHash: txId });
  }
  return results;
}

async function mintIfMock(token: string, to: string, amount: bigint, wallet: Wallet) {
  try {
    const mock = new Contract(token, ["function mint(address,uint256)"], wallet);
    await (await mock.mint(to, amount)).wait();
  } catch {
    // not a mock token — assume wallet already holds balance
  }
}

async function mintIfMockTron(tronWeb: TronWeb, token: string, to: string, amount: bigint) {
  try {
    const c = await tronWeb.contract(
      [{ type: "function", name: "mint", inputs: [{ type: "address" }, { type: "uint256" }], outputs: [] }] as never,
      token
    );
    await c.mint(to, amount.toString()).send({ feeLimit: 150_000_000 });
  } catch {
    // not mock
  }
}

function requireEnv(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (!value) throw new Error(`Missing env ${name}`);
  return value;
}

export function reloadConfig(configPath: string): FastSwapConfigFile {
  applyOperatorEnvDefaults();
  return loadFastSwapConfig(configPath);
}
