import { getAddress, isAddress, parseUnits } from "ethers";
import {
  resolveProductAssetFromOnramperCryptoId,
  resolveEvmStableTokenAddress,
} from "../../../../commerce/shared/onramper-assets.js";
import { t } from "../../i18n/t.js";
import { escapeHtml } from "../../shared/dom.js";
import { currentSpaRender, isSpaRenderCurrent, spaNavigate } from "../../shared/spa-render.js";
import { loadWalletSession } from "../../shared/webauthn.js";
import {
  buildSignedSendUserOp,
  submitSignedUserOp,
} from "../../shared/userop-client.js";
import {
  confirmWalletOfframp,
  fetchWalletConfig,
  waitForUserOp,
} from "../../shared/wallet-api.js";
import {
  paintWalletLoading,
  paintWalletPage,
  setButtonLoading,
  showStatus,
  type WalletRenderOptions,
} from "../../shared/wallet-ui.js";

export async function renderWalletOfframpCashout(
  root: HTMLElement,
  opts?: WalletRenderOptions
): Promise<void> {
  const gen = currentSpaRender();
  const session = loadWalletSession();
  if (!session) {
    spaNavigate("/wallet", "replace");
    return;
  }

  const params = new URLSearchParams(location.search);
  const providerWalletAddress = params.get("providerWalletAddress")?.trim() ?? "";
  const inAmount = params.get("inAmount")?.trim() ?? "";
  const transactionId = params.get("transactionId")?.trim() ?? "";
  const sourceCurrency = params.get("sourceCurrency")?.trim() ?? "";
  const memoTag = params.get("providerWalletAddressTag")?.trim() ?? "";

  paintWalletLoading(root, "send", t("wallet.offrampCashoutTitle"), undefined, opts);

  if (memoTag) {
    paintWalletPage(
      root,
      {
        current: "send",
        title: t("wallet.offrampCashoutTitle"),
        body: `<p class="danger">${escapeHtml(t("wallet.offrampCashoutMemoUnsupported"))}</p>
        <p><a href="/wallet" data-route>${escapeHtml(t("wallet.goToWallet"))}</a></p>`,
      },
      opts
    );
    return;
  }

  if (!isAddress(providerWalletAddress) || !inAmount || !transactionId || !sourceCurrency) {
    paintWalletPage(
      root,
      {
        current: "send",
        title: t("wallet.offrampCashoutTitle"),
        body: `<p class="danger">${escapeHtml(t("wallet.offrampCashoutInvalid"))}</p>
        <p><a href="/wallet/withdraw" data-route>${escapeHtml(t("wallet.withdrawTitle"))}</a></p>`,
      },
      opts
    );
    return;
  }

  const mapped = resolveProductAssetFromOnramperCryptoId(sourceCurrency);
  if (!mapped) {
    paintWalletPage(
      root,
      {
        current: "send",
        title: t("wallet.offrampCashoutTitle"),
        body: `<p class="danger">${escapeHtml(t("wallet.offrampCashoutUnsupportedAsset", { asset: sourceCurrency }))}</p>
        <p><a href="/wallet" data-route>${escapeHtml(t("wallet.goToWallet"))}</a></p>`,
      },
      opts
    );
    return;
  }

  const config = await fetchWalletConfig();
  if (!isSpaRenderCurrent(gen)) return;

  const chain = config.chains.find((c) => c.chainId === mapped.chainId);
  const sendTokenAddress =
    chain?.stableTokens?.find((tok) => tok.symbol === mapped.token)?.address ??
    resolveEvmStableTokenAddress(mapped.chainId, mapped.token, {
      symbol: chain?.feeTokenSymbol ?? config.feeTokenSymbol,
      address: chain?.feeTokenAddress ?? config.feeTokenAddress,
    });

  if (!sendTokenAddress) {
    paintWalletPage(
      root,
      {
        current: "send",
        title: t("wallet.offrampCashoutTitle"),
        body: `<p class="danger">${escapeHtml(
          t("wallet.offrampCashoutUnsupportedAsset", { asset: `${mapped.token} (${mapped.chainId})` })
        )}</p>`,
      },
      opts
    );
    return;
  }

  const decimals = chain?.feeTokenDecimals ?? config.feeTokenDecimals;
  let sendAmount: bigint;
  try {
    sendAmount = parseUnits(inAmount, decimals);
  } catch {
    paintWalletPage(
      root,
      {
        current: "send",
        title: t("wallet.offrampCashoutTitle"),
        body: `<p class="danger">${escapeHtml(t("wallet.offrampCashoutInvalid"))}</p>`,
      },
      opts
    );
    return;
  }

  const feeAtoms = BigInt(config.bundlerFeeUsdc || "0");
  const recipient = getAddress(providerWalletAddress);

  paintWalletPage(
    root,
    {
      current: "send",
      title: t("wallet.offrampCashoutTitle"),
      lede: t("wallet.offrampCashoutLede"),
      body: `
      <dl class="wallet-fee-summary">
        <div><dt>${escapeHtml(t("wallet.offrampCashoutAmount"))}</dt><dd>${escapeHtml(inAmount)} ${escapeHtml(mapped.token)}</dd></div>
        <div><dt>${escapeHtml(t("wallet.offrampCashoutDestination"))}</dt><dd class="mono">${escapeHtml(recipient)}</dd></div>
        <div><dt>${escapeHtml(t("wallet.networkFee"))}</dt><dd>${escapeHtml(config.bundlerFeeUsd)}</dd></div>
      </dl>
      <button type="button" class="tc-btn" id="offramp-cashout-confirm">${escapeHtml(t("wallet.offrampCashoutConfirm"))}</button>
      <p id="offramp-cashout-status" class="status wallet-status" role="status"></p>
      <p class="field-hint"><a href="/wallet" data-route>${escapeHtml(t("wallet.goToWallet"))}</a></p>`,
    },
    opts,
    (r) => {
      r.querySelector("#offramp-cashout-confirm")?.addEventListener("click", () => {
        void runCashout(r, {
          session,
          config,
          recipient,
          sendAmount,
          feeAtoms,
          sendTokenAddress,
          chainId: mapped.chainId,
          transactionId,
          sourceCurrency,
        });
      });
    }
  );
}

async function runCashout(
  root: HTMLElement,
  input: {
    session: NonNullable<ReturnType<typeof loadWalletSession>>;
    config: Awaited<ReturnType<typeof fetchWalletConfig>>;
    recipient: string;
    sendAmount: bigint;
    feeAtoms: bigint;
    sendTokenAddress: string;
    chainId: string;
    transactionId: string;
    sourceCurrency: string;
  }
): Promise<void> {
  const status = root.querySelector<HTMLElement>("#offramp-cashout-status");
  const btn = root.querySelector<HTMLButtonElement>("#offramp-cashout-confirm");
  if (!status) return;

  try {
    setButtonLoading(btn, true, t("wallet.sendSigning"));
    showStatus(status, t("wallet.sendSigning"));
    const { userOp, userOpHash } = await buildSignedSendUserOp({
      config: input.config,
      walletAddress: input.session.address,
      recipient: input.recipient,
      sendAmount: input.sendAmount,
      feeAmount: input.feeAtoms,
      credentialId: input.session.credentialId,
      chainId: input.chainId,
      sendTokenAddress: input.sendTokenAddress,
    });
    showStatus(status, t("wallet.sendSubmitting"));
    await submitSignedUserOp({
      config: input.config,
      userOp,
      userOpHash,
      walletAddress: input.session.address,
      chainId: input.chainId,
    });
    showStatus(status, t("wallet.sendPending"));
    const result = await waitForUserOp(userOpHash);
    if (result.status !== "included" || !result.txHash) {
      showStatus(status, result.rejectReason ?? t("wallet.sendFailed"), "error");
      return;
    }
    showStatus(status, t("wallet.offrampCashoutConfirming"));
    await confirmWalletOfframp({
      walletAddress: input.session.address,
      transactionId: input.transactionId,
      transactionHash: result.txHash,
      targetAddress: input.recipient,
      sourceCurrency: input.sourceCurrency,
    });
    showStatus(status, t("wallet.offrampCashoutSuccess", { hash: result.txHash }), "success");
    if (btn) btn.disabled = true;
  } catch (error) {
    showStatus(status, error instanceof Error ? error.message : String(error), "error");
  } finally {
    setButtonLoading(btn, false);
  }
}
