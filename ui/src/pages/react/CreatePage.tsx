import { useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
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

const WIZARD_STEPS = [
  { step: 1 as const, labelKey: "create.stepDetails" as const },
  { step: 2 as const, labelKey: "create.stepNetwork" as const },
  { step: 3 as const, labelKey: "create.stepAmount" as const },
];

const PAYMENT_MODES: PaymentMode[] = ["crypto", "crypto_or_fiat", "fiat"];

export function CreatePage() {
  const { t } = useLocale();
  const [docsOpen, setDocsOpen] = useState(location.hash === "#docs");
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
    <div className="mx-auto max-w-6xl px-4 py-8 md:px-8">
      <header className="mb-8 space-y-2">
        <p className="text-sm font-medium uppercase tracking-wider text-primary">
          {t("create.eyebrow", { mode: modeLabel })}
        </p>
        <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">{t("create.h1")}</h1>
        <p className="text-lg text-muted-foreground">{t("create.lede")}</p>
        {mode === "testnet" && (
          <Alert variant="ok">
            <AlertDescription>{t("create.testnetCallout")}</AlertDescription>
          </Alert>
        )}
      </header>

      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <Card>
          <CardContent className="pt-6">
            <nav
              className="mb-6"
              aria-label={t("create.stepOf", { current: String(state.currentStep), total: "3" })}
            >
              <ol className="flex flex-wrap gap-2">
                {WIZARD_STEPS.map(({ step, labelKey }) => {
                  if (step === 2 && omitNetworkStep) return null;
                  const isActive = state.currentStep === step;
                  const isDone = state.currentStep > step && !(omitNetworkStep && step === 2);
                  return (
                    <li key={step}>
                      <Button
                        type="button"
                        variant={isActive ? "default" : isDone ? "secondary" : "outline"}
                        size="sm"
                        onClick={() => gotoStepClick(step)}
                      >
                        {t(labelKey)}
                      </Button>
                    </li>
                  );
                })}
              </ol>
            </nav>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                void handleSubmit();
              }}
              autoComplete="off"
              className="space-y-6"
            >
              {/* Step 1 — Details */}
              {state.currentStep === 1 && (
                <div className="space-y-5">
                  <div className="space-y-2">
                    <Label htmlFor="clientInvoiceId">{t("create.clientIdLabel")}</Label>
                    <p className="text-sm text-muted-foreground">{t("create.clientIdHint")}</p>
                    <Input
                      id="clientInvoiceId"
                      className="font-mono"
                      placeholder={t("create.clientIdPlaceholder")}
                      value={state.clientInvoiceId}
                      onChange={(e) => setField("clientInvoiceId", e.target.value)}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="title">{t("create.titleLabel")}</Label>
                    <p className="text-sm text-muted-foreground">{t("create.titleHint")}</p>
                    <Input
                      id="title"
                      placeholder={t("create.titlePlaceholder")}
                      value={state.title}
                      onChange={(e) => setField("title", e.target.value)}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="description">{t("create.descriptionLabel")}</Label>
                    <p className="text-sm text-muted-foreground">{t("create.descriptionHint")}</p>
                    <Textarea
                      id="description"
                      placeholder={t("create.descriptionPlaceholder")}
                      value={state.description}
                      onChange={(e) => setField("description", e.target.value)}
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
                </div>
              )}

              {/* Step 2 — Network */}
              {state.currentStep === 2 && (
                <div className="space-y-5">
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
                              <Badge variant="secondary" className="text-xs">
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
                          <Button type="button" variant="secondary" disabled={state.passkeyBusy} onClick={() => void usePasskeyWallet()}>
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
                            <Button type="button" variant="secondary" disabled={state.passkeyBusy} onClick={() => void usePasskeyWallet()}>
                              {t("create.usePasskeyWallet")}
                            </Button>
                            {state.passkeyWalletAddress && (
                              <Button type="button" variant="secondary" onClick={clearPasskeyWallet}>
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
                </div>
              )}

              {/* Step 3 — Amount */}
              {state.currentStep === 3 && (
                <div className="space-y-5">
                  <div className="space-y-2">
                    <Label htmlFor="price">
                      {paymentMode === "fiat" ? t("create.fiatPayLabel") : t("create.amountLabel")}{" "}
                      <span className="text-destructive">{t("common.required")}</span>
                    </Label>
                    <p className="text-sm text-muted-foreground">
                      {paymentMode === "fiat" ? t("create.fiatPayHint") : t("create.amountHint")}
                    </p>
                    <Input
                      id="price"
                      inputMode="decimal"
                      placeholder="10.00"
                      value={state.price}
                      onChange={(e) => {
                        setField("price", e.target.value);
                        onFiatFieldChange("amount", (prev) => ({ ...prev, price: e.target.value }));
                      }}
                    />
                    {state.amountLimits && (
                      <p className="text-sm text-muted-foreground">{state.amountLimits}</p>
                    )}
                  </div>

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
                      <p className="text-sm text-muted-foreground">{t("create.allowPartialHint")}</p>
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

              {state.formActionStatus && (
                <p className={cn("text-sm", state.formActionError ? "text-destructive" : "text-muted-foreground")}>
                  {state.formActionStatus}
                </p>
              )}

              <div className="flex flex-wrap gap-2">
                {state.currentStep > 1 && (
                  <Button type="button" variant="secondary" onClick={wizardBack}>
                    {t("create.back")}
                  </Button>
                )}
                {state.currentStep < 3 && (
                  <Button type="button" onClick={wizardNext}>
                    {t("create.next")}
                  </Button>
                )}
                {state.currentStep === 3 && (
                  <>
                    <Button type="submit" disabled={!previewValid}>
                      {t("create.openCheckout")}
                    </Button>
                    <Button type="button" variant="secondary" disabled={!previewValid} onClick={() => void copyPayLink()}>
                      {t("create.copyPayLink")}
                    </Button>
                  </>
                )}
              </div>
            </form>
          </CardContent>
        </Card>

        {/* Preview aside */}
        <Card className="h-fit lg:sticky lg:top-4">
          <CardHeader>
            <p className="text-sm font-medium uppercase tracking-wider text-primary">{t("create.outputEyebrow")}</p>
            <CardTitle>{t("create.outputTitle")}</CardTitle>
            <CardDescription>{t("create.outputHint")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {preview?.error ? (
              <p className="text-sm text-destructive">{preview.error}</p>
            ) : preview ? (
              <Tabs defaultValue="link">
                <TabsList className="w-full">
                  <TabsTrigger value="link" className="flex-1">
                    {t("create.payLinkLabel")}
                  </TabsTrigger>
                  <TabsTrigger value="embed" className="flex-1">
                    {t("create.embedLabel")}
                  </TabsTrigger>
                  <TabsTrigger value="iframe" className="flex-1">
                    {t("create.iframeLabel")}
                  </TabsTrigger>
                </TabsList>
                <TabsContent value="link">
                  <pre className="overflow-x-auto rounded-md bg-muted p-3 text-xs">{preview.link}</pre>
                </TabsContent>
                <TabsContent value="embed" className="space-y-2">
                  <pre className="overflow-x-auto rounded-md bg-muted p-3 text-xs">{preview.embed}</pre>
                  <Button type="button" variant="secondary" size="sm" onClick={() => void copyEmbed()}>
                    {t("create.copyHtml")}
                  </Button>
                </TabsContent>
                <TabsContent value="iframe" className="space-y-2">
                  <p className="text-sm text-muted-foreground">{t("create.iframeHint")}</p>
                  <pre className="overflow-x-auto rounded-md bg-muted p-3 text-xs">{preview.iframe}</pre>
                  <Button type="button" variant="secondary" size="sm" onClick={() => void copyIframe()}>
                    {t("create.copyHtml")}
                  </Button>
                </TabsContent>
              </Tabs>
            ) : null}

            {preview && !preview.error && (
              <div className="space-y-2">
                <Label>{t("create.renderedLabel")}</Label>
                <div className="rounded-md border p-4">
                  <a
                    href={preview.path}
                    className="tc-pay-button inline-block rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground no-underline"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {preview.payLabel}
                  </a>
                </div>
              </div>
            )}

            {state.copyStatus && <p className="text-sm text-muted-foreground">{state.copyStatus}</p>}

            <div className="space-y-2">
              <Label htmlFor="pay-chrome">{t("create.chromeLabel")}</Label>
              <p className="text-sm text-muted-foreground">{t("create.chromeHint")}</p>
              <Select
                value={state.payChrome}
                onValueChange={(v) => setField("payChrome", v as PayChrome)}
              >
                <SelectTrigger id="pay-chrome">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="full">{t("create.chromeFull")}</SelectItem>
                  <SelectItem value="minimal">{t("create.chromeMinimal")}</SelectItem>
                  <SelectItem value="none">{t("create.chromeNone")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Collapsible API docs */}
      <section id="create-docs" className="mt-10">
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
