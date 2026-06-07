import { Contract, JsonRpcProvider } from "ethers";
import { TronWeb } from "tronweb";
import { ERC20_ABI, NATIVE_TOKEN } from "../../../../src/abis.js";
import { TRC20_ABI, TRON_FASTSWAP_RECEIVER_ABI, TRON_NATIVE_TOKEN } from "../../../../src/tron-abis.js";
import { FASTSWAP_RECEIVER_ABI } from "../../shared/fastswap-abi.js";
import type { FastSwapLiquiditySummary } from "../../shared/types.js";

export type LiquidityMonitorChain = {
  id: string;
  type?: "evm" | "tron";
  rpcUrl?: string;
  /** TRON HTTP endpoint (TronWeb fullHost). Falls back to rpcUrl. */
  fullHost?: string;
  fastSwapAddress: string;
  tokens: Array<{ symbol: string; address?: string; minLiquidity: string }>;
  explorerUrl?: string;
};

export async function collectLiquidity(chain: LiquidityMonitorChain): Promise<FastSwapLiquiditySummary[]> {
  return chain.type === "tron" ? collectTronLiquidity(chain) : collectEvmLiquidity(chain);
}

async function collectEvmLiquidity(chain: LiquidityMonitorChain): Promise<FastSwapLiquiditySummary[]> {
  const provider = new JsonRpcProvider(chain.rpcUrl);
  const fastSwap = new Contract(chain.fastSwapAddress, FASTSWAP_RECEIVER_ABI, provider);
  const summaries: FastSwapLiquiditySummary[] = [];

  for (const token of chain.tokens) {
    const tokenAddress = token.address ?? NATIVE_TOKEN;
    const balance = token.address
      ? await new Contract(token.address, ERC20_ABI, provider).balanceOf(chain.fastSwapAddress)
      : await provider.getBalance(chain.fastSwapAddress);
    const reserved = await fastSwap.liquidityFloor(tokenAddress);
    const minLiquidity = BigInt(token.minLiquidity);

    summaries.push({
      chainId: chain.id,
      token: token.symbol,
      balance: balance.toString(),
      reserved: reserved.toString(),
      queuedAmount: "0",
      lowLiquidity: BigInt(balance.toString()) < minLiquidity,
    });
  }

  return summaries;
}

async function collectTronLiquidity(chain: LiquidityMonitorChain): Promise<FastSwapLiquiditySummary[]> {
  const tronWeb = new TronWeb({ fullHost: chain.fullHost ?? chain.rpcUrl ?? "" });
  const fastSwap = await tronWeb.contract(TRON_FASTSWAP_RECEIVER_ABI as never, chain.fastSwapAddress);
  const summaries: FastSwapLiquiditySummary[] = [];

  for (const token of chain.tokens) {
    const isNative = !token.address;
    const balance = isNative
      ? BigInt(await tronWeb.trx.getBalance(chain.fastSwapAddress))
      : BigInt((await tronWeb.contract(TRC20_ABI as never, token.address!).balanceOf(chain.fastSwapAddress).call()).toString());
    const floorToken = token.address ?? TRON_NATIVE_TOKEN;
    const reserved = BigInt((await fastSwap.liquidityFloor(floorToken).call()).toString());
    const minLiquidity = BigInt(token.minLiquidity);

    summaries.push({
      chainId: chain.id,
      token: token.symbol,
      balance: balance.toString(),
      reserved: reserved.toString(),
      queuedAmount: "0",
      lowLiquidity: balance < minLiquidity,
    });
  }

  return summaries;
}
