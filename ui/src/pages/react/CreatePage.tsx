import { useState } from "react";
import { ArrowUpRight, ChevronDown, ChevronUp, Shield } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageHero } from "@/components/PageHero";
import { PageCard } from "@/components/PageSplit";
import { PreviewPanel } from "@/components/PreviewPanel";
import { Money } from "@/components/Money";
import { useLocale } from "@/providers/LocaleProvider";
import { cn } from "@/lib/utils";
import { chainLogoSvg, networkShort } from "@/shared/networks.js";
import { shortAddress } from "@/shared/wallet-session.js";
import { LOCALES, LOCALE_NATIVE_NAMES } from "@/i18n/locales.js";
import { listCountries } from "@/pages/create/country.js";
import { AUTO_VALUE } from "@/pages/create/fiat-rules.js";
import type { PaymentMode } from "@/shared/types.js";
import type { PayChrome } from "@/shared/pay-chrome.js";
import { useCreateForm } from "@/pages/react/create/useCreateForm.js";

function ChainLogo({ chainId, size = 20 }: { chainId: string; size?: number }) {
  return (
    <span
      className="inline-flex shrink-0 [&_.chain-logo]:block"
      dangerouslySetInnerHTML={{ __html: chainLogoSvg(chainId, size) }}
    />
  );
}

const PAYMENT_MODES: PaymentMode[] = ["crypto", "crypto_or_fiat", "fiat"];

export function CreatePage() {
  const { t } = useLocale();
  const [docsOpen, setDocsOpen] = useState(location.hash === "#docs");
  const [detailsOpen, setDetailsOpen] = useState(false);
  const form = useCreateForm();
  const {
    state,
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
    walletRegistry,
    preview,
    docsQueryLink,
    locale,
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
    persistPrefs,
  } = form;

  const countries = listCountries(locale);
  const fiatOptions =
    state.onrampFiats.length > 0 ? state.onrampFiats : ["SEK", "EUR", "USD", "GBP"];
  const previewValid = preview && !preview.error;

  const paymentModeTitle = (m: PaymentMode) => {
    const keys = {
      crypto: "create.paymentModeCryptoTitle",
      crypto_or_fiat: "create.paymentModeBothTitle",
      fiat: "create.paymentModeFiatTitle",
    } as const;
    return t(keys[m]);
  };

  const paymentModeHint = (m: PaymentMode) => {
    const keys = {
      crypto: "create.paymentModeCryptoHint",
      crypto_or_fiat: "create.paymentModeBothHint",
      fiat: "create.paymentModeFiatHint",
    } as const;
    return t(keys[m]);
  };

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 md:px-8">
      <PageHero
        breadcrumb={t("create.breadcrumb")}
        title={t("create.h1")}
        lede={t("create.lede")}
        aside={
          <span className="rounded-full border border-border bg-card px-3 py-1 text-xs font-medium text-muted-foreground">
            {t("create.usuallyUnder60")}
          </span>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <PageCard>
            <div className="mb-6 flex items-center justify-between gap-2">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-emphasis">01</p>
                <h2 className="text-lg font-semibold">{t("create.essentialsTitle")}</h2>
                <p className="text-sm text-muted-foreground">{t("create.essentialsMicro")}</p>
              </div>
              <Badge variant="secondary">{t("create.essentialsHint")}</Badge>
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                void handleSubmit();
              }}
              autoComplete="off"
              className="space-y-6"
            >
              <div className="space-y-5">
                  <div className="space-y-2">
                    <Label htmlFor="title">{t("create.whoLabel")}</Label>
                    <Input
                      id="title"
                      placeholder={t("create.whoPlaceholder")}
                      value={state.title}
                      onChange={(e) => setField("title", e.target.value)}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="description">{t("create.whatLabel")}</Label>
                    <Input
                      id="description"
                      placeholder={t("create.whatPlaceholder")}
                      value={state.description}
                      onChange={(e) => setField("description", e.target.value)}
                    />
                  </div>

                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="price">
                        {t("create.amountDueLabel")}{" "}
                        <span className="text-destructive">{t("common.required")}</span>
                      </Label>
                      <Input
                        id="price"
                        inputMode="decimal"
                        placeholder="0.00 USDC"
                        value={state.price}
                        onChange={(e) => {
                          setField("price", e.target.value);
                          onFiatFieldChange("amount", (prev) => ({ ...prev, price: e.target.value }));
                        }}
                      />
                    </div>
                  </div>
              </div>

              <button
                type="button"
                className="flex w-full items-center justify-between rounded-lg border border-dashed border-border px-4 py-3 text-sm font-medium text-muted-foreground hover:border-primary/30 hover:text-foreground"
                onClick={() => setDetailsOpen((o) => !o)}
                aria-expanded={detailsOpen}
              >
                {t("create.addDetails")}
                {detailsOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              </button>

              {detailsOpen && (
                <div className="space-y-5 rounded-lg border border-border bg-muted/30 p-4">

                  <div className="space-y-2">
                    <Label htmlFor="clientInvoiceId">{t("create.clientIdLabel")}</Label>
                    <Input
                      id="clientInvoiceId"
                      className="font-mono"
                      placeholder={t("create.clientIdPlaceholder")}
                      value={state.clientInvoiceId}
                      onChange={(e) => setField("clientInvoiceId", e.target.value)}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="callback">{t("create.callbackLabel")}</Label>
                    <p className="text-sm text-muted-foreground">{t("create.callbackHint")}</p>
                    <Input
                      id="callback"
                      type="url"
                      placeholder="https://shop.example/webhooks/trustless-commerce"
                      value={state.callback}
                      onChange={(e) => setField("callback", e.target.value)}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="lang">{t("create.langLabel")}</Label>
                    <p className="text-sm text-muted-foreground">{t("create.langHint")}</p>
                    <Select value={state.lang || "__default__"} onValueChange={(v) => setField("lang", v === "__default__" ? "" : v)}>
                      <SelectTrigger id="lang">
                        <SelectValue placeholder={t("create.langDefault")} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__default__">{t("create.langDefault")}</SelectItem>
                        {LOCALES.map((loc) => (
                          <SelectItem key={loc} value={loc}>
                            {LOCALE_NATIVE_NAMES[loc]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {state.onrampEnabled && (
                    <div className="space-y-2">
                      <Label>{t("create.invoiceTypeLabel")}</Label>
                      <p className="text-sm text-muted-foreground">{t("create.invoiceTypeHint")}</p>
                      <div className="grid gap-3 sm:grid-cols-3" role="radiogroup" aria-label={t("create.paymentModeAria")}>
                        {PAYMENT_MODES.map((m) => (
                          <label
                            key={m}
                            className={cn(
                              "flex cursor-pointer flex-col rounded-lg border p-4 transition-colors",
                              paymentMode === m ? "border-primary bg-primary/5" : "border-border hover:border-primary/40"
                            )}
                          >
                            <input
                              type="radio"
                              name="paymentMode"
                              value={m}
                              checked={state.paymentMode === m}
                              onChange={() => onPaymentModeChange(m)}
                              className="sr-only"
                            />
                            <span className="font-medium">{paymentModeTitle(m)}</span>
                            <span className="mt-1 text-sm text-muted-foreground">{paymentModeHint(m)}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  )}

                  {!skipChainToken && (
                    <div className="space-y-2">
                      <Label>
                        {paymentMode === "fiat" ? t("create.settlementNetworkLabel") : t("create.networksLabel")}{" "}
                        <span className="text-destructive">{t("common.required")}</span>
                      </Label>
                      <p className="text-sm text-muted-foreground">
                        {paymentMode === "fiat" ? t("create.settlementNetworkHint") : t("create.networksHint")}
                      </p>
                      {paymentMode === "fiat" && (
                        <p className="text-sm text-muted-foreground">{t("create.fiatNetworksLockedHint")}</p>
                      )}
                      <div className="flex flex-wrap gap-2" role="group" aria-label={t("create.networksAria")}>
                        {chainRows.map(({ network, checked, disabled, locked }) => (
                          <label
                            key={network.id}
                            className={cn(
                              "inline-flex cursor-pointer items-center gap-2 rounded-full border px-3 py-1.5 text-sm transition-colors",
                              checked ? "border-primary bg-primary/10" : "border-border",
                              disabled && "cursor-not-allowed opacity-60"
                            )}
                          >
                            <Checkbox
                              checked={checked}
                              disabled={disabled || locked}
                              onCheckedChange={(v) => toggleChain(network.id, v === true)}
                            />
                            <ChainLogo chainId={network.id} />
                            <span>{networkShort(network.id)}</span>
                            {locked && (
                              <Badge variant="outline" className="text-xs">
                                {t("common.required")}
                              </Badge>
                            )}
                          </label>
                        ))}
                      </div>
                    </div>
                  )}

                  {needsEvm && (
                    <div className="space-y-2">
                      <Label htmlFor="toEvm">
                        {t("create.evmWalletLabel")}{" "}
                        <span className="text-destructive">{t("common.required")}</span>
                      </Label>
                      <Alert>
                        <AlertDescription>
                          <strong>{t("create.fundsSweptStrong")}</strong> {t("create.evmWalletNote")}
                        </AlertDescription>
                      </Alert>
                      {walletRegistry.length === 0 ? (
                        <div className="space-y-2">
                          <p className="text-sm text-muted-foreground">{t("create.walletNoneHint")}</p>
                          <Button type="button" variant="outline" disabled={state.passkeyBusy} onClick={() => void usePasskeyWallet()}>
                            {t("create.walletCreateButton")}
                          </Button>
                        </div>
                      ) : (
                        <div className="space-y-2">
                          <Label htmlFor="wallet-picker-select">{t("create.walletSelectLabel")}</Label>
                          <p className="text-sm text-muted-foreground">{t("create.walletSelectHint")}</p>
                          <Select value={state.walletPickerValue} onValueChange={onWalletPickerChange}>
                            <SelectTrigger id="wallet-picker-select">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {walletRegistry.map((w) => (
                                <SelectItem key={w.address} value={w.address}>
                                  {w.label} · {shortAddress(w.address)}
                                </SelectItem>
                              ))}
                              <SelectItem value="__custom__">{t("create.walletCustomOption")}</SelectItem>
                            </SelectContent>
                          </Select>
                          <div className="flex flex-wrap gap-2">
                            <Button type="button" variant="outline" disabled={state.passkeyBusy} onClick={() => void usePasskeyWallet()}>
                              {t("create.usePasskeyWallet")}
                            </Button>
                            {state.passkeyWalletAddress && (
                              <Button type="button" variant="outline" onClick={clearPasskeyWallet}>
                                {t("create.changeWallet")}
                              </Button>
                            )}
                          </div>
                          {state.passkeyWalletAddress && (
                            <p className="text-sm text-muted-foreground">
                              {t("create.passkeyWalletLinked", { address: state.passkeyWalletAddress })}
                            </p>
                          )}
                        </div>
                      )}
                      <p className="text-sm text-muted-foreground">{t("create.evmWalletHint")}</p>
                      <Input
                        id="toEvm"
                        className="font-mono"
                        placeholder="0x…"
                        value={state.toEvm}
                        readOnly={state.toEvmReadOnly}
                        aria-invalid={Boolean(state.toEvmError)}
                        onChange={(e) => setField("toEvm", e.target.value)}
                        onBlur={(e) => {
                          markAddress("toEvm", "evm", e.target.value);
                          if (!state.toEvmReadOnly) persistPrefs();
                        }}
                        onInput={(e) => {
                          const v = (e.target as HTMLInputElement).value;
                          if (v.trim()) markAddress("toEvm", "evm", v);
                          else setField("toEvmError", null);
                        }}
                      />
                      {state.toEvmError && <p className="text-sm text-destructive">{state.toEvmError}</p>}
                    </div>
                  )}

                  {needsTron && (
                    <div className="space-y-2">
                      <Label htmlFor="toTron">
                        {t("create.tronWalletLabel")}{" "}
                        <span className="text-destructive">{t("common.required")}</span>
                      </Label>
                      <Alert>
                        <AlertDescription>
                          <strong>{t("create.fundsSweptStrong")}</strong> {t("create.tronWalletNote")}
                        </AlertDescription>
                      </Alert>
                      <p className="text-sm text-muted-foreground">{t("create.tronWalletHint")}</p>
                      <Input
                        id="toTron"
                        className="font-mono"
                        placeholder="T…"
                        value={state.toTron}
                        aria-invalid={Boolean(state.toTronError)}
                        onChange={(e) => setField("toTron", e.target.value)}
                        onBlur={(e) => {
                          markAddress("toTron", "tron", e.target.value);
                          persistPrefs();
                        }}
                        onInput={(e) => {
                          const v = (e.target as HTMLInputElement).value;
                          if (v.trim()) markAddress("toTron", "tron", v);
                          else setField("toTronError", null);
                        }}
                      />
                      {state.toTronError && <p className="text-sm text-destructive">{state.toTronError}</p>}
                    </div>
                  )}

                  {needsSolana && (
                    <div className="space-y-2">
                      <Label htmlFor="toSolana">
                        {t("create.solanaWalletLabel")}{" "}
                        <span className="text-destructive">{t("common.required")}</span>
                      </Label>
                      <Alert>
                        <AlertDescription>
                          <strong>{t("create.fundsSweptStrong")}</strong> {t("create.solanaWalletNote")}
                        </AlertDescription>
                      </Alert>
                      <p className="text-sm text-muted-foreground">{t("create.solanaWalletHint")}</p>
                      <Input
                        id="toSolana"
                        className="font-mono"
                        placeholder="So…"
                        value={state.toSolana}
                        aria-invalid={Boolean(state.toSolanaError)}
                        onChange={(e) => setField("toSolana", e.target.value)}
                        onBlur={(e) => {
                          markAddress("toSolana", "solana", e.target.value);
                          persistPrefs();
                        }}
                        onInput={(e) => {
                          const v = (e.target as HTMLInputElement).value;
                          if (v.trim()) markAddress("toSolana", "solana", v);
                          else setField("toSolanaError", null);
                        }}
                      />
                      {state.toSolanaError && <p className="text-sm text-destructive">{state.toSolanaError}</p>}
                    </div>
                  )}

                  {!skipChainToken && (
                    <div className="space-y-2">
                      <Label>
                        {t("create.tokensLabel")}{" "}
                        <span className="text-destructive">{t("common.required")}</span>
                      </Label>
                      <p className="text-sm text-muted-foreground">{t("create.tokensHint")}</p>
                      {tokenOptions.length === 0 ? (
                        <p className="text-sm text-muted-foreground">{t("create.selectNetworkForTokens")}</p>
                      ) : (
                        <div className="flex flex-wrap gap-4">
                          {tokenOptions.map((token) => (
                            <label key={token.id} className="inline-flex items-center gap-2 text-sm">
                              <Checkbox
                                checked={token.checked}
                                disabled={token.locked}
                                onCheckedChange={(v) => toggleToken(token.id, v === true)}
                              />
                              {token.label}
                              {token.lockHint && (
                                <span className="text-muted-foreground">· {token.lockHint}</span>
                              )}
                            </label>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {paymentMode !== "fiat" && (
                    <div className="space-y-2">
                      <label className="flex items-center gap-2 text-sm">
                        <Checkbox
                          id="allowPartial"
                          checked={state.allowPartial}
                          onCheckedChange={(v) => setField("allowPartial", v === true)}
                        />
                        {t("create.allowPartial")}
                      </label>
                    </div>
                  )}

                  {paymentMode !== "crypto" && (
                    <div className="space-y-4 rounded-lg border p-4">
                      <div className="space-y-2">
                        <Label htmlFor="displayFiat">{t("create.displayFiatLabel")}</Label>
                        <Select
                          value={state.displayFiat}
                          onValueChange={(v) =>
                            onFiatFieldChange("currency", (prev) => ({ ...prev, displayFiat: v }))
                          }
                        >
                          <SelectTrigger id="displayFiat">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {fiatOptions.map((code) => (
                              <SelectItem key={code} value={code}>
                                {code}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="quoteCountry">{t("create.quoteCountryLabel")}</Label>
                        <p className="text-sm text-muted-foreground">{t("create.countrySearchHint")}</p>
                        <Input
                          id="quoteCountry"
                          className="font-mono"
                          list="quote-country-list"
                          maxLength={2}
                          autoComplete="off"
                          value={state.quoteCountry}
                          onChange={(e) =>
                            onFiatFieldChange("country", (prev) => ({ ...prev, quoteCountry: e.target.value }))
                          }
                        />
                        <datalist id="quote-country-list">
                          {countries.map((c) => (
                            <option key={c.code} value={c.code} label={`${c.name} (${c.code.toUpperCase()})`}>
                              {c.name}
                            </option>
                          ))}
                        </datalist>
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="quotePaymentMethod">{t("create.quoteMethodLabel")}</Label>
                        <Select
                          value={state.quotePaymentMethod || AUTO_VALUE}
                          onValueChange={(v) =>
                            onFiatFieldChange("paymentMethod", (prev) => ({ ...prev, quotePaymentMethod: v }))
                          }
                        >
                          <SelectTrigger id="quotePaymentMethod">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value={AUTO_VALUE}>{t("create.quoteMethodAuto")}</SelectItem>
                            {state.quotePaymentMethods.map((m) => (
                              <SelectItem key={m.id} value={m.id}>
                                {m.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="quoteProvider">{t("create.quoteProviderLabel")}</Label>
                        <Select
                          value={state.quoteProvider || AUTO_VALUE}
                          onValueChange={(v) =>
                            onFiatFieldChange("provider", (prev) => ({ ...prev, quoteProvider: v }))
                          }
                        >
                          <SelectTrigger id="quoteProvider">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value={AUTO_VALUE}>{t("create.quoteProviderAuto")}</SelectItem>
                            {state.quoteProviders.map((q) => (
                              <SelectItem key={q.provider} value={q.provider}>
                                {q.provider} · {q.cryptoAmount} {state.quotedToken ?? "USDC"}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="quoteSlippagePct">{t("create.quoteSlippageLabel")}</Label>
                        <p className="text-sm text-muted-foreground">{t("create.quoteSlippageHint")}</p>
                        <Input
                          id="quoteSlippagePct"
                          inputMode="decimal"
                          placeholder="1"
                          value={state.quoteSlippagePct}
                          onChange={(e) =>
                            onFiatFieldChange("drift", (prev) => ({ ...prev, quoteSlippagePct: e.target.value }))
                          }
                        />
                      </div>

                      {state.fiatChargePreview && (
                        <Alert variant="ok">
                          <AlertDescription>{state.fiatChargePreview}</AlertDescription>
                        </Alert>
                      )}
                      {state.fiatQuoteStatus && (
                        <p className="text-sm text-muted-foreground">{state.fiatQuoteStatus}</p>
                      )}
                    </div>
                  )}
                </div>
              )}

              <div className="flex items-center justify-between gap-4 border-t border-border pt-4">
                <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Shield className="h-3.5 w-3.5" aria-hidden />
                  USDC · Base network · no intermediary
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button type="submit" disabled={!previewValid}>
                    {t("create.createPayLink")}
                    <ArrowUpRight className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>

              {state.formActionStatus && (
                <p className={cn("text-sm", state.formActionError ? "text-destructive" : "text-muted-foreground")}>
                  {state.formActionStatus}
                </p>
              )}

            </form>
        </PageCard>

        <PreviewPanel tag="DRAFT" className="h-fit lg:sticky lg:top-24">
          <div className="rounded-lg bg-brand-panel-foreground/10 p-4">
            <p className="text-xs text-brand-panel-foreground/70">{t("brand")}</p>
            <p className="mt-4 text-xs uppercase tracking-wide text-brand-panel-foreground/60">{t("create.previewAmountDue")}</p>
            {preview?.error ? (
              <p className="mt-2 text-sm text-destructive">{preview.error}</p>
            ) : (
              <div className="mt-1">
                <Money
                  amount={state.price || "0.00"}
                  className="text-brand-panel-foreground"
                  size="lg"
                />
                <p className="mt-1 text-sm text-brand-panel-foreground/70">USDC on Base</p>
              </div>
            )}
            <dl className="mt-6 space-y-2 text-sm">
              <div className="flex justify-between gap-4">
                <dt className="text-brand-panel-foreground/60">To</dt>
                <dd className="text-end font-medium">{state.title || "—"}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-brand-panel-foreground/60">For</dt>
                <dd className="text-end font-medium">{state.description || "—"}</dd>
              </div>
            </dl>
          </div>
          <p className="mt-4 text-xs text-brand-panel-foreground/70">{t("create.previewSettlement")}</p>
          <p className="mt-1 text-xs text-brand-panel-foreground/60">{t("create.previewCustomerPays")}</p>
          {preview && !preview.error && (
            <div className="mt-4 space-y-2 border-t border-brand-panel-foreground/10 pt-4">
              <Button type="button" variant="secondary" size="sm" className="w-full" disabled={!previewValid} onClick={() => void copyPayLink()}>
                {t("create.copyPayLink")}
              </Button>
            </div>
          )}
        </PreviewPanel>
      </div>

      {/* Collapsible API docs — keep simplified */}
      <section id="create-docs" className="mt-10 hidden">
        <Card>
          <CardHeader className="cursor-pointer" onClick={() => setDocsOpen((o) => !o)}>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium uppercase tracking-wider text-primary">{t("create.docsEyebrow")}</p>
                <CardTitle>{t("create.docsTitle")}</CardTitle>
              </div>
              <Button type="button" variant="ghost" size="icon" aria-expanded={docsOpen}>
                {docsOpen ? <ChevronUp className="h-5 w-5" /> : <ChevronDown className="h-5 w-5" />}
              </Button>
            </div>
            <CardDescription>{t("create.docsIntro")}</CardDescription>
          </CardHeader>
          {docsOpen && (
            <CardContent className="space-y-6 border-t pt-6">
              <div>
                <h3 className="mb-2 font-semibold">{t("create.docsQueryTitle")}</h3>
                <p className="mb-2 text-sm text-muted-foreground">{t("create.docsQueryHint")}</p>
                <pre className="overflow-x-auto rounded-md bg-muted p-3 text-xs">{docsQueryLink}</pre>
              </div>

              <div>
                <h3 className="mb-2 font-semibold">{t("create.docsCreateTitle")}</h3>
                <pre className="overflow-x-auto rounded-md bg-muted p-3 text-xs">{`POST /api/invoices
Content-Type: application/json

{
  "price": "10.00",
  "to": ["0x…", "T…"],
  "chains": ["11155111", "nile"],
  "tokens": ["USDC", "USDT"],
  "clientInvoiceId": "order-1042",
  "chainId": "11155111",
  "token": "USDC",
  "selectedTo": "0x…",
  "callback": "https://shop.example/hooks",
  "title": "Invoice",
  "description": "Optional",
  "allowPartial": false,
  "paymentMode": "crypto"
}`}</pre>
                <p className="mt-2 text-sm text-muted-foreground">{t("create.docsCreateHint")}</p>
              </div>

              <div>
                <h3 className="mb-2 font-semibold">{t("create.docsStatusTitle")}</h3>
                <pre className="overflow-x-auto rounded-md bg-muted p-3 text-xs">{`GET /api/invoices/{invoiceId}

${t("create.docsStatusLine")}`}</pre>
                <p className="mt-2 text-sm text-muted-foreground">{t("create.docsStatusHint")}</p>
              </div>

              <div>
                <h3 className="mb-2 font-semibold">{t("create.docsAgentsTitle")}</h3>
                <p className="text-sm text-muted-foreground">
                  {t("create.docsAgentsBody")}{" "}
                  <a
                    href="https://raw.githubusercontent.com/naiemk/onchain-invoice/main/.cursor/skills/trustless-commerce-invoice/SKILL.md"
                    rel="alternate noopener noreferrer"
                    target="_blank"
                    className="font-mono text-primary underline"
                  >
                    .cursor/skills/trustless-commerce-invoice/SKILL.md
                  </a>{" "}
                  ·{" "}
                  <a
                    href="https://naiemk.github.io/onchain-invoice/"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary underline"
                  >
                    {t("create.docsGithubPages")}
                  </a>
                  .
                </p>
              </div>
            </CardContent>
          )}
        </Card>
      </section>
    </div>
  );
}
