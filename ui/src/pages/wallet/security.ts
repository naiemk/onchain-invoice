import QRCode from "qrcode";
import { Contract, JsonRpcProvider } from "ethers";
import { t } from "../../i18n/t.js";
import {
  consumePairing,
  createPairing,
  deleteDevice,
  fetchWalletConfig,
  listDevices,
  pairingDeepLink,
  pairingQrPayload,
  pollPairing,
  primaryChain,
  registerDevice,
  rejectPairing,
  waitForUserOp,
} from "../../shared/wallet-api.js";
import { loadWalletSession } from "../../shared/webauthn.js";
import { currentSpaRender, isSpaRenderCurrent, spaNavigate } from "../../shared/spa-render.js";
import {
  buildSignedAddOwnerUserOp,
  buildSignedRemoveOwnerUserOp,
  submitSignedUserOp,
} from "../../shared/userop-client.js";
import {
  bindCopyButtons,
  bindWalletAccountBar,
  setButtonLoading,
  shortKey,
  showStatus,
  walletFrame,
  walletLoadingFrame,
} from "../../shared/wallet-ui.js";
import { escapeHtml } from "../../shared/dom.js";
import { fetchWalletEmail } from "../../shared/wallet-recovery-api.js";
import { fetchAdvancedPolicy } from "../../shared/wallet-advanced-api.js";
import { isAdvancedMode } from "../../shared/wallet-mode.js";

const WALLET_ABI = [
  "function pendingOwner() view returns (bytes32 qx, bytes32 qy, uint64 executableAt, bytes32 requestId, bool active)",
];

export async function renderWalletSecurity(root: HTMLElement): Promise<void> {
  const gen = currentSpaRender();
  const session = loadWalletSession();
  if (!session) {
    spaNavigate("/wallet", "replace");
    return;
  }

  root.innerHTML = walletLoadingFrame("security", t("wallet.devicesTab"), t("wallet.pairRequired"));
  bindWalletAccountBar(root);

  let devices: Awaited<ReturnType<typeof listDevices>> = [];
  let pendingRecovery = false;
  let onChainAdvanced = false;
  const config = await fetchWalletConfig();
  if (!isSpaRenderCurrent(gen)) return;
  const chain = primaryChain(config);

  if (chain.rpcUrl) {
    try {
      const provider = new JsonRpcProvider(chain.rpcUrl);
      const wallet = new Contract(session.address, WALLET_ABI, provider);
      pendingRecovery = (await wallet.pendingOwner()).active;
    } catch {
      pendingRecovery = false;
    }
    try {
      const policy = await fetchAdvancedPolicy(session.address);
      onChainAdvanced = policy.advanced;
      if (onChainAdvanced) pendingRecovery = false;
    } catch {
      onChainAdvanced = false;
    }
  }
  if (!isSpaRenderCurrent(gen)) return;

  try {
    devices = await listDevices(session.address, session.chainId);
  } catch {
    devices = [];
  }
  if (!isSpaRenderCurrent(gen)) return;

  const current =
    devices.find((d) => d.credentialId && d.credentialId === session.credentialId) ??
    devices.find((d) => d.ownerQx === session.qx && d.ownerQy === session.qy) ??
    null;
  const others = devices.filter((d) => d !== current);

  root.innerHTML = walletFrame({
    current: "security",
    title: t("wallet.devicesTab"),
    lede: t("wallet.pairRequired"),
    body: `
      ${
        pendingRecovery
          ? `<div class="banner warn">
              <p>${escapeHtml(t("wallet.pendingRecovery"))}</p>
              <div class="cta-row">
                <a class="tc-btn secondary small" href="/wallet/recover" data-route>${escapeHtml(t("wallet.recoverOpen"))}</a>
              </div>
            </div>`
          : ""
      }

      <article class="wallet-device-callout">
        <div class="wallet-device-callout-head">
          <h2>${escapeHtml(t("wallet.thisDeviceTitle"))}</h2>
          <span class="wallet-device-badge">${escapeHtml(t("wallet.thisDeviceBadge"))}</span>
        </div>
        <p>${escapeHtml(t("wallet.thisDeviceBody"))}</p>
        <p><strong>${escapeHtml(current?.label ?? session.label)}</strong>
          <span class="mono faint"> · ${escapeHtml(shortKey(session.qx))}</span>
        </p>
      </article>

      <section class="wallet-other-devices">
        <h2>${escapeHtml(t("wallet.otherDevicesTitle"))}</h2>
        ${
          others.length === 0
            ? `<p class="field-hint">${escapeHtml(t("wallet.otherDevicesEmpty"))}</p>`
            : `<ul class="wallet-device-list">
                ${others
                  .map(
                    (d) => `
                  <li>
                    <div>
                      <strong>${escapeHtml(d.label)}</strong>
                      <span class="mono faint">${escapeHtml(shortKey(d.ownerQx))}</span>
                    </div>
                    <button type="button" class="tc-btn secondary small" data-remove="${escapeHtml(d.ownerQx)}|${escapeHtml(d.ownerQy)}">${escapeHtml(t("wallet.remove"))}</button>
                  </li>`
                  )
                  .join("")}
              </ul>`
        }

        <div class="wallet-pair-howto">
          <h3>${escapeHtml(t("wallet.pairStepsTitle"))}</h3>
          <ol class="wallet-pair-steps">
            <li>${escapeHtml(t("wallet.pairStep1"))}</li>
            <li>${escapeHtml(t("wallet.pairStep2"))}</li>
            <li>${escapeHtml(t("wallet.pairStep3"))}</li>
          </ol>
          <button type="button" class="tc-btn" id="add-device-qr">${escapeHtml(t("wallet.addDevice"))}</button>
        </div>
        <div id="pair-qr-box" class="wallet-qr-wrap hidden"></div>
      </section>

      <section class="wallet-recovery-section ${onChainAdvanced ? "hidden" : ""}">
        <h2>${escapeHtml(t("wallet.recoverySection"))}</h2>
        <p class="field-hint" id="security-email-status">${escapeHtml(t("wallet.recoverEmailLoading"))}</p>
        <p class="field-hint">${escapeHtml(t("wallet.recoveryTimelock", { hours: Math.round(config.recoveryTimelockSeconds / 3600) }))}</p>
        <div class="cta-row">
          <a class="tc-btn" href="/wallet/recover" data-route>${escapeHtml(t("wallet.recoverOpen"))}</a>
          ${
            pendingRecovery
              ? `<button type="button" class="tc-btn secondary" id="security-cancel-recovery">${escapeHtml(t("wallet.recoverCancel"))}</button>`
              : ""
          }
        </div>
      </section>
      ${
        isAdvancedMode()
          ? `<section class="wallet-super-section">
              <h2>${escapeHtml(t("wallet.superWalletTitle"))}</h2>
              <p class="field-hint">${escapeHtml(onChainAdvanced ? t("wallet.superWalletActiveShort") : t("wallet.superWalletUpgradeShort"))}</p>
              <div class="cta-row">
                <a class="tc-btn${onChainAdvanced ? " secondary" : ""}" href="/wallet/super-wallet" data-route>${escapeHtml(onChainAdvanced ? t("wallet.superWalletManage") : t("wallet.superWalletConvertCta"))}</a>
              </div>
            </section>`
          : ""
      }
      <p id="security-status" class="status wallet-status" role="status"></p>`,
  });

  bindWalletAccountBar(root);
  bindCopyButtons(root);

  void (async () => {
    const el = root.querySelector<HTMLElement>("#security-email-status");
    if (!el || onChainAdvanced) return;
    try {
      const email = await fetchWalletEmail(session.address);
      if (email.verified && email.email) {
        el.textContent = t("wallet.recoverEmailVerified", { email: email.email });
      } else if (email.hasEmail && email.email) {
        el.textContent = t("wallet.recoverEmailPending", { email: email.email });
      } else {
        el.textContent = t("wallet.recoverEmailNone");
      }
    } catch {
      el.textContent = t("wallet.recoverEmailNone");
    }
  })();

  root.querySelector("#security-cancel-recovery")?.addEventListener("click", () => {
    spaNavigate("/wallet/recover");
  });

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
      const nonce = pairing.pairing.nonce;
      box.classList.remove("hidden");
      box.innerHTML = `
        <p class="field-hint">${escapeHtml(t("wallet.scanOnNewDevice"))}</p>
        ${qrDataUrl ? `<img class="wallet-qr-img" src="${qrDataUrl}" alt="${escapeHtml(t("wallet.qrAlt"))}" width="200" height="200" />` : ""}
        <div class="address-box wallet-address-box">
          <code class="mono wallet-pair-link">${escapeHtml(deepLink)}</code>
          <button type="button" class="tc-btn secondary small copy-btn" data-copy-text="${escapeHtml(deepLink)}">${escapeHtml(t("wallet.copy"))}</button>
        </div>
        <p class="field-hint"><span id="pair-countdown">${escapeHtml(t("wallet.pairingExpires"))}</span></p>
        <div class="cta-row" id="pair-reject-row">
          <button type="button" class="tc-btn secondary" id="pair-reject">${escapeHtml(t("wallet.pairReject"))}</button>
        </div>
        <div id="pair-approve"></div>`;

      bindCopyButtons(box);

      let closed = false;
      let countdownTimer: ReturnType<typeof setInterval> | undefined;
      let interval: ReturnType<typeof setInterval> | undefined;
      const stopPairingUi = async (message: string, kind: "error" | "info" = "error") => {
        if (closed) return;
        closed = true;
        if (interval != null) clearInterval(interval);
        if (countdownTimer != null) clearInterval(countdownTimer);
        const status = root.querySelector<HTMLElement>("#security-status");
        showStatus(status, message, kind);
        box.innerHTML = "";
        box.classList.add("hidden");
      };

      box.querySelector("#pair-reject")?.addEventListener("click", () => {
        void (async () => {
          try {
            await rejectPairing(nonce);
          } catch {
            /* ignore */
          }
          await stopPairingUi(t("wallet.pairRejected"), "info");
        })();
      });

      const countdownEl = box.querySelector("#pair-countdown");
      countdownTimer = setInterval(() => {
        const left = Math.max(0, Math.floor((expiresAt - Date.now()) / 1000));
        if (countdownEl) countdownEl.textContent = t("wallet.pairingCountdown", { seconds: left });
        if (left <= 0) {
          void (async () => {
            try {
              await rejectPairing(nonce);
            } catch {
              /* ignore */
            }
            await stopPairingUi(t("wallet.pairExpired"));
          })();
        }
      }, 1000);

      const approve = box.querySelector("#pair-approve");
      interval = setInterval(async () => {
        if (closed) return;
        try {
          const { pairing: p } = await pollPairing(nonce);
          if (p.status === "expired") {
            await stopPairingUi(t("wallet.pairExpired"));
            return;
          }
          if (p.status === "consumed") {
            await stopPairingUi(t("wallet.pairConsumed"), "info");
            await renderWalletSecurity(root);
            return;
          }
          if (p.status === "approved" && p.newOwnerQx && p.newOwnerQy && approve && !approve.dataset.armed) {
            approve.dataset.armed = "1";
            if (countdownTimer != null) clearInterval(countdownTimer);
            approve.innerHTML = `
              <p>${escapeHtml(t("wallet.approvePairing", { label: p.deviceLabel ?? "device" }))}</p>
              <div class="cta-row">
                <button type="button" class="tc-btn" id="confirm-add-owner">${escapeHtml(t("wallet.confirmAddOwner"))}</button>
                <button type="button" class="tc-btn secondary" id="pair-reject-confirm">${escapeHtml(t("wallet.pairReject"))}</button>
              </div>`;
            box.querySelector("#pair-reject-row")?.remove();
            approve.querySelector("#pair-reject-confirm")?.addEventListener("click", () => {
              void (async () => {
                try {
                  await rejectPairing(nonce);
                } catch {
                  /* ignore */
                }
                await stopPairingUi(t("wallet.pairRejected"), "info");
              })();
            });
            approve.querySelector("#confirm-add-owner")?.addEventListener("click", async () => {
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
                await consumePairing(nonce);
                await registerDevice({
                  walletAddress: session.address,
                  chainId: session.chainId,
                  ownerQx: p.newOwnerQx!,
                  ownerQy: p.newOwnerQy!,
                  label: p.deviceLabel ?? "Device",
                  credentialId: null,
                });
                closed = true;
                if (interval != null) clearInterval(interval);
                await renderWalletSecurity(root);
              } catch (error) {
                showStatus(status, error instanceof Error ? error.message : String(error), "error");
              }
            });
          }
        } catch {
          /* keep polling */
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
