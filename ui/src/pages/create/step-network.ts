import { escapeHtml } from "../../shared/dom.js";
import { t } from "../../i18n/t.js";
import {
  chainLogoSvg,
  networkShort,
  type NetworkOption,
} from "../../shared/networks.js";
import { listWalletRegistry, shortAddress } from "../../shared/wallet-session.js";

function chainPillHtml(network: NetworkOption, checked: boolean): string {
  return `
    <label class="chain-pill">
      <input type="checkbox" name="chains" value="${escapeHtml(network.id)}" ${checked ? "checked" : ""} />
      <span class="chain-pill-face">
        ${chainLogoSvg(network.id, 20)}
        <span class="chain-pill-label">${escapeHtml(networkShort(network.id))}</span>
      </span>
    </label>`;
}

export function walletPickerHtml(): string {
  const registry = listWalletRegistry();
  if (registry.length === 0) {
    return `
      <div class="field" id="evm-wallet-picker">
        <p class="field-hint">${t("create.walletNoneHint")}</p>
        <div class="btn-row" style="margin-bottom:0.5rem">
          <button type="button" class="secondary" id="use-passkey-wallet">${t("create.walletCreateButton")}</button>
        </div>
        <input type="hidden" id="wallet-picker-mode" value="custom" />
      </div>`;
  }
  const options = registry
    .map(
      (w) =>
        `<option value="${escapeHtml(w.address)}">${escapeHtml(w.label)} · ${escapeHtml(shortAddress(w.address))}</option>`
    )
    .join("");
  return `
    <div class="field" id="evm-wallet-picker">
      <label for="wallet-picker-select">${t("create.walletSelectLabel")}</label>
      <p class="field-hint">${t("create.walletSelectHint")}</p>
      <select id="wallet-picker-select">
        ${options}
        <option value="__custom__">${escapeHtml(t("create.walletCustomOption"))}</option>
      </select>
      <div class="btn-row" style="margin-top:0.5rem">
        <button type="button" class="secondary" id="use-passkey-wallet">${t("create.usePasskeyWallet")}</button>
        <button type="button" class="secondary" id="clear-passkey-wallet" hidden>${t("create.changeWallet")}</button>
      </div>
      <p class="field-hint" id="passkey-wallet-chip" hidden></p>
    </div>`;
}

export function stepNetworkHtml(networks: NetworkOption[], modeLabel: string): string {
  return `
    <div class="wizard-step" data-step="2" hidden>
      <div class="field" id="chain-select-field">
        <label id="networks-label">${t("create.networksLabel")} <span class="required">${t("common.required")}</span></label>
        <p class="field-hint" id="networks-hint">${t("create.networksHint")}</p>
        <p class="field-hint" id="fiat-networks-locked-hint" hidden>${t("create.fiatNetworksLockedHint")}</p>
        <div class="chain-pill-row" id="chains" role="group" aria-label="${escapeHtml(t("create.networksAria"))}">
          ${
            networks.length === 0
              ? `<p class="danger">${escapeHtml(t("create.noNetworks", { mode: modeLabel }))}</p>`
              : networks.map((n, i) => chainPillHtml(n, i === 0)).join("")
          }
        </div>
      </div>

      <div class="field" id="evm-wallet-field" hidden>
        <label for="toEvm">${t("create.evmWalletLabel")} <span class="required">${t("common.required")}</span></label>
        <div class="callout info wallet-settlement-note" role="note">
          <strong>${t("create.fundsSweptStrong")}</strong>
          ${t("create.evmWalletNote")}
        </div>
        ${walletPickerHtml()}
        <p class="field-hint">${t("create.evmWalletHint")}</p>
        <input id="toEvm" name="toEvm" class="mono" placeholder="0x…" autocomplete="off" spellcheck="false" disabled />
        <p class="field-error" id="toEvm-error" hidden></p>
      </div>

      <div class="field" id="tron-wallet-field" hidden>
        <label for="toTron">${t("create.tronWalletLabel")} <span class="required">${t("common.required")}</span></label>
        <div class="callout info wallet-settlement-note" role="note">
          <strong>${t("create.fundsSweptStrong")}</strong>
          ${t("create.tronWalletNote")}
        </div>
        <p class="field-hint">${t("create.tronWalletHint")}</p>
        <input id="toTron" name="toTron" class="mono" placeholder="T…" autocomplete="off" spellcheck="false" disabled />
        <p class="field-error" id="toTron-error" hidden></p>
      </div>

      <div class="field" id="solana-wallet-field" hidden>
        <label for="toSolana">${t("create.solanaWalletLabel")} <span class="required">${t("common.required")}</span></label>
        <div class="callout info wallet-settlement-note" role="note">
          <strong>${t("create.fundsSweptStrong")}</strong>
          ${t("create.solanaWalletNote")}
        </div>
        <p class="field-hint">${t("create.solanaWalletHint")}</p>
        <input id="toSolana" name="toSolana" class="mono" placeholder="So…" autocomplete="off" spellcheck="false" disabled />
        <p class="field-error" id="toSolana-error" hidden></p>
      </div>

      <div class="field" id="token-select-field">
        <label>${t("create.tokensLabel")} <span class="required">${t("common.required")}</span></label>
        <p class="field-hint">${t("create.tokensHint")}</p>
        <div class="field-row" id="tokens"></div>
      </div>
    </div>`;
}
