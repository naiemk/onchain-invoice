import type { FastSwapConfigFile } from "../config/types.js";
import { getActiveChainDefinitions, tryResolveChainContracts } from "../config/load.js";

const PLACEHOLDER_PUBLIC_URLS = new Set([
  "https://api.example.com",
  "http://localhost:4010",
  "http://127.0.0.1:4010",
]);

export type ValidateConfigResult = {
  ok: boolean;
  issues: string[];
};

export function validateFastSwapConfig(config: FastSwapConfigFile, env: NodeJS.ProcessEnv = process.env): ValidateConfigResult {
  const issues: string[] = [];

  const signingEnv = config.server.signingSecretEnv ?? "API_SIGNING_SECRET";
  const signingSecret = env[signingEnv] ?? config.server.nodeApiKey;
  if (!signingSecret) {
    issues.push(`Missing ${signingEnv}`);
  } else if (signingSecret.length < 32) {
    issues.push(`${signingEnv} should be at least 32 characters`);
  }

  if (!config.server.publicUrl || PLACEHOLDER_PUBLIC_URLS.has(config.server.publicUrl)) {
    issues.push("server.publicUrl is unset or still a placeholder");
  }

  const captcha = config.server.captcha;
  const captchaRequired = captcha.requireForQuotes === true || captcha.requireForInvoices === true;
  if (captchaRequired && (!captcha.siteKey || !captcha.secretKey)) {
    issues.push("captcha is required but siteKey/secretKey are empty");
  }

  for (const key of config["active-chains"]) {
    if (!config.chains.some((chain) => chain.key === key)) {
      issues.push(`active-chains references unknown key "${key}"`);
    }
  }

  for (const chain of getActiveChainDefinitions(config)) {
    if (chain.type === "evm") {
      if (!chain.rpcUrl) issues.push(`${chain.key}: missing rpcUrl env expansion`);
      if (!chain.router) issues.push(`${chain.key}: missing router env expansion`);
    }
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
    if (chain.type === "evm" && !contracts.liquidityManagerAddress) {
      issues.push(`${chain.key}: missing liquidityManagerAddress`);
    }
  }

  if (!config.deploy.createx) {
    issues.push("deploy.createx is not set");
  }

  return { ok: issues.length === 0, issues };
}
