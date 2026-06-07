const apiBase = globalThis.FASTSWAP_API_BASE ?? "";
let activeQuote;
/** Last invoice shown in “Pay this invoice” (current session); refreshed by poller. */
let detailInvoiceId = null;
let invoicePollTimer = null;
const INVOICE_POLL_MS = 3000;

const form = document.querySelector("#swap-form");
const quotePanel = document.querySelector("#quote");
const quoteOutput = document.querySelector("#quote-output");
const invoicePanel = document.querySelector("#invoice");
const invoicePanelHeading = document.querySelector("#invoice-panel-heading");
const invoiceOutput = document.querySelector("#invoice-output");
const createInvoice = document.querySelector("#create-invoice");
const refreshInvoices = document.querySelector("#refresh-invoices");
const clearInvoiceCache = document.querySelector("#clear-invoice-cache");
const myInvoicesOutput = document.querySelector("#my-invoices-output");
const recentSwaps = document.querySelector("#recent-swaps");
const sourceChain = document.querySelector("#source-chain");
const sourceToken = document.querySelector("#source-token");
const targetChain = document.querySelector("#target-chain");
const targetToken = document.querySelector("#target-token");
const packOptions = document.querySelector("#pack-options");
const quotePreview = document.querySelector("#quote-preview");
const recipientLabel = document.querySelector("#recipient-label");
const captchaPanel = document.querySelector("#captcha-panel");
const captchaTokenInput = document.querySelector("#captcha-token");
const captchaHelp = document.querySelector("#captcha-help");
const formStatus = document.querySelector("#form-status");
const turnstileWidget = document.querySelector("#turnstile-widget");
const themeChip = document.querySelector("#theme-chip");
const targetAmountDisplay = document.querySelector("#target-amount-display");
const sourceAmountDisplay = document.querySelector("#source-amount-display");
const selectorButtons = document.querySelectorAll("[data-selector]");
const selectorModal = document.querySelector("#selector-modal");
const selectorTitle = document.querySelector("#selector-title");
const selectorSearch = document.querySelector("#selector-search");
const selectorOptions = document.querySelector("#selector-options");
const selectorCloseButtons = document.querySelectorAll("[data-selector-close]");
const tokenIconSource = document.querySelector('[data-token-icon="source"]');
const tokenIconTarget = document.querySelector('[data-token-icon="target"]');
const sourceChainLabel = document.querySelector("#source-chain-label");
const sourceTokenLabel = document.querySelector("#source-token-label");
const targetChainLabel = document.querySelector("#target-chain-label");
const targetTokenLabel = document.querySelector("#target-token-label");
let appConfig = { chains: [] };
let turnstileToken = "";
let quoteDebounceTimer = null;
let quoteRequestSeq = 0;
let activeSelector = null;
let selectorRestoreFocus = null;
const SAVED_INVOICES_KEY = "fastswap.invoiceIds";
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!activeQuote) {
    await refreshPreviewQuote({ immediate: true });
  }
  if (!activeQuote) return;
  try {
    setStatus("Creating payment invoice...");
    const values = Object.fromEntries(new FormData(form).entries());
    const savedQuote = await postJson("/quotes", buildQuoteRequest(values));
    const invoice = await postJson("/invoices", {
      quoteId: savedQuote.quoteId,
      captchaToken: getCaptchaToken(),
    });
    activeQuote = savedQuote;
    syncSwapControls();
    saveInvoiceId(invoice.invoiceId);
    if (invoicePanelHeading) {
      invoicePanelHeading.textContent = "Pay this invoice";
    }
    detailInvoiceId = invoice.invoiceId;
    invoicePanel.classList.remove("hidden");
    invoiceOutput.innerHTML = renderInvoice(invoice);
    await loadMyInvoices({ quiet: false });
    setStatus("Invoice created. Send only the exact token, chain, and amount shown.");
  } catch (error) {
    setStatus(error instanceof Error ? error.message : "Invoice creation failed.");
  }
});

createInvoice?.addEventListener("click", () => {
  form.requestSubmit();
});

form.addEventListener("input", () => {
  activeQuote = undefined;
  syncSwapControls();
  schedulePreviewQuote();
});

targetChain.addEventListener("change", () => {
  activeQuote = undefined;
  renderTargetTokenOptions();
  renderSourceTokenOptions();
  renderPackOptions();
  updateRecipientLabel();
  syncSwapControls();
  schedulePreviewQuote();
});

targetToken.addEventListener("change", () => {
  activeQuote = undefined;
  renderSourceTokenOptions();
  renderPackOptions();
  updateRecipientLabel();
  syncSwapControls();
  schedulePreviewQuote();
});

sourceChain.addEventListener("change", () => {
  activeQuote = undefined;
  renderSourceTokenOptions();
  syncSwapControls();
  schedulePreviewQuote();
});

sourceToken.addEventListener("change", () => {
  activeQuote = undefined;
  syncSwapControls();
  schedulePreviewQuote();
});

selectorButtons.forEach((button) => {
  button.addEventListener("click", () => openSelector(button.getAttribute("data-selector"), button));
});

selectorCloseButtons.forEach((button) => {
  button.addEventListener("click", closeSelector);
});

selectorSearch?.addEventListener("input", () => renderSelectorOptions());

selectorOptions?.addEventListener("click", (event) => {
  const option = event.target.closest("[data-selector-value]");
  if (!option || !selectorOptions.contains(option)) return;
  chooseSelectorValue(option.getAttribute("data-selector-value"));
});

selectorOptions?.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" && event.key !== " ") return;
  const option = event.target.closest("[data-selector-value]");
  if (!option || !selectorOptions.contains(option)) return;
  event.preventDefault();
  chooseSelectorValue(option.getAttribute("data-selector-value"));
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && activeSelector) closeSelector();
});

refreshInvoices.addEventListener("click", () => {
  void loadMyInvoices({ quiet: false });
});

clearInvoiceCache?.addEventListener("click", () => {
  clearSavedInvoices();
  activeQuote = undefined;
  detailInvoiceId = null;
  syncSwapControls();
  stopInvoicePolling();
  invoicePanel.classList.add("hidden");
  invoiceOutput.innerHTML = "";
  myInvoicesOutput.classList.add("muted");
  myInvoicesOutput.textContent = "No invoices saved in this browser yet.";
  setStatus("Saved invoice cache cleared from this browser.");
});

myInvoicesOutput.addEventListener("click", (event) => {
  const item = event.target.closest("[data-invoice-id]");
  if (!item || !myInvoicesOutput.contains(item)) return;
  const id = item.getAttribute("data-invoice-id");
  if (id) void openInvoiceDetail(id, { fromHistory: true });
});

myInvoicesOutput.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" && event.key !== " ") return;
  const item = event.target.closest("[data-invoice-id]");
  if (!item || !myInvoicesOutput.contains(item)) return;
  event.preventDefault();
  const id = item.getAttribute("data-invoice-id");
  if (id) void openInvoiceDetail(id, { fromHistory: true });
});

invoiceOutput.addEventListener("click", (event) => {
  const button = event.target.closest("[data-copy-value]");
  if (!button || !invoiceOutput.contains(button)) return;
  void copyToClipboard(button);
});

init().catch((error) => {
  recentSwaps.textContent = error instanceof Error ? error.message : "FastSwap failed to load.";
});

async function init() {
  setupAutoTheme();
  const response = await fetch(`${apiBase}/config`);
  appConfig = await response.json();
  renderTokenOptions();
  setupCaptcha();
  updateRecipientLabel();
  syncSwapControls();
  schedulePreviewQuote();
  await loadMyInvoices({ quiet: false });
  await loadRecentSwaps();
}

function setupAutoTheme() {
  const hour = new Date().getHours();
  const theme = hour >= 7 && hour < 19 ? "light" : "dark";
  document.documentElement.dataset.theme = theme;
  if (themeChip) {
    themeChip.textContent = `${theme === "dark" ? "Night" : "Day"} theme`;
  }
}

function openSelector(kind, restoreFocus) {
  if (!selectorModal || !selectorTitle || !selectorSearch || !selectorOptions) return;
  activeSelector = kind;
  selectorRestoreFocus = restoreFocus;
  selectorTitle.textContent = selectorTitleFor(kind);
  selectorSearch.value = "";
  selectorSearch.placeholder = kind?.includes("chain") ? "Search chains" : "Search tokens";
  selectorModal.classList.remove("hidden");
  selectorModal.setAttribute("aria-hidden", "false");
  renderSelectorOptions();
  requestAnimationFrame(() => selectorSearch.focus());
}

function closeSelector() {
  if (!selectorModal) return;
  selectorModal.classList.add("hidden");
  selectorModal.setAttribute("aria-hidden", "true");
  activeSelector = null;
  selectorRestoreFocus?.focus?.();
  selectorRestoreFocus = null;
}

function selectorTitleFor(kind) {
  switch (kind) {
    case "target-chain":
      return "Select receive chain";
    case "target-token":
      return "Select receive token";
    case "source-chain":
      return "Select payment chain";
    case "source-token":
      return "Select payment token";
    default:
      return "Select";
  }
}

function renderSelectorOptions() {
  if (!selectorOptions || !activeSelector) return;
  const query = selectorSearch?.value.trim().toLowerCase() ?? "";
  const options = selectorItems(activeSelector).filter((item) => {
    const haystack = `${item.label} ${item.meta ?? ""}`.toLowerCase();
    return haystack.includes(query);
  });
  if (options.length === 0) {
    selectorOptions.innerHTML = `<p class="muted fineprint">No matches found.</p>`;
    return;
  }
  selectorOptions.innerHTML = options
    .map((item) => {
      const selected = item.value === currentSelectorValue(activeSelector);
      return `
        <button
          type="button"
          class="selector-option"
          data-selector-value="${escapeHtml(item.value)}"
          role="option"
          aria-selected="${selected ? "true" : "false"}"
        >
          <span class="token-icon">${escapeHtml(item.icon)}</span>
          <span>
            <strong>${escapeHtml(item.label)}</strong>
            ${item.meta ? `<span class="selector-option__meta">${escapeHtml(item.meta)}</span>` : ""}
          </span>
        </button>
      `;
    })
    .join("");
}

function selectorItems(kind) {
  if (kind?.includes("chain")) {
    return appConfig.chains.map((chain) => ({
      value: String(chain.id),
      label: chain.name,
      meta: `Chain ${chain.id}`,
      icon: chain.name?.slice(0, 1) ?? "?",
    }));
  }

  const chain = kind === "target-token" ? findChain(targetChain.value) : findChain(sourceChain.value);
  const target = selectedTarget();
  return (chain?.tokens ?? [])
    .filter((token) => {
      if (kind !== "source-token") return true;
      const address = token.isNative ? ZERO_ADDRESS : token.address;
      return !(chain?.id === target.chainId && normalizeTokenAddress(address) === normalizeTokenAddress(target.address));
    })
    .map((token) => {
      const address = token.isNative ? ZERO_ADDRESS : token.address;
      return {
        value: String(address),
        label: token.symbol,
        meta: `${chain.name}${token.isNative ? " native token" : ` ${shortTokenAddress(token.address)}`}`,
        icon: token.symbol?.slice(0, 1) ?? "?",
      };
    });
}

function currentSelectorValue(kind) {
  switch (kind) {
    case "target-chain":
      return String(targetChain.value);
    case "target-token":
      return String(targetToken.value);
    case "source-chain":
      return String(sourceChain.value);
    case "source-token":
      return String(sourceToken.value);
    default:
      return "";
  }
}

function chooseSelectorValue(value) {
  if (!activeSelector || value == null) return;
  const target = selectorSelectFor(activeSelector);
  if (!target) return;
  target.value = value;
  target.dispatchEvent(new Event("change", { bubbles: true }));
  closeSelector();
}

function selectorSelectFor(kind) {
  switch (kind) {
    case "target-chain":
      return targetChain;
    case "target-token":
      return targetToken;
    case "source-chain":
      return sourceChain;
    case "source-token":
      return sourceToken;
    default:
      return undefined;
  }
}

function syncSwapControls() {
  const source = findToken(sourceChain.value, sourceToken.value);
  const target = findToken(targetChain.value, targetToken.value);
  sourceChainLabel.textContent = chainLabel(sourceChain.value);
  targetChainLabel.textContent = chainLabel(targetChain.value);
  sourceTokenLabel.textContent = source?.symbol ?? tokenLabel(sourceChain.value, sourceToken.value);
  targetTokenLabel.textContent = target?.symbol ?? tokenLabel(targetChain.value, targetToken.value);
  tokenIconSource.textContent = tokenInitial(source);
  tokenIconTarget.textContent = tokenInitial(target);

  if (activeQuote) {
    sourceAmountDisplay.textContent = formatFriendlyTokenAmount(activeQuote.sourceAmount, activeQuote.sourceChainId, activeQuote.sourceToken, "payment");
    targetAmountDisplay.textContent = formatFriendlyTokenAmount(activeQuote.targetAmount, activeQuote.targetChainId, activeQuote.targetToken, "target");
    return;
  }

  sourceAmountDisplay.textContent = "Quote pending";
  const checkedPack = form.querySelector('input[name="usdAmountMicros"]:checked');
  targetAmountDisplay.textContent = checkedPack ? formatPackLabel(checkedPack.value, targetChain.value, targetToken.value) : "Select amount";
}

function tokenInitial(token) {
  const symbol = token?.symbol ?? "?";
  return symbol.slice(0, 1).toUpperCase();
}

async function fetchInvoiceOrStub(id) {
  try {
    const response = await fetch(`${apiBase}/invoices/${encodeURIComponent(id)}`);
    if (!response.ok) throw new Error(response.statusText);
    return await response.json();
  } catch {
    return { invoiceId: id, status: "failed" };
  }
}

/**
 * @param {string} invoiceId
 * @param {{ fromHistory?: boolean }} [options]
 */
async function openInvoiceDetail(invoiceId, options = {}) {
  const { fromHistory = false } = options;
  detailInvoiceId = invoiceId;
  if (invoicePanelHeading) {
    invoicePanelHeading.textContent = fromHistory ? "Invoice detail" : "Pay this invoice";
  }
  invoicePanel.classList.remove("hidden");
  invoiceOutput.innerHTML = `<p class="muted">Loading…</p>`;
  const inv = await fetchInvoiceOrStub(invoiceId);
  invoiceOutput.innerHTML = renderInvoice(inv);
  if (!isTerminalInvoiceStatus(inv.status ?? "")) {
    ensureInvoicePolling();
  }
  if (fromHistory) {
    setStatus("Opened invoice from history.");
  }
  invoicePanel.scrollIntoView({ behavior: "smooth", block: "nearest" });
  highlightInvoiceListSelection();
}

function highlightInvoiceListSelection() {
  myInvoicesOutput.querySelectorAll("[data-invoice-id]").forEach((el) => {
    const id = el.getAttribute("data-invoice-id");
    el.classList.toggle("invoice-item--selected", detailInvoiceId != null && id === detailInvoiceId);
  });
}

function isTerminalInvoiceStatus(status) {
  return status === "complete" || status === "failed";
}

function stopInvoicePolling() {
  if (invoicePollTimer != null) {
    clearInterval(invoicePollTimer);
    invoicePollTimer = null;
  }
}

function ensureInvoicePolling() {
  if (invoicePollTimer != null) return;
  invoicePollTimer = setInterval(() => {
    void pollInvoicesAndRecent().catch(() => {});
  }, INVOICE_POLL_MS);
}

/**
 * @param {{ quiet?: boolean }} [options]
 * quiet: no “Loading…” flash (used by the poller).
 */
async function loadMyInvoices(options = {}) {
  const { quiet = false } = options;
  const ids = loadSavedInvoiceIds();
  if (ids.length === 0) {
    stopInvoicePolling();
    detailInvoiceId = null;
    myInvoicesOutput.classList.add("muted");
    myInvoicesOutput.textContent = "No invoices saved in this browser yet.";
    return;
  }

  myInvoicesOutput.classList.remove("muted");
  if (!quiet) {
    myInvoicesOutput.innerHTML = "Loading saved invoices...";
  }

  const invoices = await Promise.all(ids.map((id) => fetchInvoiceOrStub(id)));

  myInvoicesOutput.innerHTML = invoices
    .map((inv) => renderInvoiceListItem(inv, inv.invoiceId === detailInvoiceId))
    .join("");
  updateDetailInvoicePanel(invoices);

  const anyLive = invoices.some((inv) => !isTerminalInvoiceStatus(inv.status ?? ""));
  if (anyLive) {
    ensureInvoicePolling();
  } else {
    stopInvoicePolling();
  }
}

function updateDetailInvoicePanel(invoices) {
  if (!detailInvoiceId || invoicePanel.classList.contains("hidden")) return;
  const match = invoices.find((inv) => inv.invoiceId === detailInvoiceId);
  if (match) {
    invoiceOutput.innerHTML = renderInvoice(match);
    highlightInvoiceListSelection();
  }
}

async function loadRecentSwaps() {
  try {
    const response = await fetch(`${apiBase}/recent-swaps`);
    const { swaps } = await response.json();
    if (!swaps?.length) {
      recentSwaps.classList.add("muted");
      recentSwaps.classList.remove("recent-list");
      recentSwaps.textContent = "No recent swaps yet.";
      return;
    }
    recentSwaps.classList.remove("muted");
    recentSwaps.classList.add("recent-list");
    recentSwaps.innerHTML = swaps.map((swap) => renderRecentSwap(swap)).join("");
  } catch {
    /* ignore when API unavailable */
  }
}

async function pollInvoicesAndRecent() {
  await loadMyInvoices({ quiet: true });
  await loadRecentSwaps();
}

function schedulePreviewQuote() {
  if (quoteDebounceTimer != null) clearTimeout(quoteDebounceTimer);
  quoteDebounceTimer = setTimeout(() => {
    void refreshPreviewQuote();
  }, 350);
}

async function refreshPreviewQuote(options = {}) {
  const { immediate = false } = options;
  if (quoteDebounceTimer != null) {
    clearTimeout(quoteDebounceTimer);
    quoteDebounceTimer = null;
  }
  const values = Object.fromEntries(new FormData(form).entries());
  const recipient = String(values.recipient ?? "").trim();
  if (!recipient) {
    activeQuote = undefined;
    quotePreview.classList.add("muted");
    quotePreview.textContent = "Enter a receive address to preview payment.";
    return;
  }

  const recipientIssue = recipientError(recipient, String(values.targetChainId ?? ""));
  if (recipientIssue) {
    activeQuote = undefined;
    syncSwapControls();
    quotePreview.classList.add("muted");
    quotePreview.textContent = recipientIssue;
    return;
  }

  const request = buildQuoteRequest(values);
  const seq = ++quoteRequestSeq;
  if (!immediate) {
    quotePreview.classList.add("muted");
    quotePreview.textContent = "Updating quote...";
  }
  try {
    const quote = await postJson("/quotes?preview=1", request);
    if (seq !== quoteRequestSeq) return;
    activeQuote = quote;
    syncSwapControls();
    quotePreview.classList.remove("muted");
    quotePreview.innerHTML = renderQuotePreview(quote);
    setStatus("Quote preview ready. Continue to payment to save the invoice.");
  } catch (error) {
    if (seq !== quoteRequestSeq) return;
    activeQuote = undefined;
    syncSwapControls();
    quotePreview.classList.add("muted");
    quotePreview.textContent = error instanceof Error ? error.message : "Quote preview failed.";
  }
}

function buildQuoteRequest(values) {
  return {
    sourceChainId: String(values.sourceChainId ?? ""),
    sourceToken: String(values.sourceToken ?? ZERO_ADDRESS),
    targetChainId: String(values.targetChainId ?? ""),
    targetToken: String(values.targetToken ?? ZERO_ADDRESS),
    recipient: String(values.recipient ?? "").trim(),
    usdAmountMicros: String(values.usdAmountMicros ?? "0"),
    captchaToken: getCaptchaToken(),
  };
}

async function postJson(path, body) {
  const response = await fetch(`${apiBase}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(await response.text());
  return response.json();
}

function renderQuote(quote) {
  return `
    <div class="kv">
      <div><span>You send</span><strong>${escapeHtml(formatTokenAmount(quote.sourceAmount, quote.sourceChainId, quote.sourceToken))}</strong></div>
      <div><span>You receive</span><strong>${escapeHtml(formatTokenAmount(quote.targetAmount, quote.targetChainId, quote.targetToken))}</strong></div>
      <div><span>Fee</span><strong>${escapeHtml(formatTokenAmount(quote.feeAmount, quote.targetChainId, quote.targetToken))}</strong></div>
      <div><span>Expires</span><strong>${new Date(quote.expiresAt).toLocaleTimeString()}</strong></div>
    </div>
  `;
}

function renderQuotePreview(quote) {
  const target = findToken(quote.targetChainId, quote.targetToken);
  return `
    <div class="quote-preview__main"><span class="muted">You pay exactly</span><div class="quote-preview__amount">${escapeHtml(formatFriendlyTokenAmount(quote.sourceAmount, quote.sourceChainId, quote.sourceToken, "payment"))}</div></div>
    <div class="quote-preview__row"><span>Price</span><strong>${escapeHtml(formatPriceLine(quote))}</strong></div>
    <div class="quote-preview__row"><span>Fee included</span><strong>${escapeHtml(formatFriendlyTokenAmount(quote.feeAmount, quote.sourceChainId, quote.sourceToken, "payment"))}</strong></div>
    <div class="quote-preview__row"><span>You receive</span><strong>${escapeHtml(formatFriendlyTokenAmount(quote.targetAmount, quote.targetChainId, quote.targetToken, "target"))}</strong></div>
    <div class="quote-preview__row"><span>Receiving on</span><strong>${escapeHtml(chainLabel(quote.targetChainId))} ${escapeHtml(target?.symbol ?? tokenLabel(quote.targetChainId, quote.targetToken))}</strong></div>
  `;
}

function renderRecentSwap(swap) {
  const sent = formatTokenAmount(swap.sourceAmount, swap.sourceChainId, swap.sourceToken);
  const received = formatTokenAmount(swap.targetAmount ?? swap.amountBand, swap.targetChainId, swap.targetToken);
  const txHash = String(swap.txHash ?? "");
  const txLabel = shortHash(txHash);
  const tx = swap.explorerTxUrl
    ? `<a href="${escapeHtml(swap.explorerTxUrl)}" target="_blank" rel="noopener noreferrer"><code>${escapeHtml(txLabel)}</code></a>`
    : txHash
      ? `<code>${escapeHtml(txLabel)}</code>`
      : `<span class="muted">Not reported</span>`;
  return `
    <article class="recent-swap">
      <div class="recent-swap__leg">
        <span>User sent</span>
        <strong>${escapeHtml(chainLabel(swap.sourceChainId))} · ${escapeHtml(tokenLabel(swap.sourceChainId, swap.sourceToken))} · ${escapeHtml(sent)}</strong>
      </div>
      <div class="recent-swap__leg">
        <span>User received</span>
        <strong>${escapeHtml(chainLabel(swap.targetChainId))} · ${escapeHtml(tokenLabel(swap.targetChainId, swap.targetToken))} · ${escapeHtml(received)}</strong>
      </div>
      <div class="recent-swap__tx">
        <span>Transfer tx</span>
        ${tx}
      </div>
    </article>
  `;
}

function escapeHtml(text) {
  if (text === undefined || text === null) return "";
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function kvRow(label, valueText) {
  if (valueText === undefined || valueText === null || valueText === "") return "";
  return `<div><span>${escapeHtml(label)}</span><strong>${escapeHtml(String(valueText))}</strong></div>`;
}

function kvRowHtml(label, innerHtml) {
  return `<div><span>${escapeHtml(label)}</span><strong class="invoice-value-break">${innerHtml}</strong></div>`;
}

function copyButton(value, label, className = "copy-chip") {
  if (value === undefined || value === null || value === "") return "";
  return `<button type="button" class="${escapeHtml(className)}" data-copy-value="${escapeHtml(String(value))}" data-copy-label="${escapeHtml(label)}">${escapeHtml(label)}</button>`;
}

async function copyToClipboard(button) {
  const value = button.getAttribute("data-copy-value") ?? "";
  if (!value) return;
  let copied = false;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      copied = true;
    } else {
      fallbackCopy(value);
      copied = true;
    }
  } catch {
    fallbackCopy(value);
    copied = true;
  }
  if (copied) {
    const original = button.textContent;
    button.textContent = "Copied";
    button.classList.add("copied");
    setTimeout(() => {
      button.textContent = original;
      button.classList.remove("copied");
    }, 1400);
  }
}

function fallbackCopy(value) {
  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  textarea.remove();
}

function statusPill(status) {
  const value = String(status ?? "unknown");
  const className = value.toLowerCase().replace(/[^a-z0-9_-]+/g, "_");
  return `<span class="status-pill status-pill--${escapeHtml(className)}">${escapeHtml(value.replace(/_/g, " "))}</span>`;
}

function formatTs(ms) {
  if (typeof ms !== "number" || Number.isNaN(ms)) return "—";
  try {
    return new Date(ms).toLocaleString();
  } catch {
    return "—";
  }
}

function chainLabel(chainId) {
  const chain = appConfig.chains.find((candidate) => String(candidate.id) === String(chainId));
  return chain ? `${chain.name} (${chain.id})` : String(chainId ?? "—");
}

/** Validates the recipient against the target chain's address format. Returns a message or "" if valid. */
function recipientError(recipient, targetChainId) {
  const chain = findChain(targetChainId);
  const type = chain?.type ?? "evm";
  if (type === "tron") {
    return /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(recipient) ? "" : "Enter a valid TRON (T...) address for this chain.";
  }
  return /^0x[0-9a-fA-F]{40}$/.test(recipient) ? "" : "Enter a valid EVM (0x...) address for this chain.";
}

function tokenLabel(chainId, tokenAddress) {
  const token = findToken(chainId, tokenAddress);
  if (token) return token.symbol;
  return shortTokenAddress(tokenAddress);
}

function formatTokenAmount(amount, chainId, tokenAddress) {
  if (amount === undefined || amount === null || amount === "") return "—";
  const token = findToken(chainId, tokenAddress);
  const symbol = token?.symbol ?? shortTokenAddress(tokenAddress);
  const decimals = Number.isInteger(token?.decimals) ? token.decimals : 0;
  return `${formatBaseUnitAmount(amount, decimals)} ${symbol}`.trim();
}

function formatFriendlyTokenAmount(amount, chainId, tokenAddress, mode = "default") {
  if (amount === undefined || amount === null || amount === "") return "—";
  const token = findToken(chainId, tokenAddress);
  const symbol = token?.symbol ?? shortTokenAddress(tokenAddress);
  const decimals = Number.isInteger(token?.decimals) ? token.decimals : 0;
  const visibleDecimals = friendlyDecimals(token, mode);
  return `${formatBaseUnitAmount(amount, decimals, visibleDecimals, true)} ${symbol}`.trim();
}

function formatPriceLine(quote) {
  const sourceTokenInfo = findToken(quote.sourceChainId, quote.sourceToken);
  const targetTokenInfo = findToken(quote.targetChainId, quote.targetToken);
  const sourcePrice = tokenPriceUsd(sourceTokenInfo);
  const targetPrice = tokenPriceUsd(targetTokenInfo);
  if (sourcePrice && targetPrice) {
    const price = targetPrice / sourcePrice;
    return `1 ${targetTokenInfo.symbol} = ${formatHumanNumber(price, sourceTokenInfo.symbol === "ETH" ? 6 : 4)} ${sourceTokenInfo.symbol}`;
  }
  return quote.rate ? `rate ${quote.rate}` : "—";
}

function friendlyDecimals(token, mode) {
  if (!token) return 6;
  const price = tokenPriceUsd(token);
  if (price && price >= 100) return mode === "payment" ? 5 : 6;
  if (token.decimals <= 2) return token.decimals;
  if (price && price >= 1) return 2;
  return 4;
}

function findToken(chainId, tokenAddress) {
  const chain = appConfig.chains.find((candidate) => String(candidate.id) === String(chainId));
  if (!chain) return undefined;
  const normalized = normalizeTokenAddress(tokenAddress);
  return chain.tokens.find((token) => normalizeTokenAddress(token.isNative ? ZERO_ADDRESS : token.address) === normalized);
}

function tokenAmountFromUsd(usdPack, token) {
  const price = tokenPriceUsd(token);
  if (!price) return undefined;
  const usd = { numerator: BigInt(String(usdPack)), denominator: 1_000_000n };
  const priceFraction = decimalToFraction(String(price));
  const scale = 10n ** BigInt(token.decimals);
  return ceilDiv(usd.numerator * priceFraction.denominator * scale, usd.denominator * priceFraction.numerator);
}

function tokenAmountPackToUsd(tokenAmount, priceUsd) {
  const amount = decimalToFraction(String(tokenAmount));
  const price = decimalToFraction(String(priceUsd));
  return ((amount.numerator * price.numerator * 1_000_000n) / (amount.denominator * price.denominator)).toString();
}

function tokenPriceUsd(token) {
  if (token?.priceUsdMicros && /^\d+$/.test(String(token.priceUsdMicros))) {
    const micros = Number(token.priceUsdMicros);
    if (Number.isFinite(micros) && micros > 0) return micros / 1_000_000;
  }
  const symbol = token?.symbol?.toUpperCase();
  if (symbol === "ETH") return 2_000;
  if (symbol === "USDC" || symbol === "USDT" || symbol === "BOBUSDC" || symbol === "DUMUSDT") return 1;
  return undefined;
}

function decimalToFraction(value) {
  const [whole, fraction = ""] = value.split(".");
  const digits = `${whole}${fraction}`.replace(/^0+(?=\d)/, "") || "0";
  return {
    numerator: BigInt(digits),
    denominator: 10n ** BigInt(fraction.length),
  };
}

function ceilDiv(numerator, denominator) {
  return (numerator + denominator - 1n) / denominator;
}

function normalizeTokenAddress(address) {
  const value = String(address ?? ZERO_ADDRESS);
  // TRON base58 (`T...`) addresses are case-sensitive; only lowercase EVM hex.
  return value.startsWith("T") ? value : value.toLowerCase();
}

function shortTokenAddress(address) {
  const value = String(address ?? "");
  if (!value) return "";
  if (normalizeTokenAddress(value) === ZERO_ADDRESS) return "native";
  return value.length > 12 ? `${value.slice(0, 6)}…${value.slice(-4)}` : value;
}

function formatBaseUnitAmount(value, decimals, maxFractionDigits = 8, roundUp = false) {
  const raw = String(value);
  if (!/^-?\d+$/.test(raw)) return raw;
  const negative = raw.startsWith("-");
  const digits = negative ? raw.slice(1) : raw;
  if (decimals <= 0) return `${negative ? "-" : ""}${digits}`;

  const padded = digits.padStart(decimals + 1, "0");
  const whole = padded.slice(0, -decimals) || "0";
  let fractionRaw = padded.slice(-decimals);
  if (roundUp && maxFractionDigits < decimals && /[1-9]/.test(fractionRaw.slice(maxFractionDigits))) {
    const scale = 10n ** BigInt(decimals - maxFractionDigits);
    const rounded = ((BigInt(digits) + scale - 1n) / scale) * scale;
    return formatBaseUnitAmount(rounded.toString(), decimals, maxFractionDigits, false);
  }
  const fraction = fractionRaw.replace(/0+$/, "");
  const trimmedFraction = fraction.length > maxFractionDigits ? `${fraction.slice(0, maxFractionDigits)}…` : fraction;
  return `${negative ? "-" : ""}${whole}${trimmedFraction ? `.${trimmedFraction}` : ""}`;
}

function formatHumanNumber(value, maxFractionDigits = 6) {
  return new Intl.NumberFormat(undefined, {
    maximumFractionDigits: maxFractionDigits,
    minimumFractionDigits: 0,
  }).format(value);
}

function formatUsdMicros(usdMicros) {
  if (!/^\d+$/.test(String(usdMicros))) return "$0";
  const micros = BigInt(usdMicros);
  const whole = micros / 1_000_000n;
  const fraction = (micros % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "");
  return `$${whole}${fraction ? `.${fraction}` : ""}`;
}

function renderTxDetailBlock(title, tx) {
  if (!tx || typeof tx !== "object" || !tx.txHash) {
    return `<div class="invoice-tx-block"><div class="invoice-tx-block__title">${escapeHtml(title)}</div><p class="muted small">Not reported yet.</p></div>`;
  }
  const hashHtml = tx.explorerTxUrl
    ? `<a href="${escapeHtml(tx.explorerTxUrl)}" target="_blank" rel="noopener noreferrer"><code>${escapeHtml(tx.txHash)}</code></a>`
    : `<code>${escapeHtml(tx.txHash)}</code>`;
  const rows = [
    kvRow("Chain", chainLabel(tx.chainId)),
    kvRowHtml("Transaction hash", hashHtml),
    kvRow("Tx status", tx.status),
    tx.blockNumber != null && tx.blockNumber !== "" ? kvRow("Block number", String(tx.blockNumber)) : "",
    tx.gasUsed != null && tx.gasUsed !== "" ? kvRow("Gas used (units)", String(tx.gasUsed)) : "",
    tx.explorerTxUrl
      ? kvRowHtml(
          "Explorer",
          `<a href="${escapeHtml(tx.explorerTxUrl)}" class="small" target="_blank" rel="noopener noreferrer">${escapeHtml(tx.explorerTxUrl)}</a>`
        )
      : "",
  ].filter(Boolean);
  return `<div class="invoice-tx-block"><div class="invoice-tx-block__title">${escapeHtml(title)}</div><div class="kv kv--invoice-tx">${rows.join("")}</div></div>`;
}

function renderSweepPanel(inv) {
  const s = inv.sweep;
  if (!s) {
    return `<section class="invoice-telemetry"><h4>Sweep</h4><p class="muted small">Nothing reported yet. Telemetry appears after payment is indexed and the sweeper runs.</p></section>`;
  }
  const meta = [
    s.sweeperAddress ? kvRow("Sweeper contract", s.sweeperAddress) : "",
    s.forwarder ? kvRow("Forwarder", s.forwarder) : "",
    s.paymentToken || s.paymentAmount
      ? kvRow("Indexed payment", formatTokenAmount(s.paymentAmount, inv.chainId ?? inv.sourceChainId, s.paymentToken ?? inv.token ?? inv.sourceToken))
      : "",
    s.error ? kvRow("Sweep error", s.error) : "",
  ]
    .filter(Boolean)
    .join("");
  return `<section class="invoice-telemetry"><h4>Sweep</h4>${meta ? `<div class="kv">${meta}</div>` : ""}${renderTxDetailBlock("Source payment (receiver log)", s.sourcePayment)}${renderTxDetailBlock("Sweeper transaction", s.tx)}</section>`;
}

function renderRelayPanel(inv) {
  const r = inv.relay;
  const hasPayload = r && (r.tx || r.swapRequestedTx || r.status || r.error);
  if (!hasPayload) {
    return `<section class="invoice-telemetry"><h4>Relay & swap (cross-chain)</h4><p class="muted small">Nothing reported yet.</p></section>`;
  }
  const top = [r.status ? kvRow("Relay status", r.status) : "", r.error ? kvRow("Relay error", r.error) : ""].filter(Boolean).join("");
  return `<section class="invoice-telemetry"><h4>Relay & swap (cross-chain)</h4>${top ? `<div class="kv">${top}</div>` : ""}${renderTxDetailBlock("SwapRequested (source chain)", r.swapRequestedTx)}${renderTxDetailBlock("Relay transaction (target chain)", r.tx)}</section>`;
}

function renderPayoutPanel(inv) {
  const p = inv.payout;
  if (!p) {
    return `<section class="invoice-telemetry"><h4>Payout (output token)</h4><p class="muted small">Nothing reported yet.</p></section>`;
  }
  const top = [
    p.status ? kvRow("Payout status", p.status) : "",
    p.amount || p.token ? kvRow("Payout amount (tracked)", formatTokenAmount(p.amount, inv.targetChainId, p.token ?? inv.targetToken)) : "",
    p.recipient ? kvRow("Payout recipient", p.recipient) : "",
    p.error ? kvRow("Payout error", p.error) : "",
  ]
    .filter(Boolean)
    .join("");
  return `<section class="invoice-telemetry"><h4>Payout (output token)</h4>${top ? `<div class="kv">${top}</div>` : ""}${renderTxDetailBlock("Payout transaction", p.tx)}</section>`;
}

function renderInvoice(invoice) {
  return `
    <div class="invoice-experience">
      ${renderPaymentHero(invoice)}
      ${renderSwapSummary(invoice)}
      ${renderStatusTimeline(invoice)}
      ${renderQuoteSourceCards(invoice)}
      ${renderTechnicalDetails(invoice)}
    </div>
  `;
}

function paymentContext(invoice) {
  const chainId = invoice.chainId ?? invoice.sourceChainId;
  const token = invoice.token ?? invoice.sourceToken;
  const amountText = formatTokenAmount(invoice.amount, chainId, token);
  return {
    chainId,
    token,
    tokenSymbol: tokenLabel(chainId, token),
    amountText,
    address: invoice.invoiceAddress ?? "",
    chainLabel: chainLabel(chainId),
  };
}

function renderPaymentHero(invoice) {
  const payment = paymentContext(invoice);
  const complete = invoiceComplete(invoice);
  const qrPayload = paymentQrPayload(invoice);
  const qrUrl = qrImageUrl(qrPayload);
  const expires = !complete && invoice.expiresAt != null ? expiryLabel(invoice.expiresAt) : "";
  return `
    <section class="payment-hero-card${complete ? " payment-hero-card--complete" : ""}">
      <div class="payment-hero-card__copy">
        <div class="payment-hero-card__eyebrow">
          ${statusPill(invoice.status)}
          ${expires ? `<span class="expiry-chip">${escapeHtml(expires)}</span>` : ""}
        </div>
        <p class="payment-hero-card__label">${complete ? "Payment complete" : "Send exactly"}</p>
        <div class="payment-amount">
          <span class="token-icon">${escapeHtml(payment.tokenSymbol.slice(0, 1))}</span>
          <strong>${escapeHtml(payment.amountText)}</strong>
          ${copyButton(payment.amountText, "Copy amount", "copy-chip copy-chip--light")}
        </div>
        <div class="payment-pills">
          <span>${escapeHtml(payment.chainLabel)}</span>
          <span>${escapeHtml(payment.tokenSymbol)}</span>
        </div>
        ${
          complete
            ? `<div class="completion-note"><strong>Payment received and swap completed.</strong><span>The QR code and payment warning are hidden because no further payment is needed.</span></div>`
            : `<div class="loss-warning" role="alert">
                <strong>Only send this exact payment.</strong>
                <span>Send only ${escapeHtml(payment.amountText)} on ${escapeHtml(payment.chainLabel)} to this invoice address. Other tokens, wrong chains, partial payments, or extra payments may be lost.</span>
              </div>`
        }
      </div>
      ${
        complete
          ? ""
          : `<div class="payment-qr-panel">
              <div class="qr-shell">
                <img src="${escapeHtml(qrUrl)}" alt="QR code for invoice address" loading="lazy" />
              </div>
              <div class="address-card">
                <span class="address-card__label">Invoice address</span>
                <code>${escapeHtml(payment.address)}</code>
                <div class="invoice-actions">
                  ${copyButton(payment.address, "Copy address")}
                  ${copyButton(qrPayload, "Copy QR payload")}
                </div>
              </div>
            </div>`
      }
    </section>
  `;
}

function renderSwapSummary(invoice) {
  const payment = paymentContext(invoice);
  const paid = invoicePaymentSeen(invoice);
  const complete = invoiceComplete(invoice);
  return `
    <section class="swap-summary-card">
      <div class="route-node${paid ? " route-node--done" : ""}">
        ${paid ? `<span class="route-check" aria-label="Payment received">✓</span>` : ""}
        <span class="route-node__label">You pay</span>
        <strong>${escapeHtml(payment.amountText)}</strong>
        <span>${escapeHtml(payment.chainLabel)}</span>
      </div>
      <div class="route-arrow" aria-hidden="true">→</div>
      <div class="route-node${complete ? " route-node--done" : ""}">
        ${complete ? `<span class="route-check" aria-label="Swap completed">✓</span>` : ""}
        <span class="route-node__label">FastSwap sends</span>
        <strong>${escapeHtml(formatTokenAmount(invoice.targetAmount, invoice.targetChainId, invoice.targetToken))}</strong>
        <span>${escapeHtml(chainLabel(invoice.targetChainId))}</span>
      </div>
      <div class="route-recipient">
        <span class="route-node__label">Recipient</span>
        <code>${escapeHtml(invoice.recipient ?? "—")}</code>
      </div>
      <div class="summary-chips">
        <span>Fee ${escapeHtml(formatTokenAmount(invoice.feeAmount, payment.chainId, payment.token))}</span>
        <span>Rate ${escapeHtml(String(invoice.rate ?? "—"))}</span>
        ${invoice.quoteId ? `<span>Quote ${escapeHtml(shortId(invoice.quoteId))}</span>` : ""}
      </div>
    </section>
  `;
}

function renderStatusTimeline(invoice) {
  const steps = invoiceTimelineSteps(invoice);
  return `
    <section class="timeline-card">
      <div class="section-heading">
        <div>
          <p class="eyebrow">Payment tracking</p>
          <h3>What happens next</h3>
        </div>
        ${statusPill(invoice.status)}
      </div>
      <div class="timeline-steps">
        ${steps.map(renderTimelineStep).join("")}
      </div>
    </section>
  `;
}

function renderTimelineStep(step) {
  return `
    <article class="timeline-step timeline-step--${escapeHtml(step.state)}">
      <div class="timeline-step__dot">${escapeHtml(step.icon)}</div>
      <div class="timeline-step__body">
        <div class="timeline-step__top">
          <strong>${escapeHtml(step.title)}</strong>
          <span>${escapeHtml(step.stateLabel)}</span>
        </div>
        <p>${escapeHtml(step.description)}</p>
        ${step.actions.length ? `<div class="timeline-actions">${step.actions.join("")}</div>` : ""}
      </div>
    </article>
  `;
}

function invoiceTimelineSteps(invoice) {
  const status = String(invoice.status ?? "");
  const sourcePayment = invoice.sweep?.sourcePayment;
  const sweepTx = invoice.sweep?.tx;
  const relayTx = invoice.relay?.tx;
  const payoutTx = invoice.payout?.tx;
  const paymentSeen = invoicePaymentSeen(invoice);
  const sweepDone = txConfirmed(sweepTx) || Boolean(sourcePayment);
  const relayDone = txConfirmed(relayTx) || status === "relaying" || status === "complete";
  const payoutDone = invoiceComplete(invoice);
  return [
    {
      title: "Quote created",
      description: invoice.quoteId ? `Quote ${shortId(invoice.quoteId)} is registered and ready for payment.` : "The payment request is ready.",
      state: "done",
      stateLabel: "Ready",
      icon: "✓",
      actions: [invoice.quoteId ? copyButton(invoice.quoteId, "Copy quote ID", "action-chip") : ""].filter(Boolean),
    },
    {
      title: "Waiting for exact payment",
      description: "Send the exact amount to the invoice address. FastSwap will watch this address for payment.",
      state: paymentSeen ? "done" : status === "failed" ? "error" : "current",
      stateLabel: paymentSeen ? "Seen" : status === "failed" ? "Failed" : "Current",
      icon: paymentSeen ? "✓" : "1",
      actions: [copyButton(paymentContext(invoice).address, "Copy address", "action-chip")].filter(Boolean),
    },
    {
      title: "Sweep source payment",
      description: sweepDone ? "The source-chain payment has been indexed or swept." : "After funds arrive, the sweep node executes the invoice.",
      state: sweepDone ? "done" : paymentSeen ? "current" : "pending",
      stateLabel: sweepDone ? "Done" : paymentSeen ? "Next" : "Pending",
      icon: sweepDone ? "✓" : "2",
      actions: txActions(sourcePayment, "Receiver log").concat(txActions(sweepTx, "Sweep tx")),
    },
    {
      title: "Relay swap request",
      description: relayDone ? "The target-chain relay has been submitted or confirmed." : "FastSwap relays the swap request across chains.",
      state: relayDone ? "done" : sweepDone ? "current" : "pending",
      stateLabel: relayDone ? "Done" : sweepDone ? "Next" : "Pending",
      icon: relayDone ? "✓" : "3",
      actions: txActions(invoice.relay?.swapRequestedTx, "Request tx").concat(txActions(relayTx, "Relay tx")),
    },
    {
      title: "Payout to recipient",
      description: payoutDone ? "Funds have been paid out or the invoice is complete." : "The recipient gets the quoted output token when liquidity is available.",
      state: payoutDone ? "done" : relayDone ? "current" : "pending",
      stateLabel: payoutDone ? "Complete" : relayDone ? "Next" : "Pending",
      icon: payoutDone ? "✓" : "4",
      actions: txActions(payoutTx, "Payout tx"),
    },
  ];
}

function invoicePaymentSeen(invoice) {
  const status = String(invoice.status ?? "");
  return Boolean(
    invoice.sweep?.sourcePayment ||
      invoice.sweep?.paymentAmount ||
      ["paid", "relaying", "queued", "complete"].includes(status)
  );
}

function invoiceComplete(invoice) {
  return Boolean(
    invoice.status === "complete" ||
      invoice.payout?.status === "confirmed" ||
      txConfirmed(invoice.payout?.tx)
  );
}

function renderQuoteSourceCards(invoice) {
  const sources = Array.isArray(invoice.sources) ? invoice.sources : [];
  return `
    <section class="source-card-grid">
      <div class="section-heading">
        <div>
          <p class="eyebrow">Quote sources</p>
          <h3>Rate confidence</h3>
        </div>
      </div>
      ${
        sources.length
          ? sources
              .map(
                (source) => `
                  <article class="source-card">
                    <strong>${escapeHtml(source.source)}</strong>
                    <span>rate ${escapeHtml(String(source.rate))}</span>
                    <span>${escapeHtml(formatTokenAmount(source.targetAmount, invoice.targetChainId, invoice.targetToken))}</span>
                    <small>${escapeHtml(formatTs(source.updatedAt))}</small>
                  </article>
                `
              )
              .join("")
          : `<p class="muted small">No per-source rows on this quote.</p>`
      }
    </section>
  `;
}

function renderTechnicalDetails(invoice) {
  const payment = paymentContext(invoice);
  return `
    <details class="technical-details-card">
      <summary>
        <span>Technical details</span>
        <span class="muted small">Invoice ID, encoded intent, and raw node telemetry</span>
      </summary>
      <div class="technical-details-grid">
        <section class="invoice-telemetry">
          <h4>Identifiers</h4>
          <div class="detail-stack">
            <div class="detail-token">
              <span>Invoice ID</span>
              <code>${escapeHtml(invoice.invoiceId ?? "")}</code>
              ${copyButton(invoice.invoiceId, "Copy invoice ID")}
            </div>
            <div class="detail-token">
              <span>Payment address</span>
              <code>${escapeHtml(payment.address)}</code>
              ${copyButton(payment.address, "Copy address")}
            </div>
          </div>
        </section>
        <section class="invoice-telemetry">
          <h4>Encoded intent <span class="muted small">(on-chain <code>data</code>)</span></h4>
          <pre class="invoice-data-field" spellcheck="false">${escapeHtml(invoice.data ?? "")}</pre>
        </section>
        ${renderSweepPanel(invoice)}
        ${renderRelayPanel(invoice)}
        ${renderPayoutPanel(invoice)}
      </div>
    </details>
  `;
}

function paymentQrPayload(invoice) {
  const payment = paymentContext(invoice);
  const amount = formatBaseUnitAmount(String(invoice.amount ?? ""), Number(findToken(payment.chainId, payment.token)?.decimals ?? 0), 18);
  const params = new URLSearchParams();
  if (amount && amount !== "—") params.set("amount", amount);
  params.set("chain", String(payment.chainId ?? ""));
  params.set("token", payment.tokenSymbol);
  return `${payment.address}${params.toString() ? `?${params.toString()}` : ""}`;
}

function qrImageUrl(value) {
  return `https://api.qrserver.com/v1/create-qr-code/?size=220x220&margin=12&data=${encodeURIComponent(value)}`;
}

function expiryLabel(expiresAt) {
  const ms = Number(expiresAt) - Date.now();
  if (!Number.isFinite(ms)) return `Expires ${formatTs(expiresAt)}`;
  if (ms <= 0) return "Quote expired";
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  return `Expires in ${minutes}:${String(seconds).padStart(2, "0")}`;
}

function shortId(value) {
  const text = String(value ?? "");
  return text.length > 18 ? `${text.slice(0, 10)}…${text.slice(-6)}` : text;
}

function shortHash(value) {
  const text = String(value ?? "");
  return text.length > 14 ? `${text.slice(0, 8)}…${text.slice(-6)}` : text;
}

function txConfirmed(tx) {
  return tx?.status === "confirmed" || tx?.status === "success";
}

function txActions(tx, label) {
  if (!tx?.txHash) return [];
  const hash = String(tx.txHash);
  const explorer = tx.explorerTxUrl
    ? `<a class="action-chip" href="${escapeHtml(tx.explorerTxUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)}</a>`
    : "";
  return [copyButton(hash, `Copy ${label}`, "action-chip"), explorer].filter(Boolean);
}

function renderInvoiceListItem(invoice, isSelected = false) {
  const id = invoice.invoiceId ?? "";
  const address = invoice.invoiceAddress
    ? `<div><span>Address</span><code>${escapeHtml(invoice.invoiceAddress)}</code></div>`
    : "";
  const amount = invoice.amount
    ? `<div><span>Amount</span><strong>${escapeHtml(formatTokenAmount(invoice.amount, invoice.sourceChainId ?? invoice.chainId, invoice.token ?? invoice.sourceToken))}</strong></div>`
    : "";
  const sweepOk = invoice.sweep?.tx?.status === "confirmed";
  const relayOk = invoice.relay?.tx?.status === "confirmed";
  const payoutOk = invoice.payout?.status === "confirmed";
  const chainHint =
    sweepOk || relayOk || payoutOk
      ? `<div class="muted small">on-chain: ${[sweepOk && "sweep", relayOk && "relay", payoutOk && "payout"].filter(Boolean).join(", ")}</div>`
      : "";
  const selectedClass = isSelected ? " invoice-item--selected" : "";
  return `
    <article
      class="invoice-item invoice-item--interactive${selectedClass}"
      data-invoice-id="${escapeHtml(id)}"
      role="button"
      tabindex="0"
      aria-label="Open full invoice detail"
    >
      ${statusPill(invoice.status)}
      ${amount}
      <div><span>Invoice ID</span><code>${escapeHtml(id)}</code></div>
      ${address}
      ${chainHint}
      <div class="muted small invoice-item__hint">Click for full detail</div>
    </article>
  `;
}

function renderTokenOptions() {
  const chainOptions = appConfig.chains.map((chain) => `<option value="${escapeHtml(chain.id)}">${escapeHtml(chainLabel(chain.id))}</option>`).join("");
  targetChain.innerHTML = chainOptions;
  sourceChain.innerHTML = chainOptions;
  const defaultNeed = appConfig.chains.find((chain) => chain.tokens.some((token) => token.isNative));
  if (defaultNeed) targetChain.value = defaultNeed.id;
  renderTargetTokenOptions();
  renderSourceTokenOptions();
  renderPackOptions();
}

function renderTargetTokenOptions() {
  const chain = findChain(targetChain.value);
  const previous = targetToken.value;
  targetToken.innerHTML = tokenOptionsForChain(chain).join("");
  if ([...targetToken.options].some((option) => option.value === previous)) {
    targetToken.value = previous;
  } else {
    const native = chain?.tokens.find((token) => token.isNative);
    if (native) targetToken.value = ZERO_ADDRESS;
  }
}

function renderSourceTokenOptions() {
  const chain = findChain(sourceChain.value);
  const target = selectedTarget();
  const options = tokenOptionsForChain(chain, (token) => {
    const address = token.isNative ? ZERO_ADDRESS : token.address;
    return !(chain?.id === target.chainId && normalizeTokenAddress(address) === normalizeTokenAddress(target.address));
  });
  const previous = sourceToken.value;
  sourceToken.innerHTML = options.join("");
  if ([...sourceToken.options].some((option) => option.value === previous)) {
    sourceToken.value = previous;
  }
}

function renderPackOptions() {
  const target = selectedTarget();
  const packs = selectedPacksForTarget(target);
  packOptions.innerHTML = packs
    .map((pack, index) => {
      const label = formatPackLabel(pack, target.chainId, target.address);
      return `<label><input type="radio" name="usdAmountMicros" value="${pack}" ${index === 0 ? "checked" : ""} /> ${escapeHtml(label)}</label>`;
    })
    .join("");
}

function selectedPacksForTarget(target) {
  const allowed = (appConfig.packs ?? [])
    .map((pack) => String(pack.usdAmountMicros ?? ""))
    .filter((usdMicros) => /^\d+$/.test(usdMicros));
  const targetInfo = findToken(target.chainId, target.address);
  const price = tokenPriceUsd(targetInfo);
  const preferred = price && price > 2
    ? ["0.01", "0.02", "0.05", "0.1"].map((amount) => tokenAmountPackToUsd(amount, price))
    : ["10000000", "25000000", "100000000", "200000000"];
  const selected = preferred.filter((usd) => allowed.includes(usd));
  return selected.length >= 4 ? selected.slice(0, 4) : preferred.slice(0, 4);
}

function formatPackLabel(usdMicros, chainId, tokenAddress) {
  const token = findToken(chainId, tokenAddress);
  const amount = tokenAmountFromUsd(usdMicros, token);
  if (amount == null) return formatUsdMicros(usdMicros);
  return formatFriendlyTokenAmount(amount.toString(), chainId, tokenAddress, "target");
}

function updateRecipientLabel() {
  const target = selectedTarget();
  recipientLabel.textContent = `Address to receive your ${chainLabel(target.chainId)} ${tokenLabel(target.chainId, target.address)}`;
}

function selectedTarget() {
  return { chainId: String(targetChain.value ?? ""), address: String(targetToken.value ?? ZERO_ADDRESS) };
}

function tokenOptionsForChain(chain, predicate = () => true) {
  return (chain?.tokens ?? [])
    .filter(predicate)
    .map((token) => {
      const address = token.isNative ? ZERO_ADDRESS : token.address;
      return `<option value="${escapeHtml(address)}">${escapeHtml(token.symbol)}</option>`;
    });
}

function findChain(chainId) {
  return appConfig.chains.find((chain) => String(chain.id) === String(chainId));
}

function setupCaptcha() {
  const captcha = appConfig.captcha ?? {};
  const required = captcha.requiredForQuotes || captcha.requiredForInvoices;
  if (!required) return;

  captchaPanel.classList.remove("hidden");

  if (globalThis.FASTSWAP_DEMO_CAPTCHA_TOKEN) {
    captchaTokenInput.value = globalThis.FASTSWAP_DEMO_CAPTCHA_TOKEN;
    captchaTokenInput.readOnly = true;
    captchaHelp.textContent = "Demo captcha is enabled. The local demo token is pre-filled.";
    return;
  }

  if (captcha.siteKey) {
    captchaTokenInput.classList.add("hidden");
    captchaHelp.textContent = "Complete the challenge to protect quotes from automated abuse.";
    loadTurnstile(captcha.siteKey);
  }
}

function getCaptchaToken() {
  const captcha = appConfig.captcha ?? {};
  if (!captcha.requiredForQuotes && !captcha.requiredForInvoices) return undefined;
  return globalThis.FASTSWAP_DEMO_CAPTCHA_TOKEN || turnstileToken || captchaTokenInput.value || undefined;
}

function loadTurnstile(siteKey) {
  const script = document.createElement("script");
  script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
  script.async = true;
  script.defer = true;
  script.onload = () => {
    globalThis.turnstile?.render(turnstileWidget, {
      sitekey: siteKey,
      callback(token) {
        turnstileToken = token;
      },
      "expired-callback"() {
        turnstileToken = "";
      },
    });
  };
  document.head.appendChild(script);
}

function setStatus(message) {
  formStatus.textContent = message;
}

function loadSavedInvoiceIds() {
  try {
    const parsed = JSON.parse(localStorage.getItem(SAVED_INVOICES_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((id) => typeof id === "string") : [];
  } catch {
    return [];
  }
}

function saveInvoiceId(invoiceId) {
  const ids = loadSavedInvoiceIds().filter((id) => id !== invoiceId);
  ids.unshift(invoiceId);
  localStorage.setItem(SAVED_INVOICES_KEY, JSON.stringify(ids.slice(0, 50)));
}

function clearSavedInvoices() {
  localStorage.removeItem(SAVED_INVOICES_KEY);
}
