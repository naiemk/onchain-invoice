import { escapeHtml } from "../shared/dom.js";
import { t } from "../i18n/t.js";
import {
  approveGuardianRequest,
  clearGuardianSession,
  fetchGuardianMe,
  fetchGuardianNonce,
  guardianLogin,
  listGuardianRecoveryRequests,
  loadGuardianSession,
  rejectGuardianRequest,
  saveGuardianSession,
  type RecoveryRequestPublic,
} from "../shared/wallet-recovery-api.js";
import { shortKey } from "../shared/wallet-ui.js";

type EthProvider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
};

function ethereum(): EthProvider | null {
  const w = window as Window & { ethereum?: EthProvider };
  return w.ethereum ?? null;
}

export async function renderGuardian(root: HTMLElement): Promise<void> {
  const token = loadGuardianSession();
  if (token) {
    try {
      const me = await fetchGuardianMe();
      await renderDashboard(root, me.address);
      return;
    } catch {
      clearGuardianSession();
    }
  }
  renderLogin(root);
}

function renderLogin(root: HTMLElement): void {
  root.innerHTML = `
    <div class="admin-shell guardian-shell">
      <header class="page-header">
        <p class="eyebrow">${escapeHtml(t("guardian.eyebrow"))}</p>
        <h1>${escapeHtml(t("guardian.title"))}</h1>
        <p class="lede">${escapeHtml(t("guardian.lede"))}</p>
      </header>
      <section class="panel">
        <p class="field-hint">${escapeHtml(t("guardian.connectHint"))}</p>
        <button type="button" class="tc-btn" id="guardian-connect">${escapeHtml(t("guardian.connect"))}</button>
        <p id="guardian-status" class="status" role="status"></p>
      </section>
    </div>`;

  root.querySelector("#guardian-connect")?.addEventListener("click", () => {
    void (async () => {
      const status = root.querySelector<HTMLElement>("#guardian-status");
      const provider = ethereum();
      if (!provider) {
        if (status) status.textContent = t("guardian.noMetamask");
        return;
      }
      try {
        if (status) status.textContent = t("guardian.connecting");
        const accounts = (await provider.request({ method: "eth_requestAccounts" })) as string[];
        const address = accounts[0];
        if (!address) throw new Error(t("guardian.noAccount"));
        const { nonce, message } = await fetchGuardianNonce(address);
        const signature = (await provider.request({
          method: "personal_sign",
          params: [message, address],
        })) as string;
        const login = await guardianLogin({ address, signature, message, nonce });
        saveGuardianSession(login.token);
        await renderDashboard(root, login.address);
      } catch (error) {
        if (status) status.textContent = error instanceof Error ? error.message : String(error);
      }
    })();
  });
}

async function renderDashboard(root: HTMLElement, address: string): Promise<void> {
  root.innerHTML = `
    <div class="admin-shell guardian-shell">
      <header class="page-header">
        <p class="eyebrow">${escapeHtml(t("guardian.eyebrow"))}</p>
        <h1>${escapeHtml(t("guardian.title"))}</h1>
        <p class="lede">${escapeHtml(t("guardian.signedIn", { address: shortAddr(address) }))}</p>
      </header>
      <section class="panel">
        <div class="cta-row">
          <button type="button" class="tc-btn secondary small" data-filter="awaiting">${escapeHtml(t("guardian.filterAwaiting"))}</button>
          <button type="button" class="tc-btn secondary small" data-filter="progress">${escapeHtml(t("guardian.filterProgress"))}</button>
          <button type="button" class="tc-btn secondary small" data-filter="archive">${escapeHtml(t("guardian.filterArchive"))}</button>
          <button type="button" class="tc-btn secondary small" id="guardian-refresh">${escapeHtml(t("guardian.refresh"))}</button>
          <button type="button" class="tc-btn secondary small" id="guardian-signout">${escapeHtml(t("guardian.signOut"))}</button>
        </div>
        <div id="guardian-table" aria-live="polite"></div>
        <div id="guardian-detail" class="hidden"></div>
        <p id="guardian-status" class="status" role="status"></p>
      </section>
    </div>`;

  const load = async (filter: string) => {
    const status = root.querySelector<HTMLElement>("#guardian-status");
    const table = root.querySelector<HTMLElement>("#guardian-table");
    if (!table) return;
    try {
      if (status) status.textContent = t("common.loading");
      const statusParam =
        filter === "awaiting"
          ? "awaiting_guardian"
          : filter === "progress"
            ? "queued,on_chain"
            : "archive";
      const { requests } = await listGuardianRecoveryRequests(statusParam);
      if (status) status.textContent = "";
      if (requests.length === 0) {
        table.innerHTML = `<p class="field-hint">${escapeHtml(t("guardian.empty"))}</p>`;
        return;
      }
      table.innerHTML = `
        <table class="data-table">
          <thead>
            <tr>
              <th>${escapeHtml(t("guardian.colWallet"))}</th>
              <th>${escapeHtml(t("guardian.colEmail"))}</th>
              <th>${escapeHtml(t("guardian.colDevice"))}</th>
              <th>${escapeHtml(t("guardian.colStatus"))}</th>
              <th>${escapeHtml(t("guardian.colCreated"))}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            ${requests
              .map(
                (r) => `
              <tr>
                <td class="mono">${escapeHtml(shortAddr(r.walletAddress))}</td>
                <td>${escapeHtml(r.email)}</td>
                <td>${escapeHtml(r.deviceLabel ?? "—")} <span class="mono faint">${escapeHtml(shortKey(r.newQx))}</span></td>
                <td>${escapeHtml(r.status)}</td>
                <td>${escapeHtml(new Date(r.createdAt).toLocaleString())}</td>
                <td class="cta-row">
                  <button type="button" class="tc-btn secondary small" data-detail="${escapeHtml(r.id)}">${escapeHtml(t("guardian.detail"))}</button>
                  ${
                    r.status === "awaiting_guardian"
                      ? `<button type="button" class="tc-btn small" data-approve="${escapeHtml(r.id)}">${escapeHtml(t("guardian.approve"))}</button>
                         <button type="button" class="tc-btn secondary small" data-reject="${escapeHtml(r.id)}">${escapeHtml(t("guardian.reject"))}</button>`
                      : ""
                  }
                </td>
              </tr>`
              )
              .join("")}
          </tbody>
        </table>`;

      const byId = new Map(requests.map((r) => [r.id, r]));
      table.querySelectorAll<HTMLElement>("[data-detail]").forEach((btn) => {
        btn.addEventListener("click", () => {
          const r = byId.get(btn.dataset.detail ?? "");
          if (r) showDetail(root, r);
        });
      });
      table.querySelectorAll<HTMLElement>("[data-approve]").forEach((btn) => {
        btn.addEventListener("click", () => {
          void (async () => {
            try {
              await approveGuardianRequest(btn.dataset.approve!);
              await load(filter);
            } catch (error) {
              if (status) status.textContent = error instanceof Error ? error.message : String(error);
            }
          })();
        });
      });
      table.querySelectorAll<HTMLElement>("[data-reject]").forEach((btn) => {
        btn.addEventListener("click", () => {
          void (async () => {
            if (!window.confirm(t("guardian.rejectConfirm"))) return;
            try {
              await rejectGuardianRequest(btn.dataset.reject!);
              await load(filter);
            } catch (error) {
              if (status) status.textContent = error instanceof Error ? error.message : String(error);
            }
          })();
        });
      });
    } catch (error) {
      table.innerHTML = "";
      if (status) status.textContent = error instanceof Error ? error.message : String(error);
    }
  };

  let filter = "awaiting";
  root.querySelectorAll<HTMLButtonElement>("[data-filter]").forEach((btn) => {
    btn.addEventListener("click", () => {
      filter = btn.dataset.filter ?? "awaiting";
      void load(filter);
    });
  });
  root.querySelector("#guardian-refresh")?.addEventListener("click", () => void load(filter));
  root.querySelector("#guardian-signout")?.addEventListener("click", () => {
    clearGuardianSession();
    renderLogin(root);
  });
  await load(filter);
}

function showDetail(root: HTMLElement, r: RecoveryRequestPublic): void {
  const detail = root.querySelector<HTMLElement>("#guardian-detail");
  if (!detail) return;
  detail.classList.remove("hidden");
  detail.innerHTML = `
    <h2>${escapeHtml(t("guardian.detailTitle"))}</h2>
    <dl class="guardian-detail">
      <dt>ID</dt><dd class="mono">${escapeHtml(r.id)}</dd>
      <dt>${escapeHtml(t("guardian.colWallet"))}</dt><dd class="mono">${escapeHtml(r.walletAddress)}</dd>
      <dt>${escapeHtml(t("guardian.colEmail"))}</dt><dd>${escapeHtml(r.email)}</dd>
      <dt>qx</dt><dd class="mono">${escapeHtml(r.newQx)}</dd>
      <dt>qy</dt><dd class="mono">${escapeHtml(r.newQy)}</dd>
      <dt>credential</dt><dd class="mono">${escapeHtml(r.credentialId)}</dd>
    </dl>
    <button type="button" class="tc-btn secondary small" id="guardian-detail-close">${escapeHtml(t("common.close"))}</button>`;
  detail.querySelector("#guardian-detail-close")?.addEventListener("click", () => {
    detail.classList.add("hidden");
    detail.innerHTML = "";
  });
}

function shortAddr(address: string): string {
  if (address.length < 12) return address;
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}
