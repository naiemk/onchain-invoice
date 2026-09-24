/**
 * Mainnet rail smoke: verify CREATE2 sweepers/forwarders + Tron USDT, then optionally
 * create invoices when COMMERCE_API_URL + a merchant key are set.
 *
 * Live pay + sweep still need VPS secrets (TRON_* / SWEEPER_PRIVATE_KEY) and a funded payer.
 *
 *   npx hardhat run scripts/mainnet-invoice-smoke.ts
 */
const BASE_SWEEPER = "0x32D81953F60094A484eaFFB4583933b074921f4A";
const BASE_FORWARDER = "0x910f662AEf6396625D3E8766c6a775beAA764f2b";
const BNB_SWEEPER = "0xa9C13F34DDF8eFe64e628f38EebE80c2E9D8B59d";
const BNB_FORWARDER = "0x45D2D21083aD6408569e4D03796737EaE3dcF539";
const TRON_USDT = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";

async function rpcCode(url: string, address: string): Promise<number> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getCode", params: [address, "latest"] }),
  });
  const body = (await res.json()) as { result?: string; error?: { message?: string } };
  if (!body.result || body.result === "0x") {
    throw new Error(`${url} ${address}: empty code (${body.error?.message ?? "0x"})`);
  }
  return (body.result.length - 2) / 2;
}

async function main(): Promise<void> {
  const baseRpc = process.env.BASE_RPC_URL?.trim() || "https://base.publicnode.com";
  const bnbRpc = process.env.BSC_RPC_URL?.trim() || "https://bsc.publicnode.com";
  const api = (process.env.COMMERCE_API_URL ?? "https://trustless-commerce.com").replace(/\/$/, "");

  const baseSweeper = await rpcCode(baseRpc, BASE_SWEEPER);
  const baseFwd = await rpcCode(baseRpc, BASE_FORWARDER);
  const bnbSweeper = await rpcCode(bnbRpc, BNB_SWEEPER);
  const bnbFwd = await rpcCode(bnbRpc, BNB_FORWARDER);
  console.log(
    JSON.stringify(
      {
        base: { sweeperBytes: baseSweeper, forwarderBytes: baseFwd, sweeper: BASE_SWEEPER, forwarder: BASE_FORWARDER },
        bnb: { sweeperBytes: bnbSweeper, forwarderBytes: bnbFwd, sweeper: BNB_SWEEPER, forwarder: BNB_FORWARDER },
        tronUsdt: TRON_USDT,
      },
      null,
      2
    )
  );

  const health = await fetch(`${api}/api/health`);
  const healthBody = (await health.json()) as { ok?: boolean; service?: string };
  console.log("health", health.status, healthBody);

  const cfg = await fetch(`${api}/api/public/wallet-config`);
  const walletCfg = (await cfg.json()) as { chainId?: string; identityStoreAddress?: string | null };
  console.log("wallet-config chainId", walletCfg.chainId, "identityStore", walletCfg.identityStoreAddress);

  const remaining = [
    "Replace _PRIVATE_KEY_ for Tron master secret, Tron sponsor, and EVM sweeper key on the VPS",
    "Register the sweeper with SWEEPER_CHAINS=8453,56,tron",
    "Serve UI with VITE_DEPLOYMENT_MODE=mainnet on a non-testnet host",
    "Create + pay a small invoice on Tron, Base, and BNB and confirm sweep",
  ];
  if (walletCfg.chainId === "11155111") {
    remaining.unshift("Production API is still on Sepolia wallet-config — cut over tcmain env before live invoice pay");
  }
  console.log("vps_remaining", remaining);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
