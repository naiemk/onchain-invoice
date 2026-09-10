import {
  fetchPayInConfig,
  fetchPayInCountries,
  fetchPayInGeo,
  fetchPayInQuotes,
  fetchPayInWidget,
} from "@/shared/pay-in.js";
import type { OnrampAdapter } from "../types.js";

export const metamaskOnrampAdapter: OnrampAdapter = {
  getConfig: fetchPayInConfig,
  getCountries: fetchPayInCountries,
  getGeo: fetchPayInGeo,
  getQuotes: fetchPayInQuotes,
  async startCheckout({ quote, destination, region, fiat, amount }) {
    const session = await fetchPayInWidget({
      region,
      fiat,
      amount,
      address: destination,
      providerId: quote.providerId,
      paymentMethodId: quote.paymentMethodId,
    });
    return {
      checkoutUrl: session.widgetUrl,
      provider: session.provider,
      orderId: session.orderId,
    };
  },
};
