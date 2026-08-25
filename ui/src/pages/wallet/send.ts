import { getAddress, isAddress } from "ethers";
import { t } from "../../i18n/t.js";
import {
  fetchWalletBalance,
  fetchWalletConfig,
  getWalletAccount,
  primaryChain,
  waitForUserOp,
} from "../../shared/wallet-api.js";
import { loadWalletSession } from "../../shared/webauthn.js";
import {
  buildSignedSendUserOp,
  submitSignedUserOp,
} from "../../shared/userop-client.js";
import { parseUsdcInput } from "../../../../commerce/shared/userop.js";
import {
  chainBalanceRows,
  setButtonLoading,
  showStatus,
  walletSubnav,
} from "../../shared/wallet-ui.js";
import { escapeHtml } from "../../shared/dom.js";

export async function renderWalletSend(root: HTMLElement): Promise<void> {
  const session = loadWalletSession();
  if (!session) {
    location.href = "/wallet/create";
    return;
  }

  const config = await fetchWalletConfig();
  const feeAtoms = BigInt(config.bundlerFeeUsdc || "0");
  let balance = { totalUsd: "0.00", chains: [] as Awaited<ReturnType<typeof fetchWalletBalance>>["chains"] };
  let deployedOnPrimary = false;

  try {
    balance = await fetchWalletBalance(session.address);
    const primary = balance.chains.find((c) => c.chainId === config.chainId);
    deployedOnPrimary = primary?.deployed ?? false;
  } catch {
    /* ignore */
  }

  const account = await getWalletAccount(session.address).catch(() => null);
  if (account && account.deployedChains.includes(config.chainId)) {
    deployedOnPrimary = true;
  }

  root.innerHTML = `
    <header class="page-header wallet-page-header">
      <p class="eyebrow">${escapeHtml(t("wallet.eyebrow"))}</p>
      <h1>${escapeHtml(t("wallet.sendTitle"))}</h1>
    </header>
    <section class="panel wallet-panel">
      ${walletSubnav("send")}
      <p class="wallet-balance-total">${escapeHtml(t("wallet.sendAvailable", { amount: balance.totalUsd, symbol: t("wallet.usd") }))}</p>
      ${chainBalanceRows(balance.chains)}
      ${
        !deployedOnPrimary
          ? `<div class="callout warn">${escapeHtml(t("wallet.sendNotDeployed"))}</div>`
          : ""
      }
      <div class="field">
        <label for="send-recipient">${escapeHtml(t("wallet.sendRecipient"))}</label>
        <input id="send-recipient" type="text" placeholder="0x…" class="mono" ${!deployedOnPrimary ? "disabled" : ""} />
      </div>
      <div class="field">
        <label for="send-amount">${escapeHtml(t("wallet.sendAmount"))}</label>
        <input id="send-amount" type="text" inputmode="decimal" placeholder="0.00" ${!deployedOnPrimary ? "disabled" : ""} />
      </div>
      <dl class="wallet-fee-summary">
        <div><dt>${escapeHtml(t("wallet.networkFee"))}</dt><dd>${escapeHtml(config.bundlerFeeUsd)}</dd></div>
        <div><dt>${escapeHtml(t("wallet.sendTotal"))}</dt><dd id="send-total">${escapeHtml(config.bundlerFeeUsd)}</dd></div>
      </dl>
      <button type="button" class="tc-btn" id="send-submit" ${!deployedOnPrimary ? "disabled" : ""}>${escapeHtml(t("wallet.sendConfirm"))}</button>
      <p id="send-status" class="status wallet-status" role="status"></p>
    </section>`;

  const chain = primaryChain(config);
  const primaryBalance = balance.chains.find((c) => c.chainId === config.chainId);
  const balanceAtoms = BigInt(primaryBalance?.balance ?? "0");

  const amountInput = root.querySelector<HTMLInputElement>("#send-amount");
  const totalEl = root.querySelector<HTMLElement>("#send-total");
  const updateTotal = (): void => {
    if (!amountInput || !totalEl) return;
    const parsed = parseUsdcInput(amountInput.value, chain.feeTokenDecimals);
    if (parsed === null) {
      totalEl.textContent = config.bundlerFeeUsd;
      return;
    }
    const total = parsed + feeAtoms;
    totalEl.textContent = `$${(Number(total) / 10 ** chain.feeTokenDecimals).toFixed(2)}`;
  };
  amountInput?.addEventListener("input", updateTotal);

  if (deployedOnPrimary) {
    root.querySelector("#send-submit")?.addEventListener("click", () =>
      void runSend(root, session, config, feeAtoms, balanceAtoms)
    );
  }
}

async function runSend(
  root: HTMLElement,
  session: NonNullable<ReturnType<typeof loadWalletSession>>,
  config: Awaited<ReturnType<typeof fetchWalletConfig>>,
  feeAtoms: bigint,
  balanceAtoms: bigint
): Promise<void> {
  const status = root.querySelector<HTMLElement>("#send-status");
  const btn = root.querySelector<HTMLButtonElement>("#send-submit");
  const recipientRaw = root.querySelector<HTMLInputElement>("#send-recipient")?.value.trim() ?? "";
  const amountRaw = root.querySelector<HTMLInputElement>("#send-amount")?.value.trim() ?? "";
  const chain = primaryChain(config);
  if (!status) return;

  if (!isAddress(recipientRaw)) {
    showStatus(status, t("wallet.sendInvalidRecipient"), "error");
    return;
  }
  const sendAmount = parseUsdcInput(amountRaw, chain.feeTokenDecimals);
  if (sendAmount === null || sendAmount <= 0n) {
    showStatus(status, t("wallet.sendInvalidAmount"), "error");
    return;
  }
  const total = sendAmount + feeAtoms;
  if (total > balanceAtoms) {
    showStatus(status, t("wallet.sendInsufficientBalance"), "error");
    return;
  }
  if (!config.feeTokenAddress || !config.bundlerBeneficiary) {
    showStatus(status, t("wallet.bundlerNotConfigured"), "error");
    return;
  }

  try {
    setButtonLoading(btn, true, t("wallet.sendSigning"));
    showStatus(status, t("wallet.sendSigning"));
    const { userOp, userOpHash } = await buildSignedSendUserOp({
      config,
      walletAddress: session.address,
      recipient: getAddress(recipientRaw),
      sendAmount,
      feeAmount: feeAtoms,
      credentialId: session.credentialId,
    });
    showStatus(status, t("wallet.sendSubmitting"));
    await submitSignedUserOp({ config, userOp, userOpHash, walletAddress: session.address });
    showStatus(status, t("wallet.sendPending"));
    const result = await waitForUserOp(userOpHash);
    if (result.status === "included") {
      showStatus(status, t("wallet.sendSuccess", { hash: result.txHash ?? userOpHash }), "success");
      return;
    }
    showStatus(status, result.rejectReason ?? t("wallet.sendFailed"), "error");
  } catch (error) {
    showStatus(status, error instanceof Error ? error.message : String(error), "error");
  } finally {
    setButtonLoading(btn, false);
  }
}
