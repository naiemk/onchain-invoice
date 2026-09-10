import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AddressBox } from "@/components/AddressBox";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useLocale } from "@/providers/LocaleProvider";
import { cn } from "@/lib/utils";
import {
  isPayInEvmAddress,
  matchCountryFromGeo,
  type PayInCountry,
  type PayInQuoteRow,
} from "@/shared/pay-in.js";
import { metamaskOnrampAdapter } from "./adapters/metamask.js";
import { closeCheckoutTab, navigateCheckoutTab, openBlankCheckoutTab } from "./openCheckoutTab.js";
import type { OnrampConfig, OnrampFlowProps } from "./types.js";

type Step = "amount" | "methods" | "providers";

export function OnrampFlow({
  lockedAddress,
  initialAddress = "",
  initialAmount,
  initialFiat,
  initialRegion,
  invoicePrice,
  invoiceId,
  adapter = metamaskOnrampAdapter,
}: OnrampFlowProps) {
  const { t } = useLocale();
  const [config, setConfig] = useState<OnrampConfig | null>(null);
  const [countries, setCountries] = useState<PayInCountry[]>([]);
  const [region, setRegion] = useState(initialRegion?.trim().toLowerCase() ?? "");
  const [fiat, setFiat] = useState(initialFiat?.trim().toUpperCase() ?? "");
  const [amount, setAmount] = useState(initialAmount?.trim() ?? "");
  const [address, setAddress] = useState(lockedAddress ?? initialAddress);
  const [quotes, setQuotes] = useState<PayInQuoteRow[]>([]);
  const [methodId, setMethodId] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [step, setStep] = useState<Step>("amount");
  const [bootError, setBootError] = useState("");
  const [quoteError, setQuoteError] = useState("");
  const [loadingCountries, setLoadingCountries] = useState(true);
  const [loadingQuotes, setLoadingQuotes] = useState(false);
  const [loadingCheckout, setLoadingCheckout] = useState(false);
  const [fallbackUrl, setFallbackUrl] = useState("");
  const [countryOpen, setCountryOpen] = useState(false);
  const [fiatOpen, setFiatOpen] = useState(false);
  const [leaveOpen, setLeaveOpen] = useState(false);

  const selectedCountry = useMemo(
    () => countries.find((c) => c.id === region),
    [countries, region]
  );
  const fiatOptions = selectedCountry?.fiats?.length ? selectedCountry.fiats : ["USD", "EUR", "GBP"];
  const destination = (lockedAddress ?? address).trim();
  const methods = useMemo(() => uniqueMethods(quotes), [quotes]);
  const methodQuotes = useMemo(
    () => quotes.filter((q) => q.paymentMethodId === methodId),
    [quotes, methodId]
  );
  const selectedQuote = quotes.find((q) => q.id === selectedId) ?? methodQuotes[0];
  const youGet = selectedQuote?.cryptoAmount ?? "";

  useEffect(() => {
    if (lockedAddress) setAddress(lockedAddress);
  }, [lockedAddress]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const cfg = await adapter.getConfig();
        if (cancelled) return;
        setConfig(cfg);
        if (!cfg.enabled) return;
        if (!initialAmount) setAmount((prev) => prev || cfg.defaultAmount);
        const [list, geo] = await Promise.all([
          adapter.getCountries(),
          initialRegion?.trim() ? Promise.resolve("") : adapter.getGeo().catch(() => ""),
        ]);
        if (cancelled) return;
        setCountries(list);
        let next = initialRegion?.trim().toLowerCase() ?? "";
        if (next && !list.some((c) => c.id === next)) next = "";
        if (!next) {
          const matched = matchCountryFromGeo(geo, list);
          if (matched) next = matched.id;
        }
        if (cancelled) return;
        if (next) {
          setRegion(next);
          const row = list.find((c) => c.id === next);
          if (row && !initialFiat) setFiat(row.defaultFiat);
        }
      } catch (error) {
        if (!cancelled) setBootError(error instanceof Error ? error.message : t("buy.unavailable"));
      } finally {
        if (!cancelled) setLoadingCountries(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [adapter, initialAmount, initialFiat, initialRegion, t]);

  useEffect(() => {
    if (!selectedCountry) return;
    setFiat((prev) => {
      if (initialFiat && selectedCountry.fiats.includes(initialFiat.toUpperCase()) && !prev) {
        return initialFiat.toUpperCase();
      }
      if (prev && selectedCountry.fiats.includes(prev)) return prev;
      return selectedCountry.defaultFiat;
    });
  }, [initialFiat, selectedCountry]);

  useEffect(() => {
    if (!config?.enabled || !region || !fiat || !amount || !isPayInEvmAddress(destination)) {
      setQuotes([]);
      setSelectedId("");
      setMethodId("");
      return;
    }
    const amountNum = Number(amount);
    if (!Number.isFinite(amountNum) || amountNum <= 0) {
      setQuotes([]);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setLoadingQuotes(true);
      setQuoteError("");
      void adapter
        .getQuotes({ region, fiat, amount, address: destination })
        .then((result) => {
          if (cancelled) return;
          setQuotes(result.quotes);
          setMethodId((prev) => {
            if (result.quotes.some((q) => q.paymentMethodId === prev)) return prev;
            return result.quotes[0]?.paymentMethodId ?? "";
          });
          setSelectedId((prev) => {
            if (result.quotes.some((q) => q.id === prev)) return prev;
            return result.quotes[0]?.id ?? "";
          });
        })
        .catch((error: unknown) => {
          if (cancelled) return;
          setQuotes([]);
          setSelectedId("");
          setMethodId("");
          setQuoteError(error instanceof Error ? error.message : t("common.loadFailed"));
        })
        .finally(() => {
          if (!cancelled) setLoadingQuotes(false);
        });
    }, 400);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [adapter, amount, config?.enabled, destination, fiat, region, t]);

  async function onContinue(): Promise<void> {
    if (!selectedQuote) return;
    if (!isPayInEvmAddress(destination)) {
      setQuoteError(t("buy.invalidAddress"));
      return;
    }
    setFallbackUrl("");
    setQuoteError("");
    const tab = openBlankCheckoutTab();
    setLoadingCheckout(true);
    try {
      const session = await adapter.startCheckout({
        quote: selectedQuote,
        destination,
        region,
        fiat,
        amount,
      });
      const opened = navigateCheckoutTab(tab, session.checkoutUrl);
      if (!opened) {
        closeCheckoutTab(tab);
        setFallbackUrl(session.checkoutUrl);
        setQuoteError(t("buy.popupBlocked"));
        return;
      }
      setFallbackUrl("");
    } catch (error) {
      closeCheckoutTab(tab);
      setQuoteError(error instanceof Error ? error.message : t("buy.widgetFailed"));
    } finally {
      setLoadingCheckout(false);
    }
  }

  if (loadingCountries) {
    return <p className="text-sm text-muted-foreground">{t("buy.loadingCountries")}</p>;
  }

  if (bootError) {
    return (
      <Alert variant="destructive">
        <AlertDescription>{bootError}</AlertDescription>
      </Alert>
    );
  }

  if (!config?.enabled) {
    return (
      <Alert>
        <AlertDescription>{t("buy.unavailable")}</AlertDescription>
      </Alert>
    );
  }

  if (step === "methods") {
    return (
      <PickerScreen title={t("buy.paymentMethodsTitle")} onBack={() => setStep("amount")}>
        <ul className="space-y-1" role="listbox" aria-label={t("buy.paymentMethodsTitle")}>
          {methods.map((method) => {
            const selected = method.id === methodId;
            return (
              <li key={method.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={selected}
                  className={cn(
                    "flex w-full items-center justify-between rounded-xl px-3 py-3 text-left text-sm",
                    selected ? "bg-primary/5" : "hover:bg-muted/50"
                  )}
                  onClick={() => {
                    setMethodId(method.id);
                    const next = quotes.find((q) => q.paymentMethodId === method.id);
                    if (next) setSelectedId(next.id);
                    setStep("providers");
                  }}
                >
                  <span className="font-medium">{method.name}</span>
                  <span
                    className={cn(
                      "h-4 w-4 rounded-full border",
                      selected ? "border-primary bg-primary" : "border-muted-foreground/40"
                    )}
                  />
                </button>
              </li>
            );
          })}
        </ul>
      </PickerScreen>
    );
  }

  if (step === "providers") {
    return (
      <PickerScreen title={t("buy.selectProvider")} onBack={() => setStep("methods")}>
        <button
          type="button"
          className="mb-4 flex w-full items-center justify-between rounded-xl border border-border bg-muted/40 px-4 py-3 text-left"
          onClick={() => setStep("methods")}
        >
          <span>
            <span className="block text-xs text-muted-foreground">{t("buy.quoteMethod")}</span>
            <span className="text-sm font-medium">{selectedQuote?.paymentMethodName}</span>
          </span>
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        </button>
        <p className="mb-2 text-xs font-medium text-muted-foreground">{t("buy.allProviders")}</p>
        <ul className="space-y-1" role="listbox" aria-label={t("buy.selectProvider")}>
          {methodQuotes.map((quote) => {
            const selected = quote.id === selectedId;
            return (
              <li key={quote.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={selected}
                  className={cn(
                    "flex w-full items-center justify-between gap-3 rounded-xl px-3 py-3 text-left",
                    selected ? "bg-primary/5" : "hover:bg-muted/50"
                  )}
                  onClick={() => {
                    setSelectedId(quote.id);
                    setStep("amount");
                  }}
                >
                  <span className="text-sm font-medium">{quote.provider}</span>
                  <span className="flex items-center gap-3">
                    <span className="font-mono text-sm">
                      {quote.cryptoAmount} {config.token}
                    </span>
                    <span
                      className={cn(
                        "h-4 w-4 rounded-full border",
                        selected ? "border-primary bg-primary" : "border-muted-foreground/40"
                      )}
                    />
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </PickerScreen>
    );
  }

  const underInvoice =
    invoicePrice && youGet && Number(youGet) > 0 && Number(youGet) + 1e-9 < Number(invoicePrice);

  return (
    <div className="space-y-5">
      {invoiceId && (
        <p className="text-xs text-muted-foreground">{t("buy.payingInvoice", { id: invoiceId.slice(0, 10) })}</p>
      )}
      <p className="text-sm text-muted-foreground">
        {t("buy.networkLine", { token: config.token, network: config.networkLabel })}
      </p>

      <div className="space-y-3 rounded-2xl border border-border bg-card p-4">
        <AmountRow
          label={t("buy.youPay")}
          value={amount}
          onChange={setAmount}
          chip={
            <ChipButton
              onClick={() => setFiatOpen(true)}
              label={`${selectedCountry?.emoji ? `${selectedCountry.emoji} ` : ""}${fiat || t("buy.currencyLabel")}`}
            />
          }
        />
        <AmountRow
          label={t("buy.youGet")}
          value={loadingQuotes ? "…" : youGet || "—"}
          readOnly
          chip={<ChipButton disabled label={`${config.token} · ${config.networkLabel}`} />}
        />
      </div>

      <div className="flex flex-wrap gap-2">
        {presetAmounts(amount || config.defaultAmount).map((preset) => (
          <Button
            key={preset}
            type="button"
            variant={preset === amount ? "default" : "secondary"}
            size="sm"
            className="rounded-full"
            onClick={() => setAmount(preset)}
          >
            {preset}
          </Button>
        ))}
      </div>

      <button
        type="button"
        className="flex w-full items-center justify-between rounded-xl border border-border bg-muted/30 px-4 py-3 text-left"
        onClick={() => methods.length > 0 && setStep("methods")}
        disabled={methods.length === 0}
      >
        <span>
          <span className="block text-sm font-medium">
            {selectedQuote?.paymentMethodName ?? t("buy.selectQuote")}
          </span>
          {selectedQuote && (
            <span className="text-xs text-muted-foreground">
              {t("buy.withProvider", { provider: selectedQuote.provider })}
            </span>
          )}
        </span>
        <ChevronRight className="h-4 w-4 text-muted-foreground" />
      </button>

      {!lockedAddress && (
        <div className="space-y-2">
          <Label htmlFor="onramp-address">{t("buy.addressLabel")}</Label>
          <Input
            id="onramp-address"
            value={address}
            onChange={(event) => setAddress(event.target.value)}
            placeholder="0x…"
            autoComplete="off"
            spellCheck={false}
          />
          <p className="text-xs text-muted-foreground">{t("buy.addressHint")}</p>
          {address.trim() && !isPayInEvmAddress(address) && (
            <p className="text-xs text-destructive">{t("buy.invalidAddress")}</p>
          )}
        </div>
      )}

      {lockedAddress && (
        <div className="space-y-1">
          <p className="text-xs font-medium text-muted-foreground">{t("buy.destinationLabel")}</p>
          <AddressBox address={lockedAddress} />
        </div>
      )}

      {invoicePrice && (
        <p className="text-xs text-muted-foreground">
          {t("buy.invoiceCover", { amount: invoicePrice, token: config.token })}
        </p>
      )}
      {underInvoice && (
        <Alert variant="warn">
          <AlertDescription>{t("buy.invoiceShortfall")}</AlertDescription>
        </Alert>
      )}

      {quoteError && (
        <Alert variant="destructive">
          <AlertDescription>{quoteError}</AlertDescription>
        </Alert>
      )}
      {fallbackUrl && (
        <p className="text-sm">
          <a href={fallbackUrl} target="_blank" rel="noreferrer" className="text-primary underline">
            {t("buy.openCheckout")}
          </a>
        </p>
      )}

      <Button
        type="button"
        className="w-full"
        size="lg"
        disabled={!selectedQuote || loadingQuotes || loadingCheckout || !isPayInEvmAddress(destination)}
        onClick={() => setLeaveOpen(true)}
      >
        {loadingCheckout ? t("buy.loadingWidget") : t("buy.continue")}
      </Button>
      <p className="text-xs text-muted-foreground">{t("buy.continueHint")}</p>

      <Dialog open={leaveOpen} onOpenChange={setLeaveOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t("buy.leaveSiteTitle")}</DialogTitle>
            <DialogDescription>{t("buy.leaveSiteBody")}</DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button type="button" variant="ghost" onClick={() => setLeaveOpen(false)}>
              {t("buy.leaveSiteCancel")}
            </Button>
            <Button
              type="button"
              disabled={loadingCheckout}
              onClick={() => {
                setLeaveOpen(false);
                void onContinue();
              }}
            >
              {t("buy.leaveSiteContinue")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Sheet open={countryOpen} onOpenChange={setCountryOpen}>
        <SheetContent side="bottom" className="max-h-[80vh] overflow-y-auto">
          <SheetHeader>
            <SheetTitle>{t("buy.countryLabel")}</SheetTitle>
          </SheetHeader>
          <ul className="mt-4 space-y-1">
            {countries.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  className={cn(
                    "w-full rounded-lg px-3 py-2 text-left text-sm",
                    c.id === region ? "bg-primary/10" : "hover:bg-muted/50"
                  )}
                  onClick={() => {
                    setRegion(c.id);
                    setFiat(c.defaultFiat);
                    setCountryOpen(false);
                  }}
                >
                  {c.emoji ? `${c.emoji} ` : ""}
                  {c.name}
                </button>
              </li>
            ))}
          </ul>
        </SheetContent>
      </Sheet>

      <Sheet open={fiatOpen} onOpenChange={setFiatOpen}>
        <SheetContent side="bottom" className="max-h-[80vh] overflow-y-auto">
          <SheetHeader>
            <SheetTitle>{t("buy.currencyLabel")}</SheetTitle>
          </SheetHeader>
          <button
            type="button"
            className="mt-4 flex w-full items-center justify-between rounded-xl border border-border px-4 py-3 text-left"
            onClick={() => {
              setFiatOpen(false);
              setCountryOpen(true);
            }}
          >
            <span className="text-sm">
              {selectedCountry ? `${selectedCountry.emoji ?? ""} ${selectedCountry.name}` : t("buy.countryLabel")}
            </span>
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          </button>
          <ul className="mt-3 space-y-1">
            {fiatOptions.map((code) => (
              <li key={code}>
                <button
                  type="button"
                  className={cn(
                    "w-full rounded-lg px-3 py-2 text-left text-sm",
                    code === fiat ? "bg-primary/10" : "hover:bg-muted/50"
                  )}
                  onClick={() => {
                    setFiat(code);
                    setFiatOpen(false);
                  }}
                >
                  {code}
                </button>
              </li>
            ))}
          </ul>
        </SheetContent>
      </Sheet>
    </div>
  );
}

function PickerScreen({
  title,
  onBack,
  children,
}: {
  title: string;
  onBack: () => void;
  children: ReactNode;
}) {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Button type="button" variant="ghost" size="icon" onClick={onBack} aria-label="Back">
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <h2 className="text-base font-semibold">{title}</h2>
      </div>
      {children}
    </div>
  );
}

function AmountRow({
  label,
  value,
  onChange,
  readOnly,
  chip,
}: {
  label: string;
  value: string;
  onChange?: (value: string) => void;
  readOnly?: boolean;
  chip: ReactNode;
}) {
  return (
    <div className="flex items-end justify-between gap-3">
      <div className="min-w-0 flex-1">
        <p className="text-xs text-muted-foreground">{label}</p>
        {readOnly ? (
          <p className="truncate font-mono text-2xl font-semibold tracking-tight">{value}</p>
        ) : (
          <Input
            inputMode="decimal"
            value={value}
            onChange={(event) => onChange?.(event.target.value)}
            className="h-auto border-0 bg-transparent px-0 font-mono text-2xl font-semibold shadow-none focus-visible:ring-0"
          />
        )}
      </div>
      {chip}
    </div>
  );
}

function ChipButton({
  label,
  onClick,
  disabled,
}: {
  label: string;
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <Button
      type="button"
      variant="secondary"
      size="sm"
      className="shrink-0 rounded-full"
      onClick={onClick}
      disabled={disabled}
    >
      {label}
      {!disabled && <ChevronRight className="h-3.5 w-3.5" />}
    </Button>
  );
}

function uniqueMethods(quotes: PayInQuoteRow[]): Array<{ id: string; name: string }> {
  const seen = new Set<string>();
  const out: Array<{ id: string; name: string }> = [];
  for (const q of quotes) {
    if (seen.has(q.paymentMethodId)) continue;
    seen.add(q.paymentMethodId);
    out.push({ id: q.paymentMethodId, name: q.paymentMethodName });
  }
  return out;
}

function presetAmounts(current: string): string[] {
  const n = Number(current);
  const base = Number.isFinite(n) && n > 0 ? n : 100;
  const raw =
    base >= 400
      ? [Math.round(base * 0.5), Math.round(base), Math.round(base * 2), Math.round(base * 3)]
      : [50, 100, 200, 500];
  const seen = new Set<string>();
  return raw
    .map((v) => String(v))
    .filter((v) => {
      if (seen.has(v)) return false;
      seen.add(v);
      return true;
    });
}
