import { getAddress, isAddress } from "ethers";
import { t } from "../../i18n/t.js";
import { loadWalletSession } from "../../shared/webauthn.js";
import { currentSpaRender, isSpaRenderCurrent, spaNavigate } from "../../shared/spa-render.js";
import {
  bindWalletAccountBar,
  setButtonLoading,
  showStatus,
  walletFrame,
  walletLoadingFrame,
} from "../../shared/wallet-ui.js";
import { escapeHtml } from "../../shared/dom.js";
import {
  createProposal,
  executeProposal,
  fetchAdvancedPolicy,
  getProposal,
  listProposals,
  prepareProposal,
  signProposal,
  listWalletEntities,
} from "../../shared/wallet-advanced-api.js";
import { fetchWalletConfig, waitForUserOp } from "../../shared/wallet-api.js";
import { signProposalUserOp } from "../../shared/advanced-userop-client.js";
import { encodeErc20Transfer, parseUsdcInput } from "../../../../commerce/shared/userop.js";
import { KEY_EOA } from "../../../../commerce/shared/advanced-wallet.js";
import { isAdvancedMode } from "../../shared/wallet-mode.js";
import { connectEoaWallet, getConnectedEoaAddress, initEoaConnector } from "../../shared/eoa-connector.js";

export async function renderWalletProposals(root: HTMLElement): Promise<void> {
  const gen = currentSpaRender();
  const session = loadWalletSession();
  if (!session) {
    spaNavigate("/wallet", "replace");
    return;
  }

  root.innerHTML = walletLoadingFrame("send", t("wallet.proposalsTitle"));
  bindWalletAccountBar(root);

  const config = await fetchWalletConfig();
  await initEoaConnector(config);
  const policy = await fetchAdvancedPolicy(session.address).catch(() => null);
  if (!isSpaRenderCurrent(gen)) return;

  if (!policy?.advanced) {
    spaNavigate("/wallet/super-wallet", "replace");
    return;
  }

  const proposals = await listProposals(session.address).catch(() => []);
  if (!isSpaRenderCurrent(gen)) return;

  const params = new URLSearchParams(location.search);
  const showCreate = params.get("create") === "1";

  root.innerHTML = walletFrame({
    current: "send",
    title: t("wallet.proposalsTitle"),
    lede: t("wallet.proposalsLede", { threshold: String(policy.threshold) }),
    body: `
      <section>
        <h2>${escapeHtml(t("wallet.proposalsInbox"))}</h2>
        ${
          proposals.length === 0
            ? `<p class="field-hint">${escapeHtml(t("wallet.proposalsEmpty"))}</p>`
            : `<ul class="wallet-device-list">
                ${proposals
                  .map(
                    (p) => `<li>
                      <div>
                        <strong>${escapeHtml(p.status)}</strong>
                        <span class="mono faint">${escapeHtml(shortAddr(p.target))}</span>
                      </div>
                      <button type="button" class="tc-btn secondary small" data-open="${escapeHtml(p.id)}">${escapeHtml(t("wallet.proposalsOpenOne"))}</button>
                    </li>`
                  )
                  .join("")}
              </ul>`
        }
      </section>
      ${
        showCreate
          ? `<section>
              <h2>${escapeHtml(t("wallet.proposalsCreateTitle"))}</h2>
              <div class="field">
                <label for="prop-recipient">${escapeHtml(t("wallet.sendRecipient"))}</label>
                <input id="prop-recipient" type="text" class="mono" placeholder="0x…" />
              </div>
              <div class="field">
                <label for="prop-amount">${escapeHtml(t("wallet.sendAmount"))}</label>
                <input id="prop-amount" type="text" inputmode="decimal" />
              </div>
              <button type="button" class="tc-btn" id="create-proposal">${escapeHtml(t("wallet.proposalsCreateCta"))}</button>
            </section>`
          : `<div class="cta-row">
              <a class="tc-btn secondary" href="/wallet/proposals?create=1" data-route>${escapeHtml(t("wallet.proposalsNew"))}</a>
            </div>`
      }
      <div id="proposal-detail" class="hidden"></div>
      <p id="proposal-status" class="status wallet-status" role="status"></p>`,
  });

  bindWalletAccountBar(root);

  root.querySelector("#create-proposal")?.addEventListener("click", async () => {
    const status = root.querySelector<HTMLElement>("#proposal-status");
    const recipient = (root.querySelector<HTMLInputElement>("#prop-recipient")?.value ?? "").trim();
    const amountRaw = (root.querySelector<HTMLInputElement>("#prop-amount")?.value ?? "").trim();
    if (!isAddress(recipient)) {
      showStatus(status, t("wallet.sendInvalidRecipient"), "error");
      return;
    }
    const chain = config.chains.find((c) => c.chainId === config.chainId)!;
    if (!chain.feeTokenAddress) {
      showStatus(status, t("wallet.sendNotDeployed"), "error");
      return;
    }
    try {
      const sendAmount = parseUsdcInput(amountRaw, config.feeTokenDecimals);
      const data = encodeErc20Transfer(getAddress(recipient), sendAmount);
      const proposal = await createProposal({
        walletAddress: session.address,
        chainId: config.chainId,
        target: chain.feeTokenAddress,
        value: "0",
        data,
      });
      spaNavigate(`/wallet/proposals?id=${proposal.id}`, "replace");
    } catch (error) {
      showStatus(status, error instanceof Error ? error.message : String(error), "error");
    }
  });

  root.querySelectorAll("[data-open]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = (btn as HTMLElement).dataset.open!;
      void openProposalDetail(root, session, config, id, policy.threshold);
    });
  });

  const openId = params.get("id");
  if (openId) {
    void openProposalDetail(root, session, config, openId, policy.threshold);
  }
}

async function openProposalDetail(
  root: HTMLElement,
  session: { address: string; qx: string; qy: string; credentialId?: string },
  config: Awaited<ReturnType<typeof fetchWalletConfig>>,
  proposalId: string,
  threshold: number
): Promise<void> {
  const detail = root.querySelector<HTMLElement>("#proposal-detail");
  const status = root.querySelector<HTMLElement>("#proposal-status");
  if (!detail) return;
  try {
    const { proposal, signatures } = await getProposal(session.address, proposalId);
    detail.classList.remove("hidden");
    detail.innerHTML = `
      <section>
        <h2>${escapeHtml(t("wallet.proposalsDetail"))}</h2>
        <p class="mono faint">${escapeHtml(proposal.target)} · ${escapeHtml(proposal.status)}</p>
        <p>${escapeHtml(t("wallet.proposalsSigCount", { count: String(signatures.length), threshold: String(threshold) }))}</p>
        <div class="cta-row">
          <button type="button" class="tc-btn secondary" id="sign-proposal">${escapeHtml(t("wallet.proposalsSign"))}</button>
          <button type="button" class="tc-btn" id="execute-proposal">${escapeHtml(t("wallet.proposalsExecute"))}</button>
        </div>
      </section>`;

    detail.querySelector("#sign-proposal")?.addEventListener("click", async () => {
      const btn = detail.querySelector<HTMLButtonElement>("#sign-proposal");
      setButtonLoading(btn, true);
      try {
        showStatus(status, t("wallet.sendSigning"));
        const roster = await listWalletEntities(session.address);
        let myKey =
          roster.keys.find((k) => k.qx === session.qx && k.qy === session.qy) ??
          null;
        if (!myKey) {
          const connected = await getConnectedEoaAddress();
          if (connected) {
            myKey = roster.keys.find(
              (k) => k.keyType === KEY_EOA && k.eoa?.toLowerCase() === connected.toLowerCase()
            ) ?? null;
          }
        }
        if (!myKey) {
          const connected = await connectEoaWallet().catch(() => null);
          if (connected) {
            myKey = roster.keys.find(
              (k) => k.keyType === KEY_EOA && k.eoa?.toLowerCase() === connected.toLowerCase()
            ) ?? null;
          }
        }
        if (!myKey) throw new Error(t("wallet.superWalletNoSigningKey"));
        const prepared = await prepareProposal(session.address, proposalId);
        const signature = await signProposalUserOp({
          userOpHash: prepared.userOpHash,
          entityId: myKey.entityId,
          keyType: myKey.keyType,
          qx: myKey.qx ?? undefined,
          qy: myKey.qy ?? undefined,
          eoa: myKey.eoa ?? undefined,
          credentialId: session.credentialId,
        });
        await signProposal({
          walletAddress: session.address,
          proposalId,
          entityId: myKey.entityId,
          keyId: myKey.keyId,
          keyType: myKey.keyType,
          signature,
        });
        showStatus(status, t("wallet.proposalsSigned"), "info");
        await openProposalDetail(root, session, config, proposalId, threshold);
      } catch (error) {
        showStatus(status, error instanceof Error ? error.message : String(error), "error");
      } finally {
        setButtonLoading(btn, false);
      }
    });

    detail.querySelector("#execute-proposal")?.addEventListener("click", async () => {
      const btn = detail.querySelector<HTMLButtonElement>("#execute-proposal");
      setButtonLoading(btn, true);
      try {
        showStatus(status, t("wallet.proposalsExecuting"));
        const { userOpHash } = await executeProposal(session.address, proposalId);
        const result = await waitForUserOp(userOpHash);
        if (result.status !== "included") throw new Error(result.rejectReason ?? result.status);
        showStatus(status, t("wallet.proposalsExecuted"), "info");
      } catch (error) {
        showStatus(status, error instanceof Error ? error.message : String(error), "error");
      } finally {
        setButtonLoading(btn, false);
      }
    });
  } catch (error) {
    showStatus(status, error instanceof Error ? error.message : String(error), "error");
  }
}

function shortAddr(addr: string): string {
  return `${addr.slice(0, 8)}…${addr.slice(-4)}`;
}
