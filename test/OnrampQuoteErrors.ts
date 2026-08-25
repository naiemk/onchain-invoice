import { expect } from "chai";
import {
  extractOnrampQuoteFailure,
  onrampErrorDetails,
  throwOnrampQuoteError,
} from "../commerce/shared/onramper-quotes.js";
import { localizeOnrampQuoteError } from "../ui/src/i18n/errors.js";

describe("Onramper quote structured errors", function () {
  it("extracts LimitMismatch with min/max from raw quote list", function () {
    const failure = extractOnrampQuoteFailure(
      [
        {
          ramp: "moonpay",
          errors: [
            {
              type: "LimitMismatch",
              errorId: 6101,
              message: "Amount should be in between SEK 250 and SEK 105000",
              minAmount: 250,
              maxAmount: 105000,
            },
          ],
        },
        {
          ramp: "stripe",
          errors: [{ type: "NoSupportedPayments", message: "No supported payments found" }],
        },
      ],
      "SEK",
      "creditcard"
    );
    expect(failure?.code).to.equal("onramp_limit_mismatch");
    expect(failure?.minAmount).to.equal(250);
    expect(failure?.maxAmount).to.equal(105000);
    expect(failure?.statusCode).to.equal(400);
  });

  it("prefers LimitMismatch over generic unavailable when throwing across details", function () {
    try {
      throwOnrampQuoteError({
        code: "onramp_limit_mismatch",
        message: "Amount should be in between SEK 250 and SEK 105000",
        statusCode: 400,
        fiat: "SEK",
        minAmount: 250,
        maxAmount: 105000,
        errorId: 6101,
        type: "LimitMismatch",
      });
      expect.fail("expected throw");
    } catch (error) {
      const details = onrampErrorDetails(error);
      expect(details?.code).to.equal("onramp_limit_mismatch");
      expect(details?.minAmount).to.equal(250);
    }
  });

  it("localizes LimitMismatch for the UI locale", function () {
    const text = localizeOnrampQuoteError({
      code: "onramp_limit_mismatch",
      fiat: "SEK",
      minAmount: 250,
      maxAmount: 105000,
    });
    expect(text).to.equal("Amount must be between 250 and 105000 SEK.");
  });
});
