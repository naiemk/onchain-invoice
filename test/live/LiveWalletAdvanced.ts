/**
 * Live Sepolia smoke for Super Wallet advanced API + on-chain policy reads.
 *
 *   LIVE_WALLET_TESTNET=1 npx hardhat test test/live/LiveWalletAdvanced.ts
 *
 * Optional: LIVE_WALLET_TESTNET_API_URL (defaults to testnet.trustless-commerce.com)
 */
import { expect } from "chai";
import { getAddress } from "ethers";

const API_BASE = (process.env.LIVE_WALLET_TESTNET_API_URL ?? "https://testnet.trustless-commerce.com").replace(
  /\/$/,
  ""
);
const EXPECTED_FACTORY = (
  process.env.WALLET_FACTORY_ADDRESS ?? "0x06964dE197ed29A4DC2D34F68aD4510Afa25f537"
).toLowerCase();
const QX = "0x" + "aa".repeat(32);
const QY = "0x" + "bb".repeat(32);
const FEE_TOKEN = "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238";

function liveEnabled(): boolean {
  return process.env.LIVE_WALLET_TESTNET === "1" || process.env.LIVE_WALLET_TESTNET === "true";
}

describe("Live wallet advanced (Sepolia testnet)", function () {
  before(function () {
    if (!liveEnabled()) {
      this.skip();
    }
    this.timeout(120_000);
  });

  it("wallet-config exposes advanced ABI and expected factory", async function () {
    const res = await fetch(`${API_BASE}/api/public/wallet-config`);
    expect(res.status).to.equal(200);
    const body = (await res.json()) as {
      factoryAddress: string | null;
      advancedWalletAbi?: string[];
    };
    expect(body.factoryAddress?.toLowerCase()).to.equal(EXPECTED_FACTORY);
    expect(body.advancedWalletAbi?.length).to.be.greaterThan(0);
  });

  it("registers counterfactual account and advanced proposal draft", async function () {
    const create = await fetch(`${API_BASE}/api/wallet/accounts`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ownerQx: QX,
        ownerQy: QY,
        credentialId: `live-advanced-${Date.now()}`,
      }),
    });
    expect(create.status).to.equal(201);
    const { account } = (await create.json()) as { account: { address: string } };
    const wallet = getAddress(account.address);

    const policyRes = await fetch(`${API_BASE}/api/wallet/${wallet}/advanced-policy`);
    expect([200, 400, 503]).to.include(policyRes.status);

    const entityId = "0x" + "cc".repeat(32);
    const entityRes = await fetch(`${API_BASE}/api/wallet/${wallet}/entities`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ entityId, label: "live-smoke" }),
    });
    expect(entityRes.status).to.equal(200);

    const proposalRes = await fetch(`${API_BASE}/api/wallet/${wallet}/proposals`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chainId: "11155111",
        target: FEE_TOKEN,
        value: "0",
        data: "0x",
      }),
    });
    expect(proposalRes.status).to.equal(201);
    const { proposal } = (await proposalRes.json()) as { proposal: { id: string; status: string } };
    expect(proposal.status).to.equal("draft");

    const listRes = await fetch(`${API_BASE}/api/wallet/${wallet}/proposals`);
    expect(listRes.status).to.equal(200);
    const listed = (await listRes.json()) as { proposals: Array<{ id: string }> };
    expect(listed.proposals.some((p) => p.id === proposal.id)).to.equal(true);
  });
});
