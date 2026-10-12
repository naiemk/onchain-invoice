import { readFileSync } from "node:fs";
import { expect } from "chai";

function read(path: string): string {
  return readFileSync(path, "utf8");
}

describe("launch copy", function () {
  it("labels Identity Super as beta and keeps email recovery", function () {
    const english = read("ui/src/i18n/dictionaries/wallet-en.ts");
    const beta = english.match(/superWalletIdentityBeta:\s*\n\s*"([^"]+)"/)?.[1] ?? "";
    expect(beta.toLowerCase()).to.include("beta");
    expect(beta.toLowerCase()).to.include("unaudited");
    expect(beta.toLowerCase()).to.include("email recovery stays available");
    const lede = english.match(/superWalletIdentityLede:\s*\n\s*"([^"]+)"/)?.[1] ?? "";
    expect(lede.toLowerCase()).to.not.include("permanently disabled");

    const page = read("ui/src/pages/react/wallet/SuperWalletPage.tsx");
    const identitySection = page.slice(page.indexOf("function IdentityUpgradeSection"));
    expect(identitySection).to.include('data-testid="super-wallet-beta"');
    expect(identitySection).to.include('t("wallet.superWalletIdentityBeta")');
    expect(identitySection).to.not.include("superWalletFeatureIrreversible");
    expect(identitySection).to.not.include("superWalletUpgradeWarning");

    const legal = read("ui/src/legal/documents.ts");
    expect(legal).to.match(/Identity Super Wallet is beta[\s\S]{0,180}email recovery stays available/);
    expect(legal).to.match(/Identity wallet to Super Wallet is beta[\s\S]{0,220}keeps email recovery/);
  });
});
