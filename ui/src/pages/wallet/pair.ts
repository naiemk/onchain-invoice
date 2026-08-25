import { Html5Qrcode } from "html5-qrcode";
import { t } from "../../i18n/t.js";
import {
  getWalletAccount,
  parsePairingFromUrl,
  parsePairingQr,
  pollPairing,
  registerDevice,
  submitPairing,
} from "../../shared/wallet-api.js";
import { createPasskey, saveWalletSession } from "../../shared/webauthn.js";
import {
  bindWalletAccountBar,
  setButtonLoading,
  showStatus,
  walletFrame,
} from "../../shared/wallet-ui.js";
import { escapeHtml } from "../../shared/dom.js";

let scanner: Html5Qrcode | null = null;

export async function renderWalletPair(root: HTMLElement): Promise<void> {
  const prefilled = parsePairingFromUrl();

  root.innerHTML = walletFrame({
    current: "pair",
    title: t("wallet.pairTitle"),
    lede: t("wallet.pairLede"),
    body: `
      <ol class="wallet-stepper">
        <li class="is-active">${escapeHtml(t("wallet.stepScan"))}</li>
        <li>${escapeHtml(t("wallet.stepPasskey"))}</li>
        <li>${escapeHtml(t("wallet.stepApprove"))}</li>
      </ol>
      <div id="qr-reader" class="wallet-scanner"></div>
      <div class="field">
        <label for="pair-payload">${escapeHtml(t("wallet.pairPayload"))}</label>
        <p class="field-hint">${escapeHtml(t("wallet.pairPayloadHint"))}</p>
        <textarea id="pair-payload" rows="4" class="mono">${prefilled ? escapeHtml(prefilled) : ""}</textarea>
      </div>
      <div class="field">
        <label for="pair-device-name">${escapeHtml(t("wallet.deviceName"))}</label>
        <input id="pair-device-name" type="text" placeholder="${escapeHtml(t("wallet.deviceNamePlaceholder"))}" />
      </div>
      <div class="cta-row">
        <button type="button" class="tc-btn" id="pair-submit">${escapeHtml(t("wallet.pairSubmit"))}</button>
        <a class="tc-btn secondary" href="/wallet" data-route>${escapeHtml(t("wallet.cancel"))}</a>
      </div>
      <p id="pair-status" class="status wallet-status" role="status"></p>`,
  });
  bindWalletAccountBar(root);

  void startScanner(root);

  root.querySelector("#pair-submit")?.addEventListener("click", () => void runPair(root));

  if (prefilled) {
    const status = root.querySelector<HTMLElement>("#pair-status");
    showStatus(status, t("wallet.payloadFromLink"), "info");
  }
}

async function startScanner(root: HTMLElement): Promise<void> {
  const readerId = "qr-reader";
  try {
    scanner = new Html5Qrcode(readerId);
    await scanner.start(
      { facingMode: "environment" },
      { fps: 8, qrbox: { width: 220, height: 220 } },
      (decoded) => {
        const textarea = root.querySelector<HTMLTextAreaElement>("#pair-payload");
        if (textarea) {
          try {
            const url = new URL(decoded);
            const payloadParam = url.searchParams.get("payload");
            if (payloadParam) {
              const padded = payloadParam.replace(/-/g, "+").replace(/_/g, "/");
              const pad = padded.length % 4 === 0 ? padded : padded + "=".repeat(4 - (padded.length % 4));
              textarea.value = atob(pad);
            } else if (decoded.startsWith("{")) {
              textarea.value = decoded;
            }
          } catch {
            if (decoded.startsWith("{")) {
              textarea!.value = decoded;
            }
          }
        }
        void scanner?.stop().catch(() => undefined);
        scanner = null;
      },
      () => undefined
    );
  } catch {
    const el = root.querySelector(`#${readerId}`);
    if (el) el.innerHTML = `<p class="field-hint">${escapeHtml(t("wallet.scannerUnavailable"))}</p>`;
  }
}

async function runPair(root: HTMLElement): Promise<void> {
  const status = root.querySelector<HTMLElement>("#pair-status");
  const btn = root.querySelector<HTMLButtonElement>("#pair-submit");
  const raw = root.querySelector<HTMLTextAreaElement>("#pair-payload")?.value.trim();
  const label = root.querySelector<HTMLInputElement>("#pair-device-name")?.value.trim() || t("wallet.defaultDevice");
  if (!raw || !status) return;
  try {
    setButtonLoading(btn, true, t("wallet.creatingPasskey"));
    showStatus(status, t("wallet.creatingPasskey"));
    const payload = parsePairingQr(raw);
    const owner = await createPasskey(label);
    await submitPairing({
      nonce: payload.nonce,
      newOwnerQx: owner.qx,
      newOwnerQy: owner.qy,
      deviceLabel: label,
    });

    const account = await getWalletAccount(payload.walletAddress);
    if (!account) throw new Error(t("wallet.unlockNotFound"));

    await registerDevice({
      walletAddress: payload.walletAddress,
      chainId: payload.chainId,
      ownerQx: owner.qx,
      ownerQy: owner.qy,
      label,
      credentialId: owner.credentialId,
    });

    saveWalletSession({
      address: account.address,
      chainId: payload.chainId,
      salt: account.salt,
      qx: owner.qx,
      qy: owner.qy,
      credentialId: owner.credentialId,
      rawId: owner.rawId,
      label,
    });

    showStatus(status, t("wallet.pairWaiting"), "info");
    const deadline = Date.now() + 5 * 60 * 1000;
    while (Date.now() < deadline) {
      const { pairing } = await pollPairing(payload.nonce);
      if (pairing.status === "approved" || pairing.status === "consumed") {
        location.href = "/wallet";
        return;
      }
      if (pairing.status === "expired") throw new Error(t("wallet.signInFailed"));
      await new Promise((r) => setTimeout(r, 2000));
    }
    location.href = "/wallet";
  } catch (error) {
    showStatus(status, error instanceof Error ? error.message : String(error), "error");
  } finally {
    setButtonLoading(btn, false);
  }
}

export async function stopPairScanner(): Promise<void> {
  if (scanner) {
    await scanner.stop().catch(() => undefined);
    scanner = null;
  }
}
