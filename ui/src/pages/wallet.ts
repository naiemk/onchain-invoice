import { Contract, JsonRpcProvider, BrowserProvider, id } from "ethers";
import { t } from "../i18n/t.js";
import {
  createPairing,
  deleteDevice,
  fetchWalletConfig,
  listDevices,
  pairingQrPayload,
  parsePairingQr,
  pollPairing,
  registerDevice,
  submitPairing,
  waitForUserOp,
} from "../shared/wallet-api.js";
import {
  authenticatePasskey,
  clearWalletSession,
  createPasskey,
  loadWalletSession,
  saveWalletSession,
  webAuthnSupported,
  type WalletSession,
} from "../shared/webauthn.js";
import {
  buildSignedAddOwnerUserOp,
  buildSignedRemoveOwnerUserOp,
  submitSignedUserOp,
} from "../shared/userop-client.js";
import { ERC20_ABI, formatUsdFromUsdc } from "../../../commerce/shared/userop.js";
import { renderWalletSend } from "./wallet/send.js";

const FACTORY_ABI = [
  "function createAccount(bytes32 qx, bytes32 qy, bytes32 salt) returns (address)",
  "function predictAddress(bytes32 salt) view returns (address)",
  "function recoveryTimelock() view returns (uint256)",
];

const WALLET_ABI = [
  "function ownerCount() view returns (uint256)",
  "function paused() view returns (bool)",
  "function pendingOwner() view returns (bytes32 qx, bytes32 qy, uint64 executableAt, bytes32 requestId, bool active)",
  "function addOwner(bytes32 qx, bytes32 qy)",
  "function removeOwner(bytes32 qx, bytes32 qy)",
  "function recoveryMetadata() view returns (bytes)",
];

export async function renderWallet(root: HTMLElement): Promise<void> {
  const path = location.pathname;
  if (path === "/wallet/security") {
    await renderSecurity(root);
    return;
  }
  if (path === "/wallet/create") {
    renderCreate(root);
    return;
  }
  if (path === "/wallet/pair") {
    await renderPair(root);
    return;
  }
  if (path === "/wallet/send") {
    await renderWalletSend(root);
    return;
  }
  await renderHome(root);
}

async function renderHome(root: HTMLElement): Promise<void> {
  const session = loadWalletSession();
  let balanceLine = "";
  if (session) {
    try {
      const config = await fetchWalletConfig();
      if (config.rpcUrl && config.feeTokenAddress) {
        const provider = new JsonRpcProvider(config.rpcUrl);
        const token = new Contract(config.feeTokenAddress, ERC20_ABI, provider);
        const balance = BigInt(await token.balanceOf(session.address));
        balanceLine = `<p class="wallet-balance">${t("wallet.sendAvailable", {
          amount: formatUsdFromUsdc(balance, config.feeTokenDecimals),
          symbol: config.feeTokenSymbol,
        })}</p>`;
      }
    } catch {
      /* ignore balance read errors */
    }
  }
  root.innerHTML = `
    <section class="panel wallet-panel">
      <h1>${t("wallet.homeTitle")}</h1>
      <p class="lede">${t("wallet.homeLede")}</p>
      ${
        session
          ? `<div class="wallet-session">
              <p><strong>${session.label}</strong></p>
              <p class="mono">${session.address}</p>
              ${balanceLine}
              <div class="cta-row">
                <a class="tc-btn" href="/wallet/send" data-route>${t("wallet.sendTitle")}</a>
                <a class="tc-btn secondary" href="/wallet/security" data-route>${t("wallet.securityTab")}</a>
                <button type="button" class="tc-btn secondary" id="wallet-signout">${t("wallet.signOut")}</button>
              </div>
            </div>`
          : `<div class="cta-row">
              <a class="tc-btn" href="/wallet/create" data-route>${t("wallet.create")}</a>
              <button type="button" class="tc-btn secondary" id="wallet-login">${t("wallet.signIn")}</button>
              <a class="tc-btn secondary" href="/wallet/pair" data-route>${t("wallet.pairDevice")}</a>
            </div>`
      }
      <p class="hint">${t("wallet.syncHint")}</p>
    </section>`;

  root.querySelector("#wallet-signout")?.addEventListener("click", () => {
    clearWalletSession();
    void renderWallet(root);
  });
  root.querySelector("#wallet-login")?.addEventListener("click", async () => {
    const ok = await authenticatePasskey();
    if (!ok) {
      alert(t("wallet.signInFailed"));
      return;
    }
    location.href = "/wallet/security";
  });
}

function renderCreate(root: HTMLElement): void {
  root.innerHTML = `
    <section class="panel wallet-panel">
      <h1>${t("wallet.createTitle")}</h1>
      <p class="lede">${t("wallet.createLede")}</p>
      <label>${t("wallet.deviceName")}<input id="device-name" type="text" placeholder="${t("wallet.deviceNamePlaceholder")}" /></label>
      <p class="hint">${webAuthnSupported() ? t("wallet.webauthnOk") : t("wallet.webauthnNo")}</p>
      <button type="button" class="tc-btn" id="wallet-create-btn">${t("wallet.createPasskey")}</button>
      <p id="wallet-create-status" class="hint" role="status"></p>
    </section>`;

  root.querySelector("#wallet-create-btn")?.addEventListener("click", () => void runCreate(root));
}

async function runCreate(root: HTMLElement): Promise<void> {
  const status = root.querySelector<HTMLElement>("#wallet-create-status");
  const nameInput = root.querySelector<HTMLInputElement>("#device-name");
  const label = nameInput?.value.trim() || t("wallet.defaultDevice");
  if (!status) return;
  try {
    status.textContent = t("wallet.creatingPasskey");
    const owner = await createPasskey(label);
    status.textContent = t("wallet.deploying");
    const config = await fetchWalletConfig();
    if (!config.factoryAddress) throw new Error(t("wallet.noFactory"));

    const provider = new BrowserProvider(
      (window as unknown as { ethereum?: unknown }).ethereum as never
    );
    const signer = await provider.getSigner();
    const factory = new Contract(config.factoryAddress, FACTORY_ABI, signer);
    const salt = id(`wallet-${owner.rawId}-${Date.now()}`);
    const tx = await factory.createAccount(owner.qx, owner.qy, salt);
    await tx.wait();
    const address: string = await factory.predictAddress(salt);

    const session: WalletSession = {
      address,
      chainId: config.chainId,
      qx: owner.qx,
      qy: owner.qy,
      credentialId: owner.credentialId,
      rawId: owner.rawId,
      label,
    };
    saveWalletSession(session);
    await registerDevice({
      walletAddress: address,
      chainId: config.chainId,
      ownerQx: owner.qx,
      ownerQy: owner.qy,
      label,
      credentialId: owner.credentialId,
    });
    status.textContent = t("wallet.created", { address });
    setTimeout(() => {
      location.href = "/wallet/security";
    }, 800);
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : String(error);
  }
}

async function renderSecurity(root: HTMLElement): Promise<void> {
  const session = loadWalletSession();
  if (!session) {
    location.href = "/wallet/create";
    return;
  }

  let devices: Awaited<ReturnType<typeof listDevices>> = [];
  let pendingRecovery = false;
  let config = await fetchWalletConfig();

  try {
    devices = await listDevices(session.address, session.chainId);
  } catch {
    devices = [];
  }

  if (config.rpcUrl && config.factoryAddress) {
    try {
      const provider = new JsonRpcProvider(config.rpcUrl);
      const wallet = new Contract(session.address, WALLET_ABI, provider);
      pendingRecovery = (await wallet.pendingOwner()).active;
    } catch {
      pendingRecovery = false;
    }
  }

  root.innerHTML = `
    <section class="panel wallet-panel">
      <nav class="wallet-subnav">
        <a href="/wallet" data-route>${t("wallet.homeTitle")}</a>
        <span aria-current="page">${t("wallet.securityTab")}</span>
      </nav>
      <h1>${t("wallet.securityTab")}</h1>
      <p class="mono wallet-address">${session.address}</p>
      ${
        pendingRecovery
          ? `<div class="banner warn">${t("wallet.pendingRecovery")}</div>`
          : ""
      }
      <h2>${t("wallet.passkeys")}</h2>
      <ul class="wallet-device-list">
        ${devices
          .map(
            (d) => `
          <li>
            <div>
              <strong>${escapeHtml(d.label)}</strong>
              <span class="mono faint">${shortKey(d.ownerQx)}</span>
            </div>
            ${
              devices.length > 1
                ? `<button type="button" class="tc-btn secondary small" data-remove="${d.ownerQx}|${d.ownerQy}">${t("wallet.remove")}</button>`
                : ""
            }
          </li>`
          )
          .join("")}
      </ul>
      <div class="cta-row">
        <button type="button" class="tc-btn" id="add-device-qr">${t("wallet.addDevice")}</button>
      </div>
      <div id="pair-qr-box" class="pair-qr-box hidden"></div>
      <h2>${t("wallet.recoverySection")}</h2>
      <p class="hint">${t("wallet.recoveryHint")}</p>
      <p class="hint">${t("wallet.recoveryTimelock", { hours: Math.round(config.recoveryTimelockSeconds / 3600) })}</p>
    </section>`;

  root.querySelector("#add-device-qr")?.addEventListener("click", async () => {
    const box = root.querySelector<HTMLElement>("#pair-qr-box");
    if (!box) return;
    const pairing = await createPairing(session.address, session.chainId);
    const payload = pairingQrPayload({
      walletAddress: session.address,
      chainId: session.chainId,
      nonce: pairing.pairing.nonce,
      rpId: window.location.hostname,
    });
    box.classList.remove("hidden");
    box.innerHTML = `
      <p>${t("wallet.scanOnNewDevice")}</p>
      <textarea readonly rows="4" class="mono">${escapeHtml(payload)}</textarea>
      <p class="hint">${t("wallet.pairingExpires")}</p>
      <div id="pair-approve"></div>`;

    const approve = box.querySelector("#pair-approve");
    const interval = setInterval(async () => {
      const { pairing: p } = await pollPairing(pairing.pairing.nonce);
      if (p.status === "approved" && p.newOwnerQx && p.newOwnerQy) {
        clearInterval(interval);
        approve!.innerHTML = `<p>${t("wallet.approvePairing", { label: p.deviceLabel ?? "device" })}</p>
          <button type="button" class="tc-btn" id="confirm-add-owner">${t("wallet.confirmAddOwner")}</button>`;
        approve!.querySelector("#confirm-add-owner")?.addEventListener("click", async () => {
          try {
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
            await submitSignedUserOp({
              config: cfg,
              userOp,
              userOpHash,
              walletAddress: session.address,
            });
            const result = await waitForUserOp(userOpHash);
            if (result.status !== "included") {
              throw new Error(result.rejectReason ?? result.status);
            }
            await registerDevice({
              walletAddress: session.address,
              chainId: session.chainId,
              ownerQx: p.newOwnerQx!,
              ownerQy: p.newOwnerQy!,
              label: p.deviceLabel ?? "Device",
              credentialId: "",
            });
            await renderSecurity(root);
          } catch (error) {
            alert(error instanceof Error ? error.message : String(error));
          }
        });
      }
    }, 2000);
  });

  root.querySelectorAll("[data-remove]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const [qx, qy] = (btn as HTMLElement).dataset.remove!.split("|");
      if (!confirm(t("wallet.removeConfirm"))) return;
      try {
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
        await submitSignedUserOp({
          config: cfg,
          userOp,
          userOpHash,
          walletAddress: session.address,
        });
        const result = await waitForUserOp(userOpHash);
        if (result.status !== "included") {
          throw new Error(result.rejectReason ?? result.status);
        }
        await deleteDevice(session.address, session.chainId, qx, qy);
        await renderSecurity(root);
      } catch (error) {
        alert(error instanceof Error ? error.message : String(error));
      }
    });
  });
}

async function renderPair(root: HTMLElement): Promise<void> {
  root.innerHTML = `
    <section class="panel wallet-panel">
      <h1>${t("wallet.pairTitle")}</h1>
      <p class="lede">${t("wallet.pairLede")}</p>
      <label>${t("wallet.pairPayload")}<textarea id="pair-payload" rows="5"></textarea></label>
      <label>${t("wallet.deviceName")}<input id="pair-device-name" type="text" /></label>
      <button type="button" class="tc-btn" id="pair-submit">${t("wallet.pairSubmit")}</button>
      <p id="pair-status" class="hint"></p>
    </section>`;

  root.querySelector("#pair-submit")?.addEventListener("click", async () => {
    const status = root.querySelector<HTMLElement>("#pair-status");
    const raw = root.querySelector<HTMLTextAreaElement>("#pair-payload")?.value.trim();
    const label = root.querySelector<HTMLInputElement>("#pair-device-name")?.value.trim() || "New device";
    if (!raw || !status) return;
    try {
      const payload = parsePairingQr(raw);
      status.textContent = t("wallet.creatingPasskey");
      const owner = await createPasskey(label);
      await submitPairing({
        nonce: payload.nonce,
        newOwnerQx: owner.qx,
        newOwnerQy: owner.qy,
        deviceLabel: label,
      });
      status.textContent = t("wallet.pairWaiting");
    } catch (error) {
      status.textContent = error instanceof Error ? error.message : String(error);
    }
  });
}

function shortKey(hex: string): string {
  return `${hex.slice(0, 8)}…${hex.slice(-6)}`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
