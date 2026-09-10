import { useCallback, useEffect, useMemo, useState } from "react";
import { encodePayLink, payPath } from "@/shared/invoice.js";
import { withPayChrome, type PayChrome } from "@/shared/pay-chrome.js";
import { copyText } from "@/shared/dom.js";
import { localizeError } from "@/i18n/errors.js";
import { createCounterfactualWallet } from "@/shared/wallet-create.js";
import { loadWalletSession, listWalletRegistry } from "@/shared/wallet-session.js";
import {
  deploymentMode,
  networkKind,
  normalizeAddress,
  tokenAllowedOnChain,
  tokensForChains,
  type ChainKind,
  type NetworkOption,
  networksForDeployment,
} from "@/shared/networks.js";
import { apiUrl } from "@/shared/site.js";
import type { PayLinkFields, PaymentMode } from "@/shared/types.js";
import { type FiatField } from "@/pages/create/fiat-rules.js";
import {
  fiatMinimumChainIds,
  fiatMinimumTokenForChain,
  type WizardStep,
} from "@/pages/create/form.js";
import { loadCreatePrefs, patchCreatePrefs, pickRemembered } from "@/pages/create/prefs.js";
import { useLocale } from "@/providers/LocaleProvider";

export interface TokenCheckbox {
  id: string;
  label: string;
  checked: boolean;
  locked: boolean;
  lockHint?: string;
}

export interface ChainCheckbox {
  network: NetworkOption;
  checked: boolean;
  disabled: boolean;
  locked: boolean;
}

export interface CreatePreview {
  link: string;
  path: string;
  embed: string;
  iframe: string;
  payLabel: string;
  error?: string;
}

export interface CreateFormState {
  clientInvoiceId: string;
  title: string;
  description: string;
  callback: string;
  lang: string;
  paymentMode: PaymentMode;
  chains: string[];
  tokens: string[];
  toEvm: string;
  toTron: string;
  toSolana: string;
  toEvmReadOnly: boolean;
  walletPickerValue: string;
  passkeyWalletAddress: string | null;
  toEvmError: string | null;
  toTronError: string | null;
  toSolanaError: string | null;
  price: string;
  allowPartial: boolean;
  displayFiat: string;
  quoteCountry: string;
  quotePaymentMethod: string;
  quoteProvider: string;
  quoteSlippagePct: string;
  onrampEnabled: boolean;
  onrampSandbox: boolean;
  onrampPairs: Array<{ chainId: string; token: string }>;
  onrampFiats: string[];
  quotePaymentMethods: Array<{ id: string; name: string }>;
  quoteProviders: Array<{ provider: string; paymentMethod: string; fiatAmount: string; cryptoAmount: string }>;
  fiatChargePreview: string | null;
  fiatQuoteStatus: string | null;
  amountLimits: string | null;
  quotedSettlement: string | null;
  quotedDisplayAmount: string | null;
  quotedDisplayFiat: string | null;
  quotedProvider: string | null;
  quotedChainId: string | null;
  quotedToken: string | null;
  currentStep: WizardStep;
  payChrome: PayChrome;
  formActionStatus: string | null;
  formActionError: boolean;
  copyStatus: string | null;
  passkeyBusy: boolean;
}

function onrampSupportedSet(pairs: Array<{ chainId: string; token: string }>): Set<string> {
  return new Set(pairs.map((p) => `${p.chainId}:${p.token.toUpperCase()}`));
}

function chainHasOnrampSupport(pairs: Array<{ chainId: string; token: string }>, chainId: string): boolean {
  const supported = onrampSupportedSet(pairs);
  return supported.has(`${chainId}:USDC`) || supported.has(`${chainId}:USDT`);
}

function effectivePaymentMode(onrampEnabled: boolean, paymentMode: PaymentMode): PaymentMode {
  if (!onrampEnabled) return "crypto";
  return paymentMode;
}

function isChainTokenSkippable(state: CreateFormState, networks: NetworkOption[]): boolean {
  const mode = effectivePaymentMode(state.onrampEnabled, state.paymentMode);
  if (mode === "fiat" || mode === "crypto_or_fiat") return true;
  const enabled = networks.filter((n) => n.enabled !== false);
  if (enabled.length !== 1) return false;
  return tokensForChains([enabled[0]!.id]).length === 1;
}

type Translate = (key: string, vars?: Record<string, string>) => string;

function validateStepState(state: CreateFormState, step: WizardStep, tr: Translate): void {
  const mode = effectivePaymentMode(state.onrampEnabled, state.paymentMode);
  if (step === 1) return;
  if (step === 2) {
    if (state.chains.length === 0) throw new Error(tr("errors.missingNetwork"));
    if (state.tokens.length === 0) throw new Error(tr("errors.missingToken"));
    const needsTron = state.chains.some((id) => networkKind(id) === "tron");
    if (needsTron && !state.tokens.includes("USDT")) throw new Error(tr("errors.usdtRequiredForTron"));
    for (const chainId of state.chains) {
      if (!state.tokens.some((token) => tokenAllowedOnChain(chainId, token))) {
        throw new Error(tr("errors.noCompatibleToken", { chainId }));
      }
    }
    const needsEvm = state.chains.some((id) => networkKind(id) === "evm");
    const needsSolana = state.chains.some((id) => networkKind(id) === "solana");
    if (needsEvm && !state.toEvm.trim()) throw new Error(tr("errors.evmWalletRequired"));
    if (needsEvm) normalizeAddress(state.toEvm.trim(), "evm");
    if (needsTron && !state.toTron.trim()) throw new Error(tr("errors.tronWalletRequired"));
    if (needsTron) normalizeAddress(state.toTron.trim(), "tron");
    if (needsSolana && !state.toSolana.trim()) throw new Error(tr("errors.solanaWalletRequired"));
    if (needsSolana) normalizeAddress(state.toSolana.trim(), "solana");
    return;
  }
  if (!state.price.trim()) throw new Error(tr("errors.missingPrice"));
}

function readFormFromState(state: CreateFormState, tr: Translate): PayLinkFields {
  validateStepState(state, 2, tr);
  validateStepState(state, 3, tr);

  const mode = effectivePaymentMode(state.onrampEnabled, state.paymentMode);
  const price = state.price.trim();
  const chains = state.chains;
  const tokens = state.tokens;
  const needsEvm = chains.some((id) => networkKind(id) === "evm");
  const needsTron = chains.some((id) => networkKind(id) === "tron");
  const needsSolana = chains.some((id) => networkKind(id) === "solana");

  const to: string[] = [];
  if (needsEvm) to.push(normalizeAddress(state.toEvm.trim(), "evm"));
  if (needsTron) to.push(normalizeAddress(state.toTron.trim(), "tron"));
  if (needsSolana) to.push(normalizeAddress(state.toSolana.trim(), "solana"));

  const includeFiat = mode === "fiat" || mode === "crypto_or_fiat";

  return {
    price: price || "0",
    to,
    chains,
    tokens,
    clientInvoiceId: state.clientInvoiceId.trim() || undefined,
    callback: state.callback.trim() || undefined,
    title: state.title.trim() || undefined,
    description: state.description.trim() || undefined,
    allowPartial: mode === "fiat" ? false : state.allowPartial,
    paymentMode: mode,
    ...(state.lang.trim() ? { lang: state.lang.trim() } : {}),
    ...(includeFiat
      ? {
          displayFiat: state.displayFiat || undefined,
          displayAmount: state.displayFiat ? price || undefined : undefined,
          quoteCountry: state.quoteCountry.trim() || undefined,
        }
      : {}),
  };
}

function readFormLooseFromState(state: CreateFormState): PayLinkFields {
  const chains = state.chains;
  const tokens = state.tokens;
  const needsEvm = chains.some((id) => networkKind(id) === "evm");
  const needsTron = chains.some((id) => networkKind(id) === "tron");
  const needsSolana = chains.some((id) => networkKind(id) === "solana");

  const to: string[] = [];
  if (needsEvm) to.push(state.toEvm.trim() || "0x…");
  if (needsTron) to.push(state.toTron.trim() || "T…");
  if (needsSolana) to.push(state.toSolana.trim() || "So…");

  return {
    price: state.price.trim() || "0",
    to: to.length > 0 ? to : ["0x…"],
    chains: chains.length > 0 ? chains : ["11155111"],
    tokens: tokens.length > 0 ? tokens : ["USDC"],
    clientInvoiceId: state.clientInvoiceId.trim() || undefined,
    callback: state.callback.trim() || undefined,
    title: state.title.trim() || undefined,
    description: state.description.trim() || undefined,
    allowPartial: state.allowPartial,
    paymentMode: effectivePaymentMode(state.onrampEnabled, state.paymentMode),
    ...(state.lang.trim() ? { lang: state.lang.trim() } : {}),
  };
}

function computeTokenOptions(state: CreateFormState, tr: Translate): TokenCheckbox[] {
  const mode = effectivePaymentMode(state.onrampEnabled, state.paymentMode);
  const fiatMode = mode === "fiat" || mode === "crypto_or_fiat";
  const supported = onrampSupportedSet(state.onrampPairs);
  let tokens = tokensForChains(state.chains);
  if (fiatMode && supported.size > 0) {
    tokens = tokens.filter((token) => state.chains.some((chainId) => supported.has(`${chainId}:${token.id}`)));
  }
  const needsTron = state.chains.some((id) => networkKind(id) === "tron");
  if (tokens.length === 0) return [];

  const fiatLockedTokens = new Set<string>();
  if (fiatMode) {
    for (const chainId of state.chains) {
      const required = fiatMinimumTokenForChain(chainId);
      if (tokens.some((tok) => tok.id === required)) fiatLockedTokens.add(required);
    }
  }

  const previous = new Set(state.tokens);
  return tokens.map((token) => {
    const locked =
      (fiatMode && fiatLockedTokens.has(token.id)) || (!fiatMode && needsTron && token.id === "USDT");
    const selected =
      locked || (previous.size > 0 ? previous.has(token.id) : fiatMode ? fiatLockedTokens.has(token.id) : true);
    return {
      id: token.id,
      label: token.label,
      checked: selected,
      locked,
      lockHint: locked && needsTron && token.id === "USDT" ? tr("create.usdtRequiredForTron") : undefined,
    };
  });
}

function resolveTokensFromOptions(options: TokenCheckbox[]): string[] {
  return options.filter((o) => o.checked || o.locked).map((o) => o.id);
}

function applyFiatChainLocks(
  state: CreateFormState,
  networks: NetworkOption[]
): { chains: string[]; chainRows: ChainCheckbox[] } {
  const mode = effectivePaymentMode(state.onrampEnabled, state.paymentMode);
  const chainRows: ChainCheckbox[] = networks.map((network) => ({
    network,
    checked: state.chains.includes(network.id),
    disabled: false,
    locked: false,
  }));

  if (mode !== "fiat" && mode !== "crypto_or_fiat") {
    let chains = state.chains.filter((id) => networks.some((n) => n.id === id));
    if (chains.length === 0 && networks[0]) chains = [networks[0].id];
    return {
      chains,
      chainRows: chainRows.map((row) => ({
        ...row,
        checked: chains.includes(row.network.id),
        disabled: false,
        locked: false,
      })),
    };
  }

  const minimum = new Set(
    fiatMinimumChainIds().filter((id) =>
      networks.some((n) => n.id === id && chainHasOnrampSupport(state.onrampPairs, id))
    )
  );
  if (minimum.size === 0) {
    for (const n of networks) {
      if (chainHasOnrampSupport(state.onrampPairs, n.id)) minimum.add(n.id);
    }
  }

  const chains: string[] = [];
  const rows = chainRows.map((row) => {
    const chainSupported = chainHasOnrampSupport(state.onrampPairs, row.network.id);
    const locked = minimum.has(row.network.id);
    if (locked) {
      chains.push(row.network.id);
      return { ...row, checked: true, disabled: true, locked: true };
    }
    const checked = chainSupported && state.chains.includes(row.network.id);
    if (checked) chains.push(row.network.id);
    return { ...row, checked, disabled: !chainSupported, locked: false };
  });

  return { chains, chainRows: rows };
}

function initialState(): CreateFormState {
  const prefs = loadCreatePrefs();
  const mode = deploymentMode();
  const networks = networksForDeployment(mode);
  const defaultChains = networks.length > 0 ? [networks[0]!.id] : [];

  return {
    clientInvoiceId: `order-${Date.now().toString(36)}`,
    title: "",
    description: "",
    callback: "",
    lang: "",
    paymentMode: (prefs.paymentMode as PaymentMode) || "crypto_or_fiat",
    chains: defaultChains,
    tokens: ["USDC"],
    toEvm: prefs.walletEvm || "",
    toTron: prefs.walletTron || "",
    toSolana: prefs.walletSolana || "",
    toEvmReadOnly: false,
    walletPickerValue: "__custom__",
    passkeyWalletAddress: null,
    toEvmError: null,
    toTronError: null,
    toSolanaError: null,
    price: "10.00",
    allowPartial: false,
    displayFiat: prefs.displayFiat || "SEK",
    quoteCountry: prefs.quoteCountry || "se",
    quotePaymentMethod: prefs.quotePaymentMethod || "",
    quoteProvider: prefs.quoteProvider || "",
    quoteSlippagePct: prefs.quoteSlippagePct || "1",
    onrampEnabled: false,
    onrampSandbox: false,
    onrampPairs: [],
    onrampFiats: [],
    quotePaymentMethods: [],
    quoteProviders: [],
    fiatChargePreview: null,
    fiatQuoteStatus: null,
    amountLimits: null,
    quotedSettlement: null,
    quotedDisplayAmount: null,
    quotedDisplayFiat: null,
    quotedProvider: null,
    quotedChainId: null,
    quotedToken: null,
    currentStep: 1,
    payChrome: "full",
    formActionStatus: null,
    formActionError: false,
    copyStatus: null,
    passkeyBusy: false,
  };
}

export function useCreateForm() {
  const { t, locale } = useLocale();

  const [state, setState] = useState<CreateFormState>(() => initialState());

  const mode = deploymentMode();
  const networks = useMemo(() => networksForDeployment(mode), [mode]);
  const modeLabel = mode === "testnet" ? t("common.testnet") : t("common.mainnet");
  const walletRegistry = useMemo(() => listWalletRegistry(), []);

  const paymentMode = effectivePaymentMode(state.onrampEnabled, state.paymentMode);
  const tokenOptions = useMemo(() => computeTokenOptions(state, t), [state, t]);
  const effectiveTokens = useMemo(() => resolveTokensFromOptions(tokenOptions), [tokenOptions]);

  const stateWithTokens = useMemo(() => ({ ...state, tokens: effectiveTokens }), [state, effectiveTokens]);

  const { chains: effectiveChains, chainRows } = useMemo(
    () => applyFiatChainLocks(stateWithTokens, networks),
    [stateWithTokens, networks]
  );

  const fullState = useMemo(
    () => ({ ...stateWithTokens, chains: effectiveChains }),
    [stateWithTokens, effectiveChains]
  );

  const needsEvm = effectiveChains.some((id) => networkKind(id) === "evm");
  const needsTron = effectiveChains.some((id) => networkKind(id) === "tron");
  const needsSolana = effectiveChains.some((id) => networkKind(id) === "solana");
  const skipChainToken = isChainTokenSkippable(fullState, networks);

  const step2Ready = useMemo(() => {
    try {
      validateStepState(fullState, 2, t);
      return true;
    } catch {
      return false;
    }
  }, [fullState, t]);

  useEffect(() => {
    const resolved = resolveTokensFromOptions(tokenOptions);
    setState((prev) => {
      if (prev.tokens.length === resolved.length && prev.tokens.every((tok, i) => tok === resolved[i])) {
        return prev;
      }
      return { ...prev, tokens: resolved };
    });
  }, [tokenOptions]);

  const omitNetworkStep = skipChainToken && step2Ready;

  const persistPrefs = useCallback(
    (patch?: Partial<CreateFormState>) => {
      const s = { ...fullState, ...patch };
      patchCreatePrefs({
        walletEvm: s.toEvm.trim() || undefined,
        walletTron: s.toTron.trim() || undefined,
        walletSolana: s.toSolana.trim() || undefined,
        displayFiat: s.displayFiat || undefined,
        quoteCountry: s.quoteCountry.trim() || undefined,
        quotePaymentMethod: s.quotePaymentMethod || undefined,
        quoteProvider: s.quoteProvider || undefined,
        quoteSlippagePct: s.quoteSlippagePct || undefined,
        paymentMode: effectivePaymentMode(s.onrampEnabled, s.paymentMode),
      });
    },
    [fullState]
  );

  const markAddress = useCallback(
    (inputId: "toEvm" | "toTron" | "toSolana", kind: ChainKind, value: string) => {
      const errorKey = `${inputId}Error` as const;
      if (!value.trim()) {
        setState((prev) => ({ ...prev, [errorKey]: null }));
        return;
      }
      try {
        normalizeAddress(value.trim(), kind);
        setState((prev) => ({ ...prev, [errorKey]: null }));
      } catch (error) {
        const message = error instanceof Error ? localizeError(error) : t("errors.invalidAddress");
        setState((prev) => ({ ...prev, [errorKey]: message }));
      }
    },
    [t]
  );

  const runFiatCascade = useCallback(
    (_field: FiatField) => {
      persistPrefs();
    },
    [persistPrefs]
  );

  const loadOnrampConfig = useCallback(async () => {
    try {
      const res = await fetch(apiUrl("/api/public/pay-in/config"));
      if (!res.ok) return;
      const body = (await res.json()) as { enabled?: boolean; chainId?: string; token?: string };
      const prefs = loadCreatePrefs();
      const enabled =
        Boolean(body.enabled) &&
        networksForDeployment().some((n) => n.id === (body.chainId ?? "8453"));
      const pairs = enabled
        ? [{ chainId: body.chainId ?? "8453", token: (body.token ?? "USDC").toUpperCase() }]
        : [];
      const fiats = ["USD", "EUR", "GBP", "SEK"];
      setState((prev) => {
        let displayFiat = prev.displayFiat;
        let paymentMode = prev.paymentMode;
        if (enabled) {
          displayFiat = pickRemembered(fiats, prefs.displayFiat, fiats.includes("SEK") ? "SEK" : fiats[0]!);
          const remembered = prefs.paymentMode;
          paymentMode =
            remembered === "crypto" || remembered === "crypto_or_fiat" || remembered === "fiat"
              ? remembered
              : "crypto_or_fiat";
        }
        return {
          ...prev,
          onrampEnabled: enabled,
          onrampSandbox: false,
          onrampPairs: pairs,
          onrampFiats: fiats,
          displayFiat,
          paymentMode,
        };
      });
    } catch {
      /* onramp hidden */
    }
  }, []);

  useEffect(() => {
    void loadOnrampConfig();
    const session = loadWalletSession();
    const prefs = loadCreatePrefs();
    if (session?.address) {
      setState((prev) => ({
        ...prev,
        toEvm: session.address,
        toEvmReadOnly: true,
        passkeyWalletAddress: session.address,
        walletPickerValue: session.address,
      }));
    } else if (prefs.walletEvm) {
      setState((prev) => ({ ...prev, toEvm: prefs.walletEvm! }));
    }
    if (location.hash === "#docs") {
      document.getElementById("create-docs")?.scrollIntoView({ behavior: "smooth" });
    }
  }, [loadOnrampConfig]);

  const preview = useMemo((): CreatePreview | null => {
    try {
      const fields = readFormFromState(fullState, t);
      const path = withPayChrome(payPath(fields), state.payChrome);
      const link = `${location.origin}${path}`;
      const iframePath = withPayChrome(payPath(fields), "none");
      const iframeSrc = `${location.origin}${iframePath}`;
      const payLabel = t("create.payWithCrypto", { price: fields.price });
      const embed = `<a href="${link}" class="tc-pay-button" target="_blank" rel="noopener noreferrer">${payLabel}</a>`;
      const iframe = `<iframe src="${iframeSrc}" title="${payLabel}" style="width:100%;min-height:720px;border:0" allow="payment *"></iframe>`;
      return { link, path, embed, iframe, payLabel };
    } catch (error) {
      return {
        link: "",
        path: "",
        embed: "",
        iframe: "",
        payLabel: "",
        error: error instanceof Error ? localizeError(error) : t("common.incomplete"),
      };
    }
  }, [fullState, state.payChrome, t]);

  const docsQueryLink = useMemo(() => {
    try {
      const fields = readFormLooseFromState(fullState);
      return `${location.origin}${withPayChrome(`/pay?${encodePayLink(fields)}`, state.payChrome)}`;
    } catch {
      return `${location.origin}/pay?…`;
    }
  }, [fullState, state.payChrome]);

  const setField = useCallback(<K extends keyof CreateFormState>(key: K, value: CreateFormState[K]) => {
    setState((prev) => ({ ...prev, [key]: value, formActionStatus: null, formActionError: false }));
  }, []);

  const toggleChain = useCallback(
    (chainId: string, checked: boolean) => {
      setState((prev) => {
        let chains = [...prev.chains];
        if (checked) {
          if (!chains.includes(chainId)) chains.push(chainId);
        } else {
          chains = chains.filter((id) => id !== chainId);
          if (chains.length === 0) chains = [chainId];
        }
        return { ...prev, chains };
      });
    },
    []
  );

  const toggleToken = useCallback((tokenId: string, checked: boolean) => {
    setState((prev) => {
      let tokens = [...prev.tokens];
      if (checked) {
        if (!tokens.includes(tokenId)) tokens.push(tokenId);
      } else {
        tokens = tokens.filter((id) => id !== tokenId);
      }
      return { ...prev, tokens };
    });
  }, []);

  const applySingletonChainToken = useCallback(() => {
    if (paymentMode === "fiat") return;
    const enabled = networks.filter((n) => n.enabled !== false);
    if (enabled.length !== 1) return;
    const only = enabled[0]!;
    const tokens = tokensForChains([only.id]);
    if (tokens.length !== 1) return;
    setState((prev) => ({
      ...prev,
      chains: [only.id],
      tokens: [tokens[0]!.id],
    }));
  }, [networks, paymentMode]);

  const goToStep = useCallback((step: WizardStep) => {
    setState((prev) => ({
      ...prev,
      currentStep: step,
      formActionStatus: null,
      formActionError: false,
    }));
  }, []);

  const wizardNext = useCallback(() => {
    try {
      validateStepState(fullState, state.currentStep, t);
      if (state.currentStep === 1) {
        applySingletonChainToken();
        goToStep(omitNetworkStep ? 3 : 2);
      } else if (state.currentStep === 2) {
        goToStep(3);
      }
    } catch (error) {
      setState((prev) => ({
        ...prev,
        formActionStatus: error instanceof Error ? localizeError(error) : t("errors.fillRequired"),
        formActionError: true,
      }));
    }
  }, [fullState, state.currentStep, applySingletonChainToken, goToStep, omitNetworkStep, t]);

  const wizardBack = useCallback(() => {
    if (state.currentStep === 3) {
      applySingletonChainToken();
      goToStep(omitNetworkStep ? 1 : 2);
    } else if (state.currentStep === 2) {
      goToStep(1);
    }
  }, [state.currentStep, applySingletonChainToken, goToStep, omitNetworkStep]);

  const gotoStepClick = useCallback(
    (n: WizardStep) => {
      if (n === 2 && omitNetworkStep) return;
      if (n < state.currentStep) {
        goToStep(n);
        return;
      }
      if (n > state.currentStep) {
        try {
          for (let s = state.currentStep; s < n; s++) {
            if (s === 2 && omitNetworkStep) continue;
            validateStepState(fullState, s as WizardStep, t);
          }
          if (n === 3 && state.currentStep === 1) {
            applySingletonChainToken();
            if (!omitNetworkStep) validateStepState(fullState, 2, t);
          }
          goToStep(n);
        } catch (error) {
          setState((prev) => ({
            ...prev,
            formActionStatus: error instanceof Error ? localizeError(error) : t("errors.fillRequired"),
            formActionError: true,
          }));
        }
      }
    },
    [state.currentStep, omitNetworkStep, goToStep, fullState, applySingletonChainToken, t]
  );

  const handleSubmit = useCallback(async (): Promise<boolean> => {
    try {
      const fields = readFormFromState(fullState, t);
      if (paymentMode === "fiat" && (!fields.price || fields.price === "0")) {
        throw new Error(t("errors.missingPrice"));
      }
      persistPrefs();
      setState((prev) => ({ ...prev, formActionStatus: null, formActionError: false }));
      return true;
    } catch (error) {
      setState((prev) => ({
        ...prev,
        formActionStatus: error instanceof Error ? localizeError(error) : t("errors.fillRequired"),
        formActionError: true,
      }));
      return false;
    }
  }, [paymentMode, fullState, persistPrefs, t]);

  const copyPayLink = useCallback(async () => {
    if (!preview?.link) return;
    await copyText(preview.link);
    setState((prev) => ({ ...prev, formActionStatus: t("create.payLinkCopied"), formActionError: false }));
  }, [preview, t]);

  const copyEmbed = useCallback(async () => {
    if (!preview?.embed) return;
    await copyText(preview.embed);
    setState((prev) => ({ ...prev, copyStatus: t("create.embedCopied") }));
  }, [preview, t]);

  const copyIframe = useCallback(async () => {
    if (!preview?.iframe) return;
    await copyText(preview.iframe);
    setState((prev) => ({ ...prev, copyStatus: t("create.iframeCopied") }));
  }, [preview, t]);

  const usePasskeyWallet = useCallback(async () => {
    setState((prev) => ({ ...prev, passkeyBusy: true }));
    try {
      const existing = loadWalletSession();
      if (existing?.address) {
        setState((prev) => ({
          ...prev,
          toEvm: existing.address,
          toEvmReadOnly: true,
          passkeyWalletAddress: existing.address,
          walletPickerValue: existing.address,
          formActionStatus: t("create.passkeyWalletFilled"),
          formActionError: false,
        }));
        patchCreatePrefs({ walletEvm: existing.address });
        return;
      }
      const { address } = await createCounterfactualWallet(t("create.passkeyWalletDeviceLabel"));
      setState((prev) => ({
        ...prev,
        toEvm: address,
        toEvmReadOnly: true,
        passkeyWalletAddress: address,
        walletPickerValue: address,
        formActionStatus: t("create.passkeyWalletCreated"),
        formActionError: false,
      }));
      patchCreatePrefs({ walletEvm: address });
    } catch (error) {
      setState((prev) => ({
        ...prev,
        formActionStatus: error instanceof Error ? error.message : t("create.passkeyWalletFailed"),
        formActionError: true,
      }));
    } finally {
      setState((prev) => ({ ...prev, passkeyBusy: false }));
    }
  }, [t]);

  const clearPasskeyWallet = useCallback(() => {
    setState((prev) => ({
      ...prev,
      toEvm: "",
      toEvmReadOnly: false,
      passkeyWalletAddress: null,
      walletPickerValue: "__custom__",
    }));
  }, []);

  const onWalletPickerChange = useCallback(
    (value: string) => {
      const prefs = loadCreatePrefs();
      if (value === "__custom__") {
        setState((prev) => ({
          ...prev,
          walletPickerValue: value,
          toEvmReadOnly: false,
          toEvm: prefs.walletEvm && !walletRegistry.some((w) => w.address === prefs.walletEvm) ? prefs.walletEvm : "",
        }));
      } else {
        setState((prev) => ({
          ...prev,
          walletPickerValue: value,
          toEvm: value,
          toEvmReadOnly: true,
        }));
        patchCreatePrefs({ walletEvm: value });
      }
    },
    [walletRegistry]
  );

  const onPaymentModeChange = useCallback(
    (mode: PaymentMode) => {
      setState((prev) => ({ ...prev, paymentMode: mode }));
      persistPrefs({ paymentMode: mode });
    },
    [persistPrefs]
  );

  const onFiatFieldChange = useCallback(
    (field: FiatField, updater: (prev: CreateFormState) => CreateFormState) => {
      setState((prev) => updater(prev));
      runFiatCascade(field);
      persistPrefs();
    },
    [runFiatCascade, persistPrefs]
  );

  return {
    state: fullState,
    setField,
    toggleChain,
    toggleToken,
    chainRows,
    tokenOptions,
    needsEvm,
    needsTron,
    needsSolana,
    skipChainToken,
    omitNetworkStep,
    paymentMode,
    mode,
    modeLabel,
    networks,
    walletRegistry,
    preview,
    docsQueryLink,
    locale,
    goToStep,
    wizardNext,
    wizardBack,
    gotoStepClick,
    handleSubmit,
    copyPayLink,
    copyEmbed,
    copyIframe,
    usePasskeyWallet,
    clearPasskeyWallet,
    onWalletPickerChange,
    onPaymentModeChange,
    markAddress,
    onFiatFieldChange,
    runFiatCascade,
    persistPrefs,
  };
}
