import { t } from "../../i18n/t.js";
import { fetchWalletConfig } from "../../shared/wallet-api.js";
import {
  assertPasskeyChallenge,
  createPasskey,
  loadWalletSession,
  webAuthnSupported,
} from "../../shared/webauthn.js";
import { mountTurnstile } from "../../shared/turnstile.js";
import {
  attachWalletEmail,
  cancelRecoveryRequest,
  createRecoveryChallenge,
  createRecoveryRequest,
  fetchWalletRecovery,
  verifyRecoveryEmailOtp,
  verifyWalletEmailOtp,
} from "../../shared/wallet-recovery-api.js";
import { currentSpaRender, isSpaRenderCurrent } from "../../shared/spa-render.js";
import {
  paintWalletLoading,
  paintWalletPage,
  setButtonLoading,
  showStatus,
  type WalletRenderOptions,
} from "../../shared/wallet-ui.js";
import { escapeHtml } from "../../shared/dom.js";

type TurnstileCtl = Awaited<ReturnType<typeof mountTurnstile>>;

export async function renderWalletRecover(root: HTMLElement, opts?: WalletRenderOptions): Promise<void> {
  const gen = currentSpaRender();
  const session = loadWalletSession();
  paintWalletLoading(root, "recover", t("wallet.recoverTitle"), t("wallet.recoverLede"), opts);

  const config = await fetchWalletConfig();
  if (!isSpaRenderCurrent(gen)) return;

  let statusPayload: Awaited<ReturnType<typeof fetchWalletRecovery>> | null = null;
  const walletHint = session?.address ?? "";
  if (walletHint) {
    try {
      statusPayload = await fetchWalletRecovery(walletHint);
    } catch {
      statusPayload = null;
    }
  }
  if (!isSpaRenderCurrent(gen)) return;

  const emailStatus = statusPayload?.email;
  const active = statusPayload?.request;
  const pending = statusPayload?.pendingOwner?.active ? statusPayload.pendingOwner : null;
  const hours = Math.round(config.recoveryTimelockSeconds / 3600);
  const siteKey = config.turnstileSiteKey ?? null;

  paintWalletPage(
    root,
    {
    current: "recover",
    title: t("wallet.recoverTitle"),
    lede: t("wallet.recoverLede"),
    body: `
      ${
        pending || active
          ? `<div class="banner warn" id="recover-active-banner">
              <p>${escapeHtml(
                pending
                  ? t("wallet.pendingRecovery")
                  : t("wallet.recoverRequestStatus", { status: active?.status ?? "" })
              )}</p>
              ${
                active
                  ? `<p class="field-hint">${escapeHtml(t("wallet.recoverRequestMeta", {
                      email: active.email,
                      device: active.deviceLabel ?? "device",
                    }))}</p>`
                  : ""
              }
              ${
                pending
                  ? `<p class="field-hint mono">${escapeHtml(
                      t("wallet.recoverExecutableAt", { at: formatExecutableAt(pending.executableAt) })
                    )}</p>`
                  : ""
              }
              ${
                session && active
                  ? `<div class="cta-row">
                      <button type="button" class="tc-btn secondary" id="recover-cancel-btn">${escapeHtml(t("wallet.recoverCancel"))}</button>
                    </div>
                    <div id="recover-cancel-captcha" class="wallet-captcha"></div>`
                  : ""
              }
            </div>`
          : ""
      }

      <section class="wallet-recovery-section">
        <h2>${escapeHtml(t("wallet.recoverHaveAccessTitle"))}</h2>
        <p class="field-hint">${escapeHtml(t("wallet.recoverHaveAccessLede"))}</p>
        ${
          session
            ? `
          <p class="field-hint">${escapeHtml(
            emailStatus?.verified
              ? t("wallet.recoverEmailVerified", { email: emailStatus.email })
              : emailStatus
                ? t("wallet.recoverEmailPending", { email: emailStatus.email })
                : t("wallet.recoverEmailNone")
          )}</p>
          <div class="field">
            <label for="recover-email">${escapeHtml(t("wallet.recoverEmailLabel"))}</label>
            <input id="recover-email" type="email" autocomplete="email" placeholder="you@example.com" />
          </div>
          <div id="recover-attach-captcha" class="wallet-captcha"></div>
          <div class="cta-row">
            <button type="button" class="tc-btn" id="recover-attach-btn" ${webAuthnSupported() ? "" : "disabled"}>
              ${escapeHtml(t("wallet.recoverAttachEmail"))}
            </button>
          </div>
          <div id="recover-attach-otp" class="hidden">
            <div class="field">
              <label for="recover-attach-code">${escapeHtml(t("wallet.recoverOtpLabel"))}</label>
              <input id="recover-attach-code" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="6" />
            </div>
            <div id="recover-attach-otp-captcha" class="wallet-captcha"></div>
            <button type="button" class="tc-btn" id="recover-attach-verify">${escapeHtml(t("wallet.recoverVerifyOtp"))}</button>
          </div>`
            : `<p class="field-hint">${escapeHtml(t("wallet.recoverNeedSession"))}</p>
               <a class="tc-btn secondary" href="/wallet" data-route>${escapeHtml(t("wallet.goToWallet"))}</a>`
        }
      </section>

      <section class="wallet-recovery-section">
        <h2>${escapeHtml(t("wallet.recoverLostTitle"))}</h2>
        <p class="field-hint">${escapeHtml(t("wallet.recoverLostLede"))}</p>
        <p class="field-hint">${escapeHtml(t("wallet.recoveryTimelock", { hours }))}</p>
        <div class="field">
          <label for="recover-wallet">${escapeHtml(t("wallet.recoverWalletLabel"))}</label>
          <input id="recover-wallet" type="text" placeholder="0x…" value="${escapeHtml(walletHint)}" />
        </div>
        <div class="field">
          <label for="recover-lost-email">${escapeHtml(t("wallet.recoverLostEmailLabel"))}</label>
          <input id="recover-lost-email" type="email" autocomplete="email" placeholder="you@example.com" />
        </div>
        <div class="field">
          <label for="recover-device-name">${escapeHtml(t("wallet.deviceName"))}</label>
          <input id="recover-device-name" type="text" placeholder="${escapeHtml(t("wallet.deviceNamePlaceholder"))}" />
        </div>
        <div id="recover-lost-captcha" class="wallet-captcha"></div>
        <div class="cta-row">
          <button type="button" class="tc-btn" id="recover-start-btn" ${webAuthnSupported() ? "" : "disabled"}>
            ${escapeHtml(t("wallet.recoverStart"))}
          </button>
        </div>
        <div id="recover-lost-otp" class="hidden">
          <div class="field">
            <label for="recover-lost-code">${escapeHtml(t("wallet.recoverOtpLabel"))}</label>
            <input id="recover-lost-code" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="6" />
          </div>
          <div id="recover-lost-otp-captcha" class="wallet-captcha"></div>
          <button type="button" class="tc-btn" id="recover-lost-verify">${escapeHtml(t("wallet.recoverVerifyOtp"))}</button>
        </div>
      </section>

      <p id="recover-status" class="status wallet-status" role="status"></p>`,
    },
    opts,
    (r) => {
  void bindRecoverBody(r, {
    gen,
    session,
    active,
    siteKey,
    config,
    opts,
  });
    }
  );
}

async function bindRecoverBody(
  root: HTMLElement,
  ctx: {
    gen: number;
    session: ReturnType<typeof loadWalletSession>;
    active: Awaited<ReturnType<typeof fetchWalletRecovery>>["request"] | undefined;
    siteKey: string | null;
    config: Awaited<ReturnType<typeof fetchWalletConfig>>;
    opts?: WalletRenderOptions;
  }
): Promise<void> {
  const { gen, session, active, siteKey, config, opts } = ctx;

  const captchas: {
    attach: TurnstileCtl;
    attachOtp: TurnstileCtl;
    lost: TurnstileCtl;
    lostOtp: TurnstileCtl;
    cancel: TurnstileCtl;
  } = {
    attach: null,
    attachOtp: null,
    lost: null,
    lostOtp: null,
    cancel: null,
  };

  const mount = async (id: string): Promise<TurnstileCtl> => {
    const el = root.querySelector<HTMLElement>(`#${id}`);
    if (!el) return null;
    return mountTurnstile(el, siteKey);
  };

  captchas.attach = await mount("recover-attach-captcha");
  captchas.attachOtp = await mount("recover-attach-otp-captcha");
  captchas.lost = await mount("recover-lost-captcha");
  captchas.lostOtp = await mount("recover-lost-otp-captcha");
  captchas.cancel = await mount("recover-cancel-captcha");
  if (!isSpaRenderCurrent(gen)) return;

  let pendingAttachEmail = "";
  let pendingRequestId = "";

  root.querySelector("#recover-attach-btn")?.addEventListener("click", () => {
    void (async () => {
      if (!session) return;
      const status = root.querySelector<HTMLElement>("#recover-status");
      const btn = root.querySelector<HTMLButtonElement>("#recover-attach-btn");
      const email = root.querySelector<HTMLInputElement>("#recover-email")?.value.trim() ?? "";
      if (!email.includes("@")) {
        showStatus(status, t("wallet.recoverInvalidEmail"), "error");
        return;
      }
      try {
        setButtonLoading(btn, true);
        const captchaToken = captchas.attach?.getToken() ?? null;
        if (siteKey && !captchaToken) {
          showStatus(status, t("wallet.recoverCaptchaRequired"), "error");
          return;
        }
        const ch = await createRecoveryChallenge("attach", session.address);
        const { assertion } = await assertPasskeyChallenge({
          challengeBase64Url: ch.challenge,
          credentialId: session.credentialId,
        });
        await attachWalletEmail({
          walletAddress: session.address,
          email,
          challengeId: ch.challengeId,
          ownerQx: session.qx,
          ownerQy: session.qy,
          assertion,
          captchaToken,
        });
        pendingAttachEmail = email;
        root.querySelector("#recover-attach-otp")?.classList.remove("hidden");
        showStatus(status, t("wallet.recoverOtpSent"), "info");
        captchas.attach?.reset();
      } catch (error) {
        showStatus(status, error instanceof Error ? error.message : String(error), "error");
      } finally {
        setButtonLoading(btn, false);
      }
    })();
  });

  root.querySelector("#recover-attach-verify")?.addEventListener("click", () => {
    void (async () => {
      if (!session) return;
      const status = root.querySelector<HTMLElement>("#recover-status");
      const code = root.querySelector<HTMLInputElement>("#recover-attach-code")?.value.trim() ?? "";
      try {
        const captchaToken = captchas.attachOtp?.getToken() ?? null;
        if (siteKey && !captchaToken) {
          showStatus(status, t("wallet.recoverCaptchaRequired"), "error");
          return;
        }
        await verifyWalletEmailOtp({
          walletAddress: session.address,
          email: pendingAttachEmail,
          code,
          captchaToken,
        });
        showStatus(status, t("wallet.recoverEmailOk"), "success");
        await renderWalletRecover(root, opts);
      } catch (error) {
        showStatus(status, error instanceof Error ? error.message : String(error), "error");
      }
    })();
  });

  root.querySelector("#recover-start-btn")?.addEventListener("click", () => {
    void (async () => {
      const status = root.querySelector<HTMLElement>("#recover-status");
      const btn = root.querySelector<HTMLButtonElement>("#recover-start-btn");
      const walletAddress =
        root.querySelector<HTMLInputElement>("#recover-wallet")?.value.trim() || undefined;
      const email =
        root.querySelector<HTMLInputElement>("#recover-lost-email")?.value.trim() || undefined;
      const label =
        root.querySelector<HTMLInputElement>("#recover-device-name")?.value.trim() ||
        t("wallet.defaultDevice");
      if (!walletAddress && !email) {
        showStatus(status, t("wallet.recoverNeedWalletOrEmail"), "error");
        return;
      }
      try {
        setButtonLoading(btn, true, t("wallet.creatingPasskey"));
        const captchaToken = captchas.lost?.getToken() ?? null;
        if (siteKey && !captchaToken) {
          showStatus(status, t("wallet.recoverCaptchaRequired"), "error");
          return;
        }
        const passkey = await createPasskey(label);
        const ch = await createRecoveryChallenge("recover", walletAddress);
        const { assertion } = await assertPasskeyChallenge({
          challengeBase64Url: ch.challenge,
          credentialId: passkey.credentialId,
        });
        const result = await createRecoveryRequest({
          walletAddress,
          email,
          challengeId: ch.challengeId,
          ownerQx: passkey.qx,
          ownerQy: passkey.qy,
          credentialId: passkey.credentialId,
          label,
          assertion,
          captchaToken,
          chainId: config.chainId,
        });
        pendingRequestId = result.request.id;
        if (result.otpSent) {
          root.querySelector("#recover-lost-otp")?.classList.remove("hidden");
          showStatus(status, t("wallet.recoverOtpSent"), "info");
        } else {
          showStatus(status, t("wallet.recoverSubmitted"), "success");
        }
        captchas.lost?.reset();
      } catch (error) {
        showStatus(status, error instanceof Error ? error.message : String(error), "error");
      } finally {
        setButtonLoading(btn, false);
      }
    })();
  });

  root.querySelector("#recover-lost-verify")?.addEventListener("click", () => {
    void (async () => {
      const status = root.querySelector<HTMLElement>("#recover-status");
      const code = root.querySelector<HTMLInputElement>("#recover-lost-code")?.value.trim() ?? "";
      if (!pendingRequestId) {
        showStatus(status, t("wallet.recoverNeedRequest"), "error");
        return;
      }
      try {
        const captchaToken = captchas.lostOtp?.getToken() ?? null;
        if (siteKey && !captchaToken) {
          showStatus(status, t("wallet.recoverCaptchaRequired"), "error");
          return;
        }
        await verifyRecoveryEmailOtp({ requestId: pendingRequestId, code, captchaToken });
        showStatus(status, t("wallet.recoverSubmitted"), "success");
        await renderWalletRecover(root, opts);
      } catch (error) {
        showStatus(status, error instanceof Error ? error.message : String(error), "error");
      }
    })();
  });

  root.querySelector("#recover-cancel-btn")?.addEventListener("click", () => {
    void (async () => {
      if (!session || !active) return;
      const status = root.querySelector<HTMLElement>("#recover-status");
      const btn = root.querySelector<HTMLButtonElement>("#recover-cancel-btn");
      if (!window.confirm(t("wallet.recoverCancelConfirm"))) return;
      try {
        setButtonLoading(btn, true);
        const captchaToken = captchas.cancel?.getToken() ?? null;
        if (siteKey && !captchaToken) {
          showStatus(status, t("wallet.recoverCaptchaRequired"), "error");
          return;
        }
        const ch = await createRecoveryChallenge("cancel", session.address);
        const { assertion } = await assertPasskeyChallenge({
          challengeBase64Url: ch.challenge,
          credentialId: session.credentialId,
        });
        await cancelRecoveryRequest({
          requestId: active.id,
          challengeId: ch.challengeId,
          ownerQx: session.qx,
          ownerQy: session.qy,
          credentialId: session.credentialId,
          assertion,
          captchaToken,
        });
        showStatus(status, t("wallet.recoverCancelled"), "success");
        await renderWalletRecover(root, opts);
      } catch (error) {
        showStatus(status, error instanceof Error ? error.message : String(error), "error");
      } finally {
        setButtonLoading(btn, false);
      }
    })();
  });
}

function formatExecutableAt(unixSeconds: string): string {
  const n = Number(unixSeconds);
  if (!Number.isFinite(n) || n <= 0) return "—";
  try {
    return new Date(n * 1000).toLocaleString();
  } catch {
    return unixSeconds;
  }
}
