import { expect } from "chai";
import { loadConfig, assertMainnetOmitsRestoreOverride } from "../commerce/server/config.js";

describe("mainnet boot", function () {
  it("refuses IDENTITY_RESTORE_ENABLED on the production host", function () {
    expect(() =>
      assertMainnetOmitsRestoreOverride(
        { IDENTITY_RESTORE_ENABLED: "0" } as NodeJS.ProcessEnv,
        "https://trustless-commerce.com"
      )
    ).to.throw(/IDENTITY_RESTORE_ENABLED/);
    expect(() =>
      assertMainnetOmitsRestoreOverride(
        { IDENTITY_RESTORE_ENABLED: "1", TC_PRODUCT: "tcmain" } as NodeJS.ProcessEnv,
        "http://127.0.0.1:8080"
      )
    ).to.throw(/IDENTITY_RESTORE_ENABLED/);
  });

  it("allows the override on localhost and loads it", function () {
    assertMainnetOmitsRestoreOverride(
      { IDENTITY_RESTORE_ENABLED: "0", TC_PRODUCT: "" } as NodeJS.ProcessEnv,
      "http://127.0.0.1:8080"
    );
    const cfg = loadConfig({
      ...process.env,
      BASE_URL: "http://127.0.0.1:9",
      TC_PRODUCT: "",
      IDENTITY_RESTORE_ENABLED: "0",
      DB_PATH: ":memory:",
      CONFIG_PATH: "",
    });
    expect(cfg.identity.restoreEnabledOverride).to.equal(false);
    expect(cfg.baseUrl).to.equal("http://127.0.0.1:9");
  });

  it("loadConfig throws for tcmain when the override is set", function () {
    expect(() =>
      loadConfig({
        ...process.env,
        BASE_URL: "https://trustless-commerce.com",
        IDENTITY_RESTORE_ENABLED: "0",
        DB_PATH: ":memory:",
        CONFIG_PATH: "",
      })
    ).to.throw(/IDENTITY_RESTORE_ENABLED/);
  });
});
