import { Html5Qrcode } from "html5-qrcode";
import { t } from "../../i18n/t.js";
import {
  parsePairingFromUrl,
  parsePairingQr,
  submitPairing,
} from "../../shared/wallet-api.js";
import { createPasskey } from "../../shared/webauthn.js";
import {
  setButtonLoading,
  showStatus,
  walletSubnav,
} from "../../shared/wallet-ui.js";
import { escapeHtml } from "../../shared/dom.js";

let scanner: Html5Qrcode | null = null;

export async function renderWalletPair(root: HTMLElement): Promise<void> {
  const prefilled = parsePairingFromUrl();

  root.innerHTML = `
    <header class="page-header wallet-page-header">
      <p class="eyebrow">${escapeHtml(t("wallet.eyebrow"))}</p>
      <h1>${escapeHtml(t("wallet.pairTitle"))}</h1>
      <p class="lede">${escapeHtml(t("wallet.pairLede"))}</p>
    </header>
    <section class="panel wallet-panel">
      ${walletSubnav("pair" as "home")}
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
      <p id="pair-status" class="status wallet-status" role="status"></p>
    </section>`;

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
    showStatus(status, t("wallet.pairWaiting"), "info");
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
