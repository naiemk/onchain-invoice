import { expect } from "chai";
import { keccak256, toUtf8Bytes } from "ethers";
import { TronWeb } from "tronweb";
import {
  deriveTronInvoiceAddress,
  prepareInvoiceResourcesForSweep,
  readTronTokenBalance,
  releaseInvoiceResourcesAfterSweep,
  sponsorBase58,
  sponsorTronWeb,
  sweepTrc20FromInvoice,
  tronNumericChainId,
} from "../src/index.js";

const NILE_CHAIN_ID = "nile";
const DEFAULT_NILE_HOST = "https://nile.trongrid.io";
const DEFAULT_NILE_USDT = "TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf";
const SWEEP_USDT = 100_300n; // 0.1003 USDT
const TRC20_ABI = [
  {
    inputs: [
      { name: "to", type: "address" },
      { name: "value", type: "uint256" },
    ],
    name: "transfer",
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "nonpayable",
    type: "function",
  },
] as const;

function operatorKey(): string | undefined {
  const raw = process.env.TRON_PRIVATE_KEY ?? process.env.TRON_SPONSOR_PRIVATE_KEY;
  return raw?.replace(/^0x/, "");
}

async function waitTx(tronWeb: TronWeb, txId: string, timeoutMs = 90_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const info = await tronWeb.trx.getTransactionInfo(txId);
    if (info?.id || info?.blockNumber || info?.receipt) return;
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error(`Timeout waiting for ${txId}`);
}

async function ensureStaked(
  tronWeb: TronWeb,
  owner: string,
  resource: "ENERGY" | "BANDWIDTH",
  minSun: number
): Promise<void> {
  const acct = await tronWeb.trx.getAccount(owner);
  const frozen = (acct.frozenV2 ?? []) as Array<{ type?: string; amount?: number | string }>;
  const entry = frozen.find((f) => (f.type ?? "") === resource);
  const have = Number(entry?.amount ?? 0);
  if (have >= minSun) return;

  const need = minSun - have;
  const balance = await tronWeb.trx.getBalance(owner);
  if (balance < need + 2_000_000) {
    throw new Error(`Need ~${need} sun liquid TRX to stake ${resource}; have ${balance}`);
  }
  const tx = await tronWeb.transactionBuilder.freezeBalanceV2(need, resource, owner);
  const signed = await tronWeb.trx.sign(tx);
  const result = await tronWeb.trx.sendRawTransaction(signed);
  if (!result.result) throw new Error(`freezeBalanceV2(${resource}) failed: ${JSON.stringify(result)}`);
  const txId = result.txid ?? result.transaction?.txID;
  if (txId) await waitTx(tronWeb, txId);
}

/**
 * Live Nile: stake → delegate ENERGY/BANDWIDTH → USDT sweep with 0 TRX on invoice.
 * Skips without TRON_PRIVATE_KEY.
 */
describe("TRON Nile delegate + USDT sweep (live)", function () {
  this.timeout(240_000);

  const pk = operatorKey();
  const fullHost = process.env.NILE_FULL_HOST ?? DEFAULT_NILE_HOST;
  const usdtAddress = process.env.TRON_USDT_ADDRESS ?? DEFAULT_NILE_USDT;

  before(function () {
    if (!pk) this.skip();
  });

  it("fails cleanly when sponsor has no stake to delegate", async function () {
    // Fresh random invoice; use a throwaway sponsor with no stake by attempting
    // delegate with amount larger than any available stake after checking resources.
    const sponsor = sponsorTronWeb({ fullHost, sponsorPrivateKey: pk!, energyMode: "staked" });
    const sponsorAddr = sponsorBase58(sponsor);
    const res = await sponsor.trx.getAccountResources(sponsorAddr);
    const energyLimit = Number(res.EnergyLimit ?? 0);

    // If this wallet already has energy from prior stakes, skip this negative case.
    if (energyLimit > 0) {
      this.skip();
    }

    const invoiceId = keccak256(toUtf8Bytes(`no-stake-${Date.now()}`));
    const invoiceAddress = deriveTronInvoiceAddress(pk!, tronNumericChainId(NILE_CHAIN_ID), invoiceId, fullHost);

    let failed = false;
    try {
      await prepareInvoiceResourcesForSweep(
        {
          fullHost,
          sponsorPrivateKey: pk!,
          energyMode: "staked",
          minDelegateEnergy: 65_000_000,
          minDelegateBandwidth: 1_500_000,
        },
        invoiceAddress
      );
    } catch (error) {
      failed = true;
      expect(String(error)).to.match(/delegateResource/i);
    }
    expect(failed).to.equal(true);
  });

  it("delegates resources and sweeps USDT without funding invoice TRX", async function () {
    const masterSecret = pk!;
    const invoiceId = keccak256(toUtf8Bytes(`delegate-sweep-${Date.now()}`));
    const numericId = tronNumericChainId(NILE_CHAIN_ID);
    const invoiceAddress = deriveTronInvoiceAddress(masterSecret, numericId, invoiceId, fullHost);

    const operator = new TronWeb({ fullHost, privateKey: masterSecret });
    const sponsorAddr = operator.defaultAddress.base58 as string;

    // Stake so delegation can succeed (idempotent if already staked enough).
    await ensureStaked(operator, sponsorAddr, "ENERGY", 65_000_000);
    await ensureStaked(operator, sponsorAddr, "BANDWIDTH", 1_500_000);

    // Fund invoice with USDT only — no TRX.
    const trc20 = await operator.contract(TRC20_ABI as never, usdtAddress);
    const payTx: string = await trc20.transfer(invoiceAddress, SWEEP_USDT.toString()).send({ feeLimit: 150_000_000 });
    await waitTx(operator, payTx);

    const invoiceTrxBeforePay = BigInt(await operator.trx.getBalance(invoiceAddress));
    // Before prepare: typically 0 TRX (USDT alone does not always create a usable account for DelegateResource).
    expect(invoiceTrxBeforePay).to.equal(0n);

    const invoiceUsdtBefore = await readTronTokenBalance(operator, invoiceAddress, usdtAddress);
    expect(invoiceUsdtBefore).to.equal(SWEEP_USDT);

    const sponsorConfig = {
      fullHost,
      sponsorPrivateKey: masterSecret,
      energyMode: "staked" as const,
      minDelegateEnergy: 65_000_000,
      minDelegateBandwidth: 1_500_000,
      feeLimit: 150_000_000,
    };

    const delegated = await prepareInvoiceResourcesForSweep(sponsorConfig, invoiceAddress);
    expect("mode" in delegated).to.equal(false);
    if ("mode" in delegated) throw new Error("expected delegate mode");
    expect(delegated.energyTxId || delegated.bandwidthTxId).to.be.ok;

    // Activation may leave 1 TRX; must not be the burn-mode 5 TRX top-up.
    const invoiceTrxAfterPrep = BigInt(await operator.trx.getBalance(invoiceAddress));
    expect(invoiceTrxAfterPrep).to.be.at.most(1_000_000n);

    const merchant = sponsorAddr;
    const sponsorUsdtBefore = await readTronTokenBalance(operator, merchant, usdtAddress);

    let sweepResult: { txId: string; amount: bigint; token: string };
    try {
      sweepResult = await sweepTrc20FromInvoice(
        sponsorConfig,
        masterSecret,
        numericId,
        invoiceId,
        invoiceAddress,
        usdtAddress,
        merchant
      );
    } finally {
      await releaseInvoiceResourcesAfterSweep(sponsorConfig, invoiceAddress, delegated);
    }

    expect(sweepResult.txId).to.match(/^[0-9a-fA-F]{64}$/);
    expect(sweepResult.amount).to.equal(SWEEP_USDT);
    await waitTx(operator, sweepResult.txId);

    // Activation dust may remain; energy was not paid by burning a 5 TRX top-up.
    const invoiceTrxAfter = BigInt(await operator.trx.getBalance(invoiceAddress));
    expect(invoiceTrxAfter).to.be.at.most(1_000_000n);

    const invoiceUsdtAfter = await readTronTokenBalance(operator, invoiceAddress, usdtAddress);
    const sponsorUsdtAfter = await readTronTokenBalance(operator, merchant, usdtAddress);
    expect(invoiceUsdtAfter).to.equal(0n);
    expect(sponsorUsdtAfter - sponsorUsdtBefore).to.equal(SWEEP_USDT);
  });
});
