import { Contract, JsonRpcProvider, Wallet } from "ethers";
import { FASTSWAP_RECEIVER_ABI } from "../../shared/fastswap-abi.js";

export type AggregateAllConfig = {
  rpcUrl: string;
  privateKey: string;
  fastSwapAddress: string;
  token: string;
  aggregator: string;
  minReserve: string;
  callData: string;
};

export async function aggregateAll(config: AggregateAllConfig) {
  const provider = new JsonRpcProvider(config.rpcUrl);
  const wallet = new Wallet(config.privateKey, provider);
  const fastSwap = new Contract(config.fastSwapAddress, FASTSWAP_RECEIVER_ABI, wallet);
  const tx = await fastSwap.aggregateAll(config.token, config.aggregator, config.minReserve, config.callData);
  return tx.wait();
}
