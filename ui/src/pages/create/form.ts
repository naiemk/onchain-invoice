/** Shared form helpers for the create-invoice wizard. */

import { localizeError } from "../../i18n/errors.js";
import { t } from "../../i18n/t.js";
import {
  networkKind,
  normalizeAddress,
  tokenAllowedOnChain,
  tokensForChains,
  type ChainKind,
} from "../../shared/networks.js";
import type { PayLinkFields, PaymentMode } from "../../shared/types.js";
import { deploymentMode } from "../../shared/networks.js";

export function onrampSupportedSet(root: HTMLElement): Set<string> {
  const raw = root.dataset.onrampPairs;
  if (!raw) return new Set();
  try {
    const pairs = JSON.parse(raw) as Array<{ chainId: string; token: string }>;
    return new Set(pairs.map((p) => `${p.chainId}:${p.token.toUpperCase()}`));
  } catch {
    return new Set();
  }
}

export function chainHasOnrampSupport(root: HTMLElement, chainId: string): boolean {
  const supported = onrampSupportedSet(root);
  return supported.has(`${chainId}:USDC`) || supported.has(`${chainId}:USDT`);
}

/** Locked minimum rails for fiat: Eth+Base+Tron (mainnet) or Sepolia+Nile (testnet). */
export function fiatMinimumChainIds(): string[] {
  return deploymentMode() === "testnet" ? ["11155111", "nile"] : ["1", "8453", "tron"];
}

export function fiatMinimumTokenForChain(chainId: string): string {
  const kind = networkKind(chainId);
  return kind === "tron" ? "USDT" : "USDC";
}

export function selectedOnrampPairs(root: HTMLElement): Array<{ chainId: string; token: string }> {
  const chains = checked(root, "chains");
  const tokens = checked(root, "tokens");
  const supported = onrampSupportedSet(root);
  const pairs: Array<{ chainId: string; token: string }> = [];
  for (const chainId of chains) {
    for (const token of tokens) {
      if (supported.size === 0) {
        if (tokenAllowedOnChain(chainId, token)) pairs.push({ chainId, token });
      } else if (supported.has(`${chainId}:${token}`)) {
        pairs.push({ chainId, token });
      }
    }
  }
  return pairs;
}

export function selectedPaymentMode(root: HTMLElement): PaymentMode {
  if (root.dataset.onrampEnabled !== "1") return "crypto";
  const value = root.querySelector<HTMLInputElement>('input[name="paymentMode"]:checked')?.value;
  if (value === "crypto" || value === "crypto_or_fiat" || value === "fiat") return value;
  return "crypto_or_fiat";
}

export function checked(root: HTMLElement, name: string): string[] {
  const values = [...root.querySelectorAll<HTMLInputElement>(`input[name="${name}"]:checked`)].map(
    (el) => el.value
  );
  for (const el of root.querySelectorAll<HTMLInputElement>(
    `input[name="${name}"][disabled], input[name="${name}"][data-tron-usdt-lock], input[name="${name}"][data-fiat-token-lock]`
  )) {
    if (el.value && !values.includes(el.value)) values.push(el.value);
  }
  return values;
}

export function fieldValue(root: HTMLElement, id: string): string {
  return root.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(`#${id}`)?.value.trim() ?? "";
}

export function clearAddressFieldError(root: HTMLElement, inputId: string): void {
  const input = root.querySelector<HTMLInputElement>(`#${inputId}`);
  const err = root.querySelector<HTMLElement>(`#${inputId}-error`);
  input?.removeAttribute("aria-invalid");
  if (err) {
    err.hidden = true;
    err.textContent = "";
  }
}

export function markAddressField(root: HTMLElement, inputId: string, kind: ChainKind): void {
  const input = root.querySelector<HTMLInputElement>(`#${inputId}`);
  const err = root.querySelector<HTMLElement>(`#${inputId}-error`);
  if (!input || input.disabled) return;
  const value = input.value.trim();
  if (!value) {
    clearAddressFieldError(root, inputId);
    return;
  }
  try {
    normalizeAddress(value, kind);
    clearAddressFieldError(root, inputId);
  } catch (error) {
    const message = error instanceof Error ? localizeError(error) : t("errors.invalidAddress");
    input.setAttribute("aria-invalid", "true");
    if (err) {
      err.hidden = false;
      err.textContent = message;
    }
  }
}

export function setWalletField(
  field: HTMLElement | null,
  input: HTMLInputElement | null,
  enabled: boolean
): void {
  if (field) field.hidden = !enabled;
  if (input) {
    input.required = enabled;
    input.disabled = !enabled;
    if (!enabled) {
      input.value = "";
      input.removeAttribute("aria-invalid");
      const err = field?.querySelector<HTMLElement>(".field-error");
      if (err) {
        err.hidden = true;
        err.textContent = "";
      }
    }
  }
}

export function renderTokenOptions(root: HTMLElement, chains: string[]): void {
  const host = root.querySelector<HTMLElement>("#tokens");
  if (!host) return;
  const previous = new Set(
    [...root.querySelectorAll<HTMLInputElement>('input[name="tokens"]:checked')].map((el) => el.value)
  );
  const mode = selectedPaymentMode(root);
  const fiatMode = mode === "fiat";
  const supported = onrampSupportedSet(root);
  let tokens = tokensForChains(chains);
  if (fiatMode && supported.size > 0) {
    tokens = tokens.filter((token) =>
      chains.some((chainId) => supported.has(`${chainId}:${token.id}`))
    );
  }
  const needsTron = chains.some((id) => networkKind(id) === "tron");
  if (tokens.length === 0) {
    host.innerHTML = `<p class="field-hint">${t("create.selectNetworkForTokens")}</p>`;
    return;
  }
  const fiatLockedTokens = new Set<string>();
  if (fiatMode) {
    for (const chainId of chains) {
      const required = fiatMinimumTokenForChain(chainId);
      if (tokens.some((tok) => tok.id === required)) fiatLockedTokens.add(required);
    }
  }
  host.innerHTML = tokens
    .map((token) => {
      const locked =
        (fiatMode && fiatLockedTokens.has(token.id)) || (!fiatMode && needsTron && token.id === "USDT");
      const selected =
        locked ||
        (previous.size > 0 ? previous.has(token.id) : fiatMode ? fiatLockedTokens.has(token.id) : true);
      return `
        <label class="check">
          <input type="checkbox" name="tokens" value="${token.id}"
            ${selected ? "checked" : ""} ${locked ? "disabled" : ""} />
          ${token.label}${locked && needsTron && token.id === "USDT" ? ` · ${t("create.usdtRequiredForTron")}` : ""}
        </label>`;
    })
    .join("");

  if (!fiatMode && needsTron) {
    host.insertAdjacentHTML(
      "beforeend",
      `<input type="hidden" name="tokens" value="USDT" data-tron-usdt-lock="1" />`
    );
  }
  if (fiatMode) {
    for (const token of fiatLockedTokens) {
      host.insertAdjacentHTML(
        "beforeend",
        `<input type="hidden" name="tokens" value="${token}" data-fiat-token-lock="1" />`
      );
    }
  }
}

export type WizardStep = 1 | 2 | 3;

/**
 * Chain/token pickers are irrelevant for fiat (locked rails) or when the
 * deployment surface has exactly one chain with exactly one token.
 */
export function isChainTokenSkippable(root: HTMLElement): boolean {
  if (selectedPaymentMode(root) === "fiat") return true;
  const chainInputs = [...root.querySelectorAll<HTMLInputElement>('input[name="chains"]')];
  if (chainInputs.length !== 1) return false;
  const chainId = chainInputs[0]!.value;
  return tokensForChains([chainId]).length === 1;
}

/** Ensure singleton chain+token are selected before skipping the pickers. */
export function applySingletonChainToken(root: HTMLElement): void {
  if (selectedPaymentMode(root) === "fiat") return;
  const chainInputs = [...root.querySelectorAll<HTMLInputElement>('input[name="chains"]')];
  if (chainInputs.length !== 1) return;
  const only = chainInputs[0]!;
  only.checked = true;
  const tokens = tokensForChains([only.value]);
  if (tokens.length !== 1) return;
  renderTokenOptions(root, [only.value]);
  for (const el of root.querySelectorAll<HTMLInputElement>('input[name="tokens"]')) {
    el.checked = el.value === tokens[0]!.id;
  }
}

export function syncChainTokenPickerVisibility(root: HTMLElement): void {
  const skip = isChainTokenSkippable(root);
  const chainField = root.querySelector<HTMLElement>("#chain-select-field");
  const tokenField = root.querySelector<HTMLElement>("#token-select-field");
  if (chainField) chainField.hidden = skip;
  if (tokenField) tokenField.hidden = skip;
}

/** True when step 2 wallets (and locked rails) already validate. */
export function step2Ready(root: HTMLElement): boolean {
  try {
    validateStep(root, 2);
    return true;
  } catch {
    return false;
  }
}

/** Whether the Network stepper item can be omitted (skip 1→3). */
export function canOmitNetworkStep(root: HTMLElement): boolean {
  return isChainTokenSkippable(root) && step2Ready(root);
}

/** Validate only the fields owned by a step. Throws with localized Error. */
export function validateStep(root: HTMLElement, step: WizardStep): void {
  if (step === 1) {
    // Details are all optional except invoice type (always has a selection).
    return;
  }
  if (step === 2) {
    const chains = checked(root, "chains");
    const tokens = checked(root, "tokens");
    if (chains.length === 0) throw new Error(t("errors.missingNetwork"));
    if (tokens.length === 0) throw new Error(t("errors.missingToken"));
    const needsTron = chains.some((id) => networkKind(id) === "tron");
    if (needsTron && !tokens.includes("USDT")) throw new Error(t("errors.usdtRequiredForTron"));
    for (const chainId of chains) {
      if (!tokens.some((token) => tokenAllowedOnChain(chainId, token))) {
        throw new Error(t("errors.noCompatibleToken", { chainId }));
      }
    }
    const needsEvm = chains.some((id) => networkKind(id) === "evm");
    const needsSolana = chains.some((id) => networkKind(id) === "solana");
    if (needsEvm && !fieldValue(root, "toEvm")) throw new Error(t("errors.evmWalletRequired"));
    if (needsEvm) normalizeAddress(fieldValue(root, "toEvm"), "evm");
    if (needsTron && !fieldValue(root, "toTron")) throw new Error(t("errors.tronWalletRequired"));
    if (needsTron) normalizeAddress(fieldValue(root, "toTron"), "tron");
    if (needsSolana && !fieldValue(root, "toSolana")) throw new Error(t("errors.solanaWalletRequired"));
    if (needsSolana) normalizeAddress(fieldValue(root, "toSolana"), "solana");
    return;
  }
  // step 3
  const price = fieldValue(root, "price");
  if (!price) throw new Error(t("errors.missingPrice"));
  const mode = selectedPaymentMode(root);
  if (mode === "fiat") {
    if (!root.dataset.quotedSettlement || root.dataset.quotedSettlement === "0") {
      throw new Error(t("create.quoteError"));
    }
  }
}

export function readForm(root: HTMLElement): PayLinkFields {
  validateStep(root, 2);
  validateStep(root, 3);

  const price = fieldValue(root, "price");
  const clientInvoiceId = fieldValue(root, "clientInvoiceId") || undefined;
  const chains = checked(root, "chains");
  const tokens = checked(root, "tokens");
  const needsEvm = chains.some((id) => networkKind(id) === "evm");
  const needsTron = chains.some((id) => networkKind(id) === "tron");
  const needsSolana = chains.some((id) => networkKind(id) === "solana");

  const to: string[] = [];
  if (needsEvm) to.push(normalizeAddress(fieldValue(root, "toEvm"), "evm"));
  if (needsTron) to.push(normalizeAddress(fieldValue(root, "toTron"), "tron"));
  if (needsSolana) to.push(normalizeAddress(fieldValue(root, "toSolana"), "solana"));

  const mode = selectedPaymentMode(root);
  const includeFiat = mode === "fiat" || mode === "crypto_or_fiat";

  return {
    price: mode === "fiat" ? root.dataset.quotedSettlement || "0" : price,
    to,
    chains,
    tokens,
    clientInvoiceId,
    callback: fieldValue(root, "callback") || undefined,
    title: fieldValue(root, "title") || undefined,
    description: fieldValue(root, "description") || undefined,
    allowPartial:
      mode === "fiat" ? false : (root.querySelector<HTMLInputElement>("#allowPartial")?.checked ?? false),
    paymentMode: mode,
    ...(fieldValue(root, "lang") ? { lang: fieldValue(root, "lang") } : {}),
    ...(includeFiat
      ? {
          displayFiat: fieldValue(root, "displayFiat") || root.dataset.quotedDisplayFiat || undefined,
          displayAmount:
            mode === "fiat"
              ? price || root.dataset.quotedDisplayAmount
              : root.dataset.quotedDisplayAmount || undefined,
          quoteCountry: fieldValue(root, "quoteCountry") || "us",
          quotePaymentMethod: fieldValue(root, "quotePaymentMethod") || undefined,
          quoteProvider: fieldValue(root, "quoteProvider") || root.dataset.quotedProvider || undefined,
          quoteSlippageBps: (() => {
            const pct = Number(fieldValue(root, "quoteSlippagePct") || "1");
            if (!Number.isFinite(pct) || pct < 0) return 100;
            return Math.round(pct * 100);
          })(),
          ...(mode === "fiat"
            ? { price: root.dataset.quotedSettlement || "0", displayAmount: price || root.dataset.quotedDisplayAmount }
            : {}),
        }
      : {}),
  };
}

export function readFormLoose(root: HTMLElement): PayLinkFields {
  const chains = checked(root, "chains");
  const tokens = checked(root, "tokens");
  const needsEvm = chains.some((id) => networkKind(id) === "evm");
  const needsTron = chains.some((id) => networkKind(id) === "tron");
  const needsSolana = chains.some((id) => networkKind(id) === "solana");

  const to: string[] = [];
  if (needsEvm) to.push(fieldValue(root, "toEvm") || "0x…");
  if (needsTron) to.push(fieldValue(root, "toTron") || "T…");
  if (needsSolana) to.push(fieldValue(root, "toSolana") || "So…");

  return {
    price: fieldValue(root, "price") || "0",
    to: to.length > 0 ? to : ["0x…"],
    chains: chains.length > 0 ? chains : ["11155111"],
    tokens: tokens.length > 0 ? tokens : ["USDC"],
    clientInvoiceId: fieldValue(root, "clientInvoiceId") || undefined,
    callback: fieldValue(root, "callback") || undefined,
    title: fieldValue(root, "title") || undefined,
    description: fieldValue(root, "description") || undefined,
    allowPartial: root.querySelector<HTMLInputElement>("#allowPartial")?.checked ?? false,
    paymentMode: selectedPaymentMode(root),
    ...(fieldValue(root, "lang") ? { lang: fieldValue(root, "lang") } : {}),
  };
}
