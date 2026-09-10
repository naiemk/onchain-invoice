import type { PayInConfig, PayInCountry, PayInQuoteRow, PayInQuotesResult } from "@/shared/pay-in.js";

export type OnrampConfig = PayInConfig;
export type OnrampCountry = PayInCountry;
export type OnrampQuote = PayInQuoteRow;
export type OnrampQuotesResult = PayInQuotesResult;

export interface OnrampCheckoutRequest {
  quote: OnrampQuote;
  destination: string;
  region: string;
  fiat: string;
  amount: string;
}

export interface OnrampCheckoutSession {
  checkoutUrl: string;
  provider: string;
  orderId?: string | null;
}

export interface OnrampAdapter {
  getConfig(): Promise<OnrampConfig>;
  getCountries(): Promise<OnrampCountry[]>;
  getGeo(): Promise<string>;
  getQuotes(input: {
    region: string;
    fiat: string;
    amount: string;
    address: string;
  }): Promise<OnrampQuotesResult>;
  startCheckout(input: OnrampCheckoutRequest): Promise<OnrampCheckoutSession>;
}

export interface OnrampFlowProps {
  lockedAddress?: string;
  initialAddress?: string;
  initialAmount?: string;
  initialFiat?: string;
  initialRegion?: string;
  invoicePrice?: string;
  invoiceId?: string;
  adapter?: OnrampAdapter;
}
