import { Contract, JsonRpcProvider, getAddress, isAddress } from "ethers";
import { t } from "../../i18n/t.js";
import { fetchWalletConfig, waitForUserOp } from "../../shared/wallet-api.js";
import { loadWalletSession } from "../../shared/webauthn.js";
import {
  buildSignedSendUserOp,
  submitSignedUserOp,
} from "../../shared/userop-client.js";
import { ERC20_ABI, formatUsdFromUsdc, parseUsdcInput } from "../../../../commerce/shared/userop.js";

export async function renderWalletSend(root: HTMLElement): Promise<void> {
  const session = loadWalletSession();
  if (!session) {
    location.href = "/wallet/create";
    return;
  }

  const config = await fetchWalletConfig();
  const feeAtoms = BigInt(config.bundlerFeeUsdc || "0");
  let balanceAtoms = 0n;

  if (config.rpcUrl && config.feeTokenAddress) {
    try {
      const provider = new JsonRpcProvider(config.rpcUrl);
      const token = new Contract(config.feeTokenAddress, ERC20_ABI, provider);
      balanceAtoms = BigInt(await token.balanceOf(session.address));
    } catch {
      balanceAtoms = 0n;
    }
  }

  root.innerHTML = `
    <section class="panel wallet-panel">
      <nav class="wallet-subnav">
        <a href="/wallet" data-route>${t("wallet.homeTitle")}</a>
        <span aria-current="page">${t("wallet.sendTitle")}</span>
      </nav>
      <h1>${t("wallet.sendTitle")}</h1>
      <p class="hint">${t("wallet.sendAvailable", {
        amount: formatUsdFromUsdc(balanceAtoms, config.feeTokenDecimals),
        symbol: config.feeTokenSymbol,
      })}</p>
      <label>${t("wallet.sendRecipient")}
        <input id="send-recipient" type="text" placeholder="0x…" />
      </label>
      <label>${t("wallet.sendAmount")}
        <input id="send-amount" type="text" inputmode="decimal" placeholder="0.00" />
      </label>
      <dl class="wallet-fee-summary">
        <div><dt>${t("wallet.networkFee")}</dt><dd>${config.bundlerFeeUsd}</dd></div>
        <div><dt>${t("wallet.sendTotal")}</dt><dd id="send-total">${config.bundlerFeeUsd}</dd></div>
      </dl>
      <button type="button" class="tc-btn" id="send-submit">${t("wallet.sendConfirm")}</button>
      <p id="send-status" class="hint" role="status"></p>
    </section>`;

  const amountInput = root.querySelector<HTMLInputElement>("#send-amount");
  const totalEl = root.querySelector<HTMLElement>("#send-total");
  const updateTotal = (): void => {
    if (!amountInput || !totalEl) return;
    const parsed = parseUsdcInput(amountInput.value, config.feeTokenDecimals);
    if (parsed === null) {
      totalEl.textContent = config.bundlerFeeUsd;
      return;
    }
    totalEl.textContent = formatUsdFromUsdc(parsed + feeAtoms, config.feeTokenDecimals);
  };
  amountInput?.addEventListener("input", updateTotal);

  root.querySelector("#send-submit")?.addEventListener("click", () =>
    void runSend(root, session, config, feeAtoms, balanceAtoms)
  );
}

async function runSend(
  root: HTMLElement,
  session: ReturnType<typeof loadWalletSession> & object,
  config: Awaited<ReturnType<typeof fetchWalletConfig>>,
  feeAtoms: bigint,
  balanceAtoms: bigint
): Promise<void> {
  const status = root.querySelector<HTMLElement>("#send-status");
  const recipientRaw = root.querySelector<HTMLInputElement>("#send-recipient")?.value.trim() ?? "";
  const amountRaw = root.querySelector<HTMLInputElement>("#send-amount")?.value.trim() ?? "";
  if (!status) return;

  if (!isAddress(recipientRaw)) {
    status.textContent = t("wallet.sendInvalidRecipient");
    return;
  }
  const sendAmount = parseUsdcInput(amountRaw, config.feeTokenDecimals);
  if (sendAmount === null || sendAmount <= 0n) {
    status.textContent = t("wallet.sendInvalidAmount");
    return;
  }
  const total = sendAmount + feeAtoms;
  if (total > balanceAtoms) {
    status.textContent = t("wallet.sendInsufficientBalance");
    return;
  }
  if (!config.feeTokenAddress || !config.bundlerBeneficiary) {
    status.textContent = t("wallet.bundlerNotConfigured");
    return;
  }

  try {
    status.textContent = t("wallet.sendSigning");
    const { userOp, userOpHash } = await buildSignedSendUserOp({
      config,
      walletAddress: session.address,
      recipient: getAddress(recipientRaw),
      sendAmount,
      feeAmount: feeAtoms,
      credentialId: session.credentialId,
    });
    status.textContent = t("wallet.sendSubmitting");
    await submitSignedUserOp({ config, userOp, userOpHash, walletAddress: session.address });
    status.textContent = t("wallet.sendPending");
    const result = await waitForUserOp(userOpHash);
    if (result.status === "included") {
      status.textContent = t("wallet.sendSuccess", { hash: result.txHash ?? userOpHash });
      return;
    }
    status.textContent = result.rejectReason ?? t("wallet.sendFailed");
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : String(error);
  }
}
