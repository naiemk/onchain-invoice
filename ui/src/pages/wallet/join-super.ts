import { getAddress, zeroPadValue } from "ethers";
import { t } from "../../i18n/t.js";
import {
  createPasskey,
  createSecurityKey,
  isYubiKeyPinRequiredError,
} from "../../shared/webauthn.js";
import { saveMemberWalletSession } from "../../shared/wallet-session.js";
import { spaNavigate } from "../../shared/spa-render.js";
import {
  bindWalletAccountBar,
  renderYubiKeyPinRequiredPanel,
  setButtonLoading,
  showStatus,
  walletFrame,
} from "../../shared/wallet-ui.js";
import { escapeHtml } from "../../shared/dom.js";
import {
  fetchWalletConfig,
  parseSuperJoinFromUrl,
} from "../../shared/wallet-api.js";
import {
  createKeyEnrollmentRequest,
  fetchAdvancedPolicy,
  getKeyEnrollmentRequest,
  listWalletEntities,
} from "../../shared/wallet-advanced-api.js";
import {
  computeKeyId,
  hashEntityEmail,
  KEY_EOA,
  KEY_WEBAUTHN,
  KEY_YUBIKEY,
} from "../../../../commerce/shared/advanced-wallet.js";
import { connectEoaWallet, initEoaConnector } from "../../shared/eoa-connector.js";
import { passkeyToKeyFields } from "../../shared/advanced-userop-client.js";

const POLL_MS = 2500;

export async function renderWalletJoinSuper(root: HTMLElement): Promise<void> {
  const join = parseSuperJoinFromUrl();
  if (!join) {
    spaNavigate("/wallet", "replace");
    return;
  }

  let walletAddress: string;
  try {
    walletAddress = getAddress(join.walletAddress);
  } catch {
    spaNavigate("/wallet", "replace");
    return;
  }

  const config = await fetchWalletConfig();
  await initEoaConnector(config);
  const policy = await fetchAdvancedPolicy(walletAddress).catch(() => null);
  if (!policy?.advanced) {
    root.innerHTML = walletFrame({
      current: "pair",
      title: t("wallet.joinSuperTitle"),
      lede: t("wallet.joinSuperNotAdvanced"),
      body: `<p class="field-hint">${escapeHtml(t("wallet.joinSuperNotAdvancedHint"))}</p>`,
    });
    return;
  }

  root.innerHTML = walletFrame({
    current: "pair",
    title: t("wallet.joinSuperTitle"),
    lede: t("wallet.joinSuperLede"),
    body: `
      <p class="field-hint mono faint">${escapeHtml(walletAddress)}</p>
      <div class="field">
        <label for="join-email">${escapeHtml(t("wallet.joinSuperEmail"))}</label>
        <input id="join-email" type="email" autocomplete="email" placeholder="you@company.com" />
      </div>
      <div class="cta-row">
        <button type="button" class="tc-btn" id="join-passkey">${escapeHtml(t("wallet.joinSuperPasskey"))}</button>
        <button type="button" class="tc-btn secondary" id="join-yubikey">${escapeHtml(t("wallet.joinSuperYubiKey"))}</button>
        <button type="button" class="tc-btn secondary" id="join-eoa">${escapeHtml(t("wallet.joinSuperEoa"))}</button>
      </div>
      <div id="join-yubikey-help" class="hidden"></div>
      <div id="join-wait" class="hidden">
        <p class="field-hint">${escapeHtml(t("wallet.joinSuperWaiting"))}</p>
      </div>
      <p id="join-status" class="status wallet-status" role="status"></p>`,
  });

  bindWalletAccountBar(root);

  const showYubiHelp = () => {
    const box = root.querySelector<HTMLElement>("#join-yubikey-help");
    if (box) {
      box.classList.remove("hidden");
      box.innerHTML = renderYubiKeyPinRequiredPanel();
    }
  };

  const enroll = async (
    keyType: number,
    material: {
      qx: string;
      qy: string;
      eoa: string;
      credentialId?: string;
      rawId?: string;
    }
  ) => {
    const status = root.querySelector<HTMLElement>("#join-status");
    const email = (root.querySelector<HTMLInputElement>("#join-email")?.value ?? "").trim();
    if (!email) {
      showStatus(status, t("wallet.superWalletEmailRequired"), "error");
      return;
    }
    const entityId = hashEntityEmail(email);
    const roster = await listWalletEntities(walletAddress);
    if (!roster.entities.some((e) => e.entityId === entityId)) {
      showStatus(status, t("wallet.joinSuperEntityMissing"), "error");
      return;
    }
    showStatus(status, t("wallet.joinSuperSubmitting"));
    const request = await createKeyEnrollmentRequest({
      walletAddress,
      entityId,
      keyType,
      qx: material.qx,
      qy: material.qy,
      eoa: material.eoa,
      credentialId: material.credentialId ?? null,
      label: email,
    });
    root.querySelector("#join-wait")?.classList.remove("hidden");
    await pollUntilApproved(root, walletAddress, join.chainId, request.id, {
      entityId,
      keyType,
      ...material,
      label: email,
    });
  };

  root.querySelector("#join-passkey")?.addEventListener("click", async () => {
    const btn = root.querySelector<HTMLButtonElement>("#join-passkey");
    setButtonLoading(btn, true);
    try {
      const passkey = await createPasskey(t("wallet.joinSuperPasskeyLabel"), { attachment: "platform" });
      const fields = passkeyToKeyFields(passkey);
      await enroll(KEY_WEBAUTHN, {
        qx: fields.qx,
        qy: fields.qy,
        eoa: zeroPadValue("0x00", 20),
        credentialId: fields.credentialId,
        rawId: passkey.rawId,
      });
    } catch (error) {
      const status = root.querySelector<HTMLElement>("#join-status");
      showStatus(status, error instanceof Error ? error.message : String(error), "error");
    } finally {
      setButtonLoading(btn, false);
    }
  });

  root.querySelector("#join-yubikey")?.addEventListener("click", async () => {
    const btn = root.querySelector<HTMLButtonElement>("#join-yubikey");
    setButtonLoading(btn, true);
    try {
      const passkey = await createSecurityKey(t("wallet.joinSuperYubiKeyLabel"));
      const fields = passkeyToKeyFields(passkey);
      await enroll(KEY_YUBIKEY, {
        qx: fields.qx,
        qy: fields.qy,
        eoa: zeroPadValue("0x00", 20),
        credentialId: fields.credentialId,
        rawId: passkey.rawId,
      });
    } catch (error) {
      const status = root.querySelector<HTMLElement>("#join-status");
      if (isYubiKeyPinRequiredError(error)) {
        showYubiHelp();
        showStatus(status, t("wallet.yubikeyPinRequiredTitle"), "error");
      } else {
        showStatus(status, error instanceof Error ? error.message : String(error), "error");
      }
    } finally {
      setButtonLoading(btn, false);
    }
  });

  root.querySelector("#join-eoa")?.addEventListener("click", async () => {
    const btn = root.querySelector<HTMLButtonElement>("#join-eoa");
    setButtonLoading(btn, true);
    try {
      const eoa = getAddress(await connectEoaWallet());
      await enroll(KEY_EOA, {
        qx: zeroPadValue("0x00", 32),
        qy: zeroPadValue("0x00", 32),
        eoa,
        credentialId: "",
        rawId: "",
      });
    } catch (error) {
      const status = root.querySelector<HTMLElement>("#join-status");
      showStatus(status, error instanceof Error ? error.message : String(error), "error");
    } finally {
      setButtonLoading(btn, false);
    }
  });
}

async function pollUntilApproved(
  root: HTMLElement,
  walletAddress: string,
  chainId: string,
  requestId: string,
  material: {
    entityId: string;
    keyType: number;
    qx: string;
    qy: string;
    eoa: string;
    credentialId?: string;
    rawId?: string;
    label: string;
  }
): Promise<void> {
  const status = root.querySelector<HTMLElement>("#join-status");
  const deadline = Date.now() + 15 * 60 * 1000;
  while (Date.now() < deadline) {
    const request = await getKeyEnrollmentRequest(walletAddress, requestId);
    if (request.status === "approved") {
      const keyId = computeKeyId(material.entityId, material.keyType, material.qx, material.qy, material.eoa);
      saveMemberWalletSession({
        address: walletAddress,
        chainId,
        entityId: material.entityId,
        keyId,
        keyType: material.keyType,
        qx: material.qx,
        qy: material.qy,
        credentialId: material.credentialId ?? "",
        rawId: material.rawId ?? "",
        label: material.label,
        eoa: material.keyType === KEY_EOA ? material.eoa : undefined,
      });
      showStatus(status, t("wallet.joinSuperApproved"), "success");
      spaNavigate("/wallet", "replace");
      return;
    }
    if (request.status === "rejected" || request.status === "expired") {
      showStatus(status, t("wallet.joinSuperRejected"), "error");
      root.querySelector("#join-wait")?.classList.add("hidden");
      return;
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
  showStatus(status, t("wallet.joinSuperTimeout"), "error");
  root.querySelector("#join-wait")?.classList.add("hidden");
}
