import { getAddress, zeroPadValue } from "ethers";
import { t } from "../../i18n/t.js";
import { createPasskey, createSecurityKey, isYubiKeyPinRequiredError, loadWalletSession } from "../../shared/webauthn.js";
import { currentSpaRender, isSpaRenderCurrent, spaNavigate } from "../../shared/spa-render.js";
import {
  bindWalletAccountBar,
  renderYubiKeyPinRequiredPanel,
  setButtonLoading,
  showStatus,
  walletFrame,
  walletLoadingFrame,
} from "../../shared/wallet-ui.js";
import { escapeHtml } from "../../shared/dom.js";
import { fetchWalletConfig, waitForUserOp } from "../../shared/wallet-api.js";
import {
  fetchAdvancedPolicy,
  listWalletEntities,
  listKeyEnrollmentRequests,
  approveKeyEnrollmentRequest,
  rejectKeyEnrollmentRequest,
  registerWalletEntity,
  registerWalletEntityKey,
} from "../../shared/wallet-advanced-api.js";
import {
  hashEntityEmail,
  computeKeyId,
  KEY_WEBAUTHN,
  KEY_YUBIKEY,
  KEY_EOA,
} from "../../../../commerce/shared/advanced-wallet.js";
import {
  buildSignedAddEntityUserOp,
  buildSignedAddKeyUserOp,
  buildSignedConfigureMultisigUserOp,
  buildSignedEnableAdvancedUserOp,
  passkeyToKeyFields,
} from "../../shared/advanced-userop-client.js";
import { submitSignedUserOp } from "../../shared/userop-client.js";
import { isAdvancedMode } from "../../shared/wallet-mode.js";
import { connectEoaWallet, initEoaConnector } from "../../shared/eoa-connector.js";
import type {
  WalletEntityKeyRecord,
  WalletEntityRecord,
  WalletKeyEnrollmentRequestRecord,
} from "../../../../commerce/shared/wallet.js";

export async function renderWalletSuperWallet(root: HTMLElement): Promise<void> {
  const gen = currentSpaRender();
  const session = loadWalletSession();
  if (!session) {
    spaNavigate("/wallet", "replace");
    return;
  }
  if (!isAdvancedMode()) {
    spaNavigate("/wallet/security", "replace");
    return;
  }

  root.innerHTML = walletLoadingFrame("superWallet", t("wallet.superWalletTitle"));
  bindWalletAccountBar(root);

  const config = await fetchWalletConfig();
  await initEoaConnector(config);
  if (!isSpaRenderCurrent(gen)) return;
  const policy = await fetchAdvancedPolicy(session.address).catch(() => ({
    wallet: session.address,
    advanced: false,
    threshold: 1,
    entityCount: 0,
    vetoCount: 0,
    vetoBitmap: "0",
  }));
  if (!isSpaRenderCurrent(gen)) return;

  const roster = policy.advanced
    ? await listWalletEntities(session.address).catch(() => ({ entities: [], keys: [] }))
    : { entities: [], keys: [] };
  if (!isSpaRenderCurrent(gen)) return;

  const adminEntity = roster.entities[0] ?? null;
  let pendingEnrollments: Awaited<ReturnType<typeof listKeyEnrollmentRequests>> = [];
  if (policy.advanced) {
    try {
      pendingEnrollments = await listKeyEnrollmentRequests(session.address, "pending");
    } catch {
      pendingEnrollments = [];
    }
  }
  if (!isSpaRenderCurrent(gen)) return;

  root.innerHTML = walletFrame({
    current: "superWallet",
    title: t("wallet.superWalletTitle"),
    lede: t("wallet.superWalletLede"),
    body: `
      ${
        !policy.advanced
          ? renderUpgradeSection()
          : `<section>
              <p>${escapeHtml(t("wallet.superWalletActive", { threshold: String(policy.threshold), entities: String(policy.entityCount) }))}</p>
              <div class="cta-row">
                <a class="tc-btn" href="/wallet/proposals" data-route>${escapeHtml(t("wallet.proposalsOpen"))}</a>
              </div>
            </section>
            <section>
              <h2>${escapeHtml(t("wallet.enrollmentPendingTitle"))}</h2>
              ${renderPendingEnrollments(pendingEnrollments)}
            </section>
            <section>
              <h2>${escapeHtml(t("wallet.superWalletPolicyTitle"))}</h2>
              <div class="field">
                <label for="policy-threshold">${escapeHtml(t("wallet.superWalletThreshold"))}</label>
                <input id="policy-threshold" type="number" min="1" max="${Math.max(1, roster.entities.length)}" value="${policy.threshold}" />
              </div>
              <button type="button" class="tc-btn secondary" id="apply-threshold">${escapeHtml(t("wallet.superWalletApplyPolicy"))}</button>
            </section>
            <section>
              <h2>${escapeHtml(t("wallet.superWalletEntitiesTitle"))}</h2>
              ${renderEntityList(roster.entities, roster.keys, adminEntity?.entityId ?? null)}
              <div class="field">
                <label for="entity-email">${escapeHtml(t("wallet.superWalletEntityEmail"))}</label>
                <input id="entity-email" type="email" placeholder="teammate@company.com" />
              </div>
              <button type="button" class="tc-btn secondary" id="add-entity">${escapeHtml(t("wallet.superWalletAddEntity"))}</button>
            </section>`
      }
      <p id="super-status" class="status wallet-status" role="status"></p>`,
  });

  bindWalletAccountBar(root);
  bindUpgrade(root, session, config);
  if (policy.advanced) {
    bindPolicy(root, session, config, roster, adminEntity);
    bindEntities(root, session, config, roster, adminEntity);
    bindKeyActions(root, session, config, roster, adminEntity);
    bindEnrollmentApprovals(root, session, config, adminEntity);
  }
}

function renderUpgradeSection(): string {
  return `<section class="wallet-super-upgrade">
      <h2>${escapeHtml(t("wallet.superWalletUpgradeTitle"))}</h2>
      <div class="wallet-super-features">
        <h3>${escapeHtml(t("wallet.superWalletFeaturesTitle"))}</h3>
        <ul class="wallet-feature-list">
          <li>${escapeHtml(t("wallet.superWalletFeatureMultisig"))}</li>
          <li>${escapeHtml(t("wallet.superWalletFeatureMixedKeys"))}</li>
          <li>${escapeHtml(t("wallet.superWalletFeatureProposals"))}</li>
          <li>${escapeHtml(t("wallet.superWalletFeatureIrreversible"))}</li>
        </ul>
      </div>
      <div class="banner warn wallet-super-warning">
        <p>${escapeHtml(t("wallet.superWalletUpgradeWarning"))}</p>
      </div>
      <div class="wallet-super-email">
        <h3>${escapeHtml(t("wallet.superWalletEmailWhyTitle"))}</h3>
        <p class="field-hint">${escapeHtml(t("wallet.superWalletEmailWhy"))}</p>
        <div class="field">
          <label for="admin-email">${escapeHtml(t("wallet.superWalletAdminEmail"))}</label>
          <input id="admin-email" type="email" autocomplete="email" placeholder="you@company.com" />
        </div>
      </div>
      <button type="button" class="tc-btn" id="enable-advanced">${escapeHtml(t("wallet.superWalletConvertCta"))}</button>
      <div class="wallet-super-team">
        <h3>${escapeHtml(t("wallet.superWalletTeamJoinTitle"))}</h3>
        <p class="field-hint">${escapeHtml(t("wallet.superWalletTeamJoinIntro"))}</p>
        <ol class="wallet-pair-steps">
          <li>${escapeHtml(t("wallet.superWalletTeamJoinStep1"))}</li>
          <li>${escapeHtml(t("wallet.superWalletTeamJoinStep2"))}</li>
          <li>${escapeHtml(t("wallet.superWalletTeamJoinStep3"))}</li>
        </ol>
        <p class="field-hint"><a href="/wallet/security" data-route>${escapeHtml(t("wallet.securityTab"))}</a> · ${escapeHtml(t("wallet.pairStepsTitle"))}</p>
      </div>
    </section>`;
}

function renderEntityList(
  entities: WalletEntityRecord[],
  keys: WalletEntityKeyRecord[],
  adminEntityId: string | null
): string {
  if (entities.length === 0) {
    return `<p class="field-hint">${escapeHtml(t("wallet.superWalletEntitiesEmpty"))}</p>`;
  }
  return `<ul class="wallet-device-list">
    ${entities
      .map((e) => {
        const entityKeys = keys.filter((k) => k.entityId === e.entityId);
        return `<li class="wallet-entity-row" data-entity-id="${escapeHtml(e.entityId)}">
          <div>
            <strong>${escapeHtml(e.label ?? shortEntity(e.entityId))}</strong>
            <ul class="wallet-key-list">
              ${entityKeys
                .map((k) => `<li><span class="wallet-key-badge">${escapeHtml(keyTypeLabel(k.keyType))}</span>
                  <span class="mono faint">${escapeHtml(shortKeyDisplay(k))}</span></li>`)
                .join("")}
            </ul>
          </div>
          ${
            adminEntityId && e.entityId === adminEntityId
              ? `<div class="cta-row wallet-entity-actions">
            <button type="button" class="tc-btn secondary small" data-add-passkey="${escapeHtml(e.entityId)}">${escapeHtml(t("wallet.superWalletAddPasskey"))}</button>
            <button type="button" class="tc-btn secondary small" data-add-yubikey="${escapeHtml(e.entityId)}">${escapeHtml(t("wallet.superWalletAddYubiKey"))}</button>
            <button type="button" class="tc-btn secondary small" data-add-eoa="${escapeHtml(e.entityId)}">${escapeHtml(t("wallet.superWalletConnectWallet"))}</button>
          </div>`
              : `<p class="field-hint">${escapeHtml(t("wallet.inviteTeammateHint"))}</p>`
          }
        </li>`;
      })
      .join("")}
  </ul>`;
}

function keyTypeLabel(keyType: number): string {
  if (keyType === KEY_YUBIKEY) return t("wallet.superWalletKeyYubiKey");
  if (keyType === KEY_EOA) return t("wallet.superWalletKeyEoa");
  return t("wallet.superWalletKeyPasskey");
}

function shortKeyDisplay(k: WalletEntityKeyRecord): string {
  if (k.eoa) return `${k.eoa.slice(0, 8)}…${k.eoa.slice(-4)}`;
  if (k.qx) return `${k.qx.slice(0, 10)}…`;
  return "key";
}

function shortEntity(entityId: string): string {
  return `${entityId.slice(0, 10)}…${entityId.slice(-6)}`;
}

function renderPendingEnrollments(requests: WalletKeyEnrollmentRequestRecord[]): string {
  if (requests.length === 0) {
    return `<p class="field-hint">${escapeHtml(t("wallet.enrollmentPendingEmpty"))}</p>`;
  }
  return `<ul class="wallet-device-list">
    ${requests
      .map(
        (r) => `<li class="wallet-enrollment-row" data-enrollment-id="${escapeHtml(r.id)}">
          <div>
            <strong>${escapeHtml(r.label ?? shortEntity(r.entityId))}</strong>
            <span class="wallet-key-badge">${escapeHtml(keyTypeLabel(r.keyType))}</span>
            <span class="mono faint">${escapeHtml(shortKeyDisplayFromRequest(r))}</span>
          </div>
          <div class="cta-row">
            <button type="button" class="tc-btn small" data-approve-enrollment="${escapeHtml(r.id)}">${escapeHtml(t("wallet.enrollmentApprove"))}</button>
            <button type="button" class="tc-btn secondary small" data-reject-enrollment="${escapeHtml(r.id)}">${escapeHtml(t("wallet.enrollmentReject"))}</button>
          </div>
        </li>`
      )
      .join("")}
  </ul>`;
}

function shortKeyDisplayFromRequest(r: WalletKeyEnrollmentRequestRecord): string {
  if (r.eoa) return `${r.eoa.slice(0, 8)}…${r.eoa.slice(-4)}`;
  if (r.qx) return `${r.qx.slice(0, 10)}…`;
  return "key";
}

function bindEnrollmentApprovals(
  root: HTMLElement,
  session: NonNullable<ReturnType<typeof loadWalletSession>>,
  config: Awaited<ReturnType<typeof fetchWalletConfig>>,
  adminEntity: WalletEntityRecord | null
): void {
  if (!adminEntity) return;

  root.querySelectorAll("[data-approve-enrollment]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const requestId = (btn as HTMLElement).dataset.approveEnrollment!;
      const status = root.querySelector<HTMLElement>("#super-status");
      setButtonLoading(btn as HTMLButtonElement, true);
      try {
        const requests = await listKeyEnrollmentRequests(session.address, "pending");
        const req = requests.find((r) => r.id === requestId);
        if (!req) throw new Error("request_not_found");
        const qx = req.qx ?? zeroPadValue("0x00", 32);
        const qy = req.qy ?? zeroPadValue("0x00", 32);
        const eoa = req.eoa ?? zeroPadValue("0x00", 20);
        await submitAddKey({
          session,
          config,
          adminEntity,
          targetEntityId: req.entityId,
          keyType: req.keyType,
          qx,
          qy,
          eoa,
          credentialId: req.credentialId ?? undefined,
        });
        await approveKeyEnrollmentRequest(session.address, requestId);
        await renderWalletSuperWallet(root);
      } catch (error) {
        showStatus(status, error instanceof Error ? error.message : String(error), "error");
      } finally {
        setButtonLoading(btn as HTMLButtonElement, false);
      }
    });
  });

  root.querySelectorAll("[data-reject-enrollment]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const requestId = (btn as HTMLElement).dataset.rejectEnrollment!;
      const status = root.querySelector<HTMLElement>("#super-status");
      try {
        await rejectKeyEnrollmentRequest(session.address, requestId);
        await renderWalletSuperWallet(root);
      } catch (error) {
        showStatus(status, error instanceof Error ? error.message : String(error), "error");
      }
    });
  });
}

function bindUpgrade(
  root: HTMLElement,
  session: ReturnType<typeof loadWalletSession>,
  config: Awaited<ReturnType<typeof fetchWalletConfig>>
): void {
  root.querySelector("#enable-advanced")?.addEventListener("click", async () => {
    if (!session) return;
    const status = root.querySelector<HTMLElement>("#super-status");
    const email = (root.querySelector<HTMLInputElement>("#admin-email")?.value ?? "").trim();
    if (!email) {
      showStatus(status, t("wallet.superWalletEmailRequired"), "error");
      return;
    }
    if (!window.confirm(t("wallet.superWalletUpgradeConfirm"))) return;
    const btn = root.querySelector<HTMLButtonElement>("#enable-advanced");
    setButtonLoading(btn, true);
    try {
      showStatus(status, t("wallet.sendSigning"));
      const adminEntityId = hashEntityEmail(email);
      const fee = BigInt(config.bundlerFeeUsdc || "0");
      const { userOp, userOpHash } = await buildSignedEnableAdvancedUserOp({
        config,
        walletAddress: session.address,
        adminEntityId,
        qx: session.qx,
        qy: session.qy,
        feeAmount: fee,
        credentialId: session.credentialId,
      });
      await submitSignedUserOp({ config, userOp, userOpHash, walletAddress: session.address });
      const result = await waitForUserOp(userOpHash);
      if (result.status !== "included") throw new Error(result.rejectReason ?? result.status);
      await registerWalletEntity({ walletAddress: session.address, entityId: adminEntityId, label: email });
      await registerWalletEntityKey({
        walletAddress: session.address,
        entityId: adminEntityId,
        keyId: computeKeyId(adminEntityId, KEY_WEBAUTHN, session.qx, session.qy, zeroPadValue("0x00", 20)),
        keyType: KEY_WEBAUTHN,
        qx: session.qx,
        qy: session.qy,
        credentialId: session.credentialId ?? null,
      });
      await renderWalletSuperWallet(root);
    } catch (error) {
      showStatus(status, error instanceof Error ? error.message : String(error), "error");
    } finally {
      setButtonLoading(btn, false);
    }
  });
}

function bindPolicy(
  root: HTMLElement,
  session: NonNullable<ReturnType<typeof loadWalletSession>>,
  config: Awaited<ReturnType<typeof fetchWalletConfig>>,
  roster: { entities: WalletEntityRecord[]; keys: WalletEntityKeyRecord[] },
  adminEntity: WalletEntityRecord | null
): void {
  root.querySelector("#apply-threshold")?.addEventListener("click", async () => {
    if (!adminEntity) return;
    const status = root.querySelector<HTMLElement>("#super-status");
    const threshold = Number((root.querySelector<HTMLInputElement>("#policy-threshold")?.value ?? "1"));
    if (!Number.isFinite(threshold) || threshold < 1) return;
    const btn = root.querySelector<HTMLButtonElement>("#apply-threshold");
    setButtonLoading(btn, true);
    try {
      showStatus(status, t("wallet.sendSigning"));
      const fee = BigInt(config.bundlerFeeUsdc || "0");
      const entityIds = roster.entities.map((e) => e.entityId);
      const entityIdsForKeys = roster.keys.map((k) => k.entityId);
      const keyTypes = roster.keys.map((k) => k.keyType);
      const qx = roster.keys.map((k) => k.qx ?? zeroPadValue("0x00", 32));
      const qy = roster.keys.map((k) => k.qy ?? zeroPadValue("0x00", 32));
      const eoa = roster.keys.map((k) => k.eoa ?? zeroPadValue("0x00", 20));
      const { userOp, userOpHash } = await buildSignedConfigureMultisigUserOp({
        config,
        walletAddress: session.address,
        adminEntityId: adminEntity.entityId,
        adminQx: session.qx,
        adminQy: session.qy,
        adminCredentialId: session.credentialId,
        removeKeyIds: [],
        entityIds,
        entityIdsForKeys,
        keyTypes,
        qx,
        qy,
        eoa,
        threshold,
        vetoEntityIds: [],
        feeAmount: fee,
      });
      await submitSignedUserOp({ config, userOp, userOpHash, walletAddress: session.address });
      const result = await waitForUserOp(userOpHash);
      if (result.status !== "included") throw new Error(result.rejectReason ?? result.status);
      await renderWalletSuperWallet(root);
    } catch (error) {
      showStatus(status, error instanceof Error ? error.message : String(error), "error");
    } finally {
      setButtonLoading(btn, false);
    }
  });
}

function bindEntities(
  root: HTMLElement,
  session: NonNullable<ReturnType<typeof loadWalletSession>>,
  config: Awaited<ReturnType<typeof fetchWalletConfig>>,
  _roster: { entities: WalletEntityRecord[]; keys: WalletEntityKeyRecord[] },
  adminEntity: WalletEntityRecord | null
): void {
  root.querySelector("#add-entity")?.addEventListener("click", async () => {
    const status = root.querySelector<HTMLElement>("#super-status");
    const email = (root.querySelector<HTMLInputElement>("#entity-email")?.value ?? "").trim();
    if (!email || !adminEntity) {
      showStatus(status, t("wallet.superWalletEmailRequired"), "error");
      return;
    }
    const entityId = hashEntityEmail(email);
    const btn = root.querySelector<HTMLButtonElement>("#add-entity");
    setButtonLoading(btn, true);
    try {
      showStatus(status, t("wallet.sendSigning"));
      const fee = BigInt(config.bundlerFeeUsdc || "0");
      const { userOp, userOpHash } = await buildSignedAddEntityUserOp({
        config,
        walletAddress: session.address,
        adminEntityId: adminEntity.entityId,
        entityId,
        qx: session.qx,
        qy: session.qy,
        feeAmount: fee,
        credentialId: session.credentialId,
      });
      await submitSignedUserOp({ config, userOp, userOpHash, walletAddress: session.address });
      const result = await waitForUserOp(userOpHash);
      if (result.status !== "included") throw new Error(result.rejectReason ?? result.status);
      await registerWalletEntity({ walletAddress: session.address, entityId, label: email });
      await renderWalletSuperWallet(root);
    } catch (error) {
      showStatus(status, error instanceof Error ? error.message : String(error), "error");
    } finally {
      setButtonLoading(btn, false);
    }
  });
}

function bindKeyActions(
  root: HTMLElement,
  session: NonNullable<ReturnType<typeof loadWalletSession>>,
  config: Awaited<ReturnType<typeof fetchWalletConfig>>,
  _roster: { entities: WalletEntityRecord[]; keys: WalletEntityKeyRecord[] },
  adminEntity: WalletEntityRecord | null
): void {
  if (!adminEntity) return;

  root.querySelectorAll("[data-add-passkey]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const entityId = (btn as HTMLElement).dataset.addPasskey!;
      const status = root.querySelector<HTMLElement>("#super-status");
      try {
        showStatus(status, t("wallet.superWalletEnrollPasskey"));
        const passkey = await createPasskey("Super Wallet key", { attachment: "platform" });
        const fields = passkeyToKeyFields(passkey);
        await submitAddKey({
          session,
          config,
          adminEntity,
          targetEntityId: entityId,
          keyType: KEY_WEBAUTHN,
          qx: fields.qx,
          qy: fields.qy,
          eoa: zeroPadValue("0x00", 20),
          credentialId: fields.credentialId,
        });
        await renderWalletSuperWallet(root);
      } catch (error) {
        showStatus(status, error instanceof Error ? error.message : String(error), "error");
      }
    });
  });

  root.querySelectorAll("[data-add-yubikey]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const entityId = (btn as HTMLElement).dataset.addYubikey!;
      const status = root.querySelector<HTMLElement>("#super-status");
      try {
        showStatus(status, t("wallet.superWalletEnrollYubiKey"));
        const passkey = await createSecurityKey("Security key");
        const fields = passkeyToKeyFields(passkey);
        await submitAddKey({
          session,
          config,
          adminEntity,
          targetEntityId: entityId,
          keyType: KEY_YUBIKEY,
          qx: fields.qx,
          qy: fields.qy,
          eoa: zeroPadValue("0x00", 20),
          credentialId: fields.credentialId,
        });
        await renderWalletSuperWallet(root);
      } catch (error) {
        if (isYubiKeyPinRequiredError(error)) {
          showStatus(status, t("wallet.yubikeyPinRequiredTitle"), "error");
        } else {
          showStatus(status, error instanceof Error ? error.message : String(error), "error");
        }
      }
    });
  });

  root.querySelectorAll("[data-add-eoa]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const entityId = (btn as HTMLElement).dataset.addEoa!;
      const status = root.querySelector<HTMLElement>("#super-status");
      try {
        showStatus(status, t("wallet.superWalletConnectWalletHint"));
        const eoa = getAddress(await connectEoaWallet());
        await submitAddKey({
          session,
          config,
          adminEntity,
          targetEntityId: entityId,
          keyType: KEY_EOA,
          qx: zeroPadValue("0x00", 32),
          qy: zeroPadValue("0x00", 32),
          eoa,
        });
        await renderWalletSuperWallet(root);
      } catch (error) {
        showStatus(status, error instanceof Error ? error.message : String(error), "error");
      }
    });
  });
}

async function submitAddKey(input: {
  session: NonNullable<ReturnType<typeof loadWalletSession>>;
  config: Awaited<ReturnType<typeof fetchWalletConfig>>;
  adminEntity: WalletEntityRecord;
  targetEntityId: string;
  keyType: number;
  qx: string;
  qy: string;
  eoa: string;
  credentialId?: string;
}): Promise<void> {
  const fee = BigInt(input.config.bundlerFeeUsdc || "0");
  const keyId = computeKeyId(input.targetEntityId, input.keyType, input.qx, input.qy, input.eoa);
  const { userOp, userOpHash } = await buildSignedAddKeyUserOp({
    config: input.config,
    walletAddress: input.session.address,
    adminEntityId: input.adminEntity.entityId,
    adminQx: input.session.qx,
    adminQy: input.session.qy,
    adminCredentialId: input.session.credentialId,
    targetEntityId: input.targetEntityId,
    keyType: input.keyType,
    qx: input.qx,
    qy: input.qy,
    eoa: input.eoa,
    feeAmount: fee,
  });
  await submitSignedUserOp({
    config: input.config,
    userOp,
    userOpHash,
    walletAddress: input.session.address,
  });
  const result = await waitForUserOp(userOpHash);
  if (result.status !== "included") throw new Error(result.rejectReason ?? result.status);
  await registerWalletEntityKey({
    walletAddress: input.session.address,
    entityId: input.targetEntityId,
    keyId,
    keyType: input.keyType,
    qx: input.qx,
    qy: input.qy,
    eoa: input.keyType === KEY_EOA ? input.eoa : null,
    credentialId: input.credentialId ?? null,
  });
}
