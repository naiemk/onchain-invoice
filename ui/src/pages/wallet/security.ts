import QRCode from "qrcode";
import { Contract, JsonRpcProvider } from "ethers";
import { t } from "../../i18n/t.js";
import {
  createPairing,
  deleteDevice,
  fetchWalletConfig,
  listDevices,
  pairingDeepLink,
  pairingQrPayload,
  pollPairing,
  primaryChain,
  registerDevice,
  waitForUserOp,
} from "../../shared/wallet-api.js";
import { loadWalletSession } from "../../shared/webauthn.js";
import {
  buildSignedAddOwnerUserOp,
  buildSignedRemoveOwnerUserOp,
  submitSignedUserOp,
} from "../../shared/userop-client.js";
import {
  addressBox,
  bindCopyButtons,
  setButtonLoading,
  shortKey,
  showStatus,
  walletSubnav,
} from "../../shared/wallet-ui.js";
import { escapeHtml } from "../../shared/dom.js";

const WALLET_ABI = [
  "function pendingOwner() view returns (bytes32 qx, bytes32 qy, uint64 executableAt, bytes32 requestId, bool active)",
];

export async function renderWalletSecurity(root: HTMLElement): Promise<void> {
  const session = loadWalletSession();
  if (!session) {
    location.href = "/wallet/create";
    return;
  }

  let devices: Awaited<ReturnType<typeof listDevices>> = [];
  let pendingRecovery = false;
  const config = await fetchWalletConfig();
  const chain = primaryChain(config);

  try {
    devices = await listDevices(session.address, session.chainId);
  } catch {
    devices = [];
  }

  if (chain.rpcUrl) {
    try {
      const provider = new JsonRpcProvider(chain.rpcUrl);
      const wallet = new Contract(session.address, WALLET_ABI, provider);
      pendingRecovery = (await wallet.pendingOwner()).active;
    } catch {
      pendingRecovery = false;
    }
  }

  root.innerHTML = `
    <header class="page-header wallet-page-header">
      <p class="eyebrow">${escapeHtml(t("wallet.eyebrow"))}</p>
      <h1>${escapeHtml(t("wallet.securityTab"))}</h1>
    </header>
    <section class="panel wallet-panel">
      ${walletSubnav("security")}
      ${addressBox(session.address)}
      ${pendingRecovery ? `<div class="banner warn">${escapeHtml(t("wallet.pendingRecovery"))}</div>` : ""}
      <h2>${escapeHtml(t("wallet.passkeys"))}</h2>
      <ul class="wallet-device-list">
        ${devices
          .map(
            (d) => `
          <li>
            <div>
              <strong>${escapeHtml(d.label)}</strong>
              <span class="mono faint">${escapeHtml(shortKey(d.ownerQx))}</span>
            </div>
            ${
              devices.length > 1
                ? `<button type="button" class="tc-btn secondary small" data-remove="${escapeHtml(d.ownerQx)}|${escapeHtml(d.ownerQy)}">${escapeHtml(t("wallet.remove"))}</button>`
                : ""
            }
          </li>`
          )
          .join("")}
      </ul>
      <div class="cta-row">
        <button type="button" class="tc-btn" id="add-device-qr">${escapeHtml(t("wallet.addDevice"))}</button>
      </div>
      <div id="pair-qr-box" class="wallet-qr-wrap hidden"></div>
      <h2>${escapeHtml(t("wallet.recoverySection"))}</h2>
      <p class="field-hint">${escapeHtml(t("wallet.recoveryHint"))}</p>
      <p class="field-hint">${escapeHtml(t("wallet.recoveryTimelock", { hours: Math.round(config.recoveryTimelockSeconds / 3600) }))}</p>
      <p id="security-status" class="status wallet-status" role="status"></p>
    </section>`;

  bindCopyButtons(root);

  root.querySelector("#add-device-qr")?.addEventListener("click", async () => {
    const box = root.querySelector<HTMLElement>("#pair-qr-box");
    const btn = root.querySelector<HTMLButtonElement>("#add-device-qr");
    if (!box) return;
    setButtonLoading(btn, true);
    try {
      const pairing = await createPairing(session.address, session.chainId);
      const payload = pairingQrPayload({
        walletAddress: session.address,
        chainId: session.chainId,
        nonce: pairing.pairing.nonce,
        rpId: window.location.hostname,
      });
      const deepLink = pairingDeepLink(payload);
      let qrDataUrl = "";
      try {
        qrDataUrl = await QRCode.toDataURL(deepLink, {
          margin: 1,
          width: 200,
          color: { dark: "#0a2540", light: "#ffffff" },
        });
      } catch {
        qrDataUrl = "";
      }
      const expiresAt = new Date(pairing.pairing.expiresAt).getTime();
      box.classList.remove("hidden");
      box.innerHTML = `
        <p class="field-hint">${escapeHtml(t("wallet.scanOnNewDevice"))}</p>
        ${qrDataUrl ? `<img class="wallet-qr-img" src="${qrDataUrl}" alt="${escapeHtml(t("wallet.qrAlt"))}" width="200" height="200" />` : ""}
        <div class="address-box wallet-address-box">
          <code class="mono wallet-pair-link">${escapeHtml(deepLink)}</code>
          <button type="button" class="tc-btn secondary small copy-btn" data-copy-text="${escapeHtml(deepLink)}">${escapeHtml(t("wallet.copy"))}</button>
        </div>
        <p class="field-hint"><span id="pair-countdown">${escapeHtml(t("wallet.pairingExpires"))}</span></p>
        <div id="pair-approve"></div>`;

      box.querySelectorAll<HTMLElement>("[data-copy-text]").forEach((copyBtn) => {
        copyBtn.addEventListener("click", () => {
          const text = copyBtn.dataset.copyText;
          if (text) void navigator.clipboard.writeText(text);
        });
      });

      const countdownEl = box.querySelector("#pair-countdown");
      const countdownTimer = setInterval(() => {
        const left = Math.max(0, Math.floor((expiresAt - Date.now()) / 1000));
        if (countdownEl) countdownEl.textContent = t("wallet.pairingCountdown", { seconds: left });
        if (left <= 0) clearInterval(countdownTimer);
      }, 1000);

      const approve = box.querySelector("#pair-approve");
      const interval = setInterval(async () => {
        const { pairing: p } = await pollPairing(pairing.pairing.nonce);
        if (p.status === "approved" && p.newOwnerQx && p.newOwnerQy) {
          clearInterval(interval);
          clearInterval(countdownTimer);
          approve!.innerHTML = `
            <p>${escapeHtml(t("wallet.approvePairing", { label: p.deviceLabel ?? "device" }))}</p>
            <button type="button" class="tc-btn" id="confirm-add-owner">${escapeHtml(t("wallet.confirmAddOwner"))}</button>`;
          approve!.querySelector("#confirm-add-owner")?.addEventListener("click", async () => {
            const status = root.querySelector<HTMLElement>("#security-status");
            try {
              showStatus(status, t("wallet.sendSigning"));
              const cfg = await fetchWalletConfig();
              const fee = BigInt(cfg.bundlerFeeUsdc || "0");
              const { userOp, userOpHash } = await buildSignedAddOwnerUserOp({
                config: cfg,
                walletAddress: session.address,
                qx: p.newOwnerQx!,
                qy: p.newOwnerQy!,
                feeAmount: fee,
                credentialId: session.credentialId,
              });
              await submitSignedUserOp({ config: cfg, userOp, userOpHash, walletAddress: session.address });
              const result = await waitForUserOp(userOpHash);
              if (result.status !== "included") throw new Error(result.rejectReason ?? result.status);
              await registerDevice({
                walletAddress: session.address,
                chainId: session.chainId,
                ownerQx: p.newOwnerQx!,
                ownerQy: p.newOwnerQy!,
                label: p.deviceLabel ?? "Device",
                credentialId: "",
              });
              await renderWalletSecurity(root);
            } catch (error) {
              showStatus(status, error instanceof Error ? error.message : String(error), "error");
            }
          });
        }
      }, 2000);
    } finally {
      setButtonLoading(btn, false);
    }
  });

  root.querySelectorAll("[data-remove]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const status = root.querySelector<HTMLElement>("#security-status");
      const [qx, qy] = (btn as HTMLElement).dataset.remove!.split("|");
      if (!window.confirm(t("wallet.removeConfirm"))) return;
      try {
        showStatus(status, t("wallet.sendSigning"));
        const cfg = await fetchWalletConfig();
        const fee = BigInt(cfg.bundlerFeeUsdc || "0");
        const { userOp, userOpHash } = await buildSignedRemoveOwnerUserOp({
          config: cfg,
          walletAddress: session.address,
          qx,
          qy,
          feeAmount: fee,
          credentialId: session.credentialId,
        });
        await submitSignedUserOp({ config: cfg, userOp, userOpHash, walletAddress: session.address });
        const result = await waitForUserOp(userOpHash);
        if (result.status !== "included") throw new Error(result.rejectReason ?? result.status);
        await deleteDevice(session.address, session.chainId, qx, qy);
        await renderWalletSecurity(root);
      } catch (error) {
        showStatus(status, error instanceof Error ? error.message : String(error), "error");
      }
    });
  });
}
